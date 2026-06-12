// ============================================================
// RAG Pipeline — Retrieval-Augmented Generation
// ============================================================
// RAG = Retrieval + Generation
//
// Core idea: instead of asking the LLM to "know" your company's documents
// (which would require fine-tuning), we:
//   1. RETRIEVE the most relevant document chunks at query time
//   2. INJECT them into the LLM prompt as context
//   3. Ask the LLM to GENERATE an answer grounded in that context
//
// This means:
//   • The LLM never hallucinates facts from your docs (only uses what we give it)
//   • You can update documents without retraining the LLM
//   • You can cite exactly which chunks were used (transparent sourcing)
//
// Full pipeline for a query:
//   query text
//     → embedQuery()         [Gemini RETRIEVAL_QUERY]
//     → hybrid_search RPC    [Supabase pgvector + FTS, fused via RRF]
//     → retrieved chunks     [top-k most relevant passages]
//     → buildPrompt()        [inject chunks as context into prompt]
//     → Gemini Flash         [generate the answer]
//     → return {answer, sources}
// ============================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSupabaseAdmin } from "./supabase";
import { embedQuery } from "./embeddings";
import type { SearchResult, QueryResponse } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
// gemini-2.5-flash: fast, cheap, excellent for RAG answer generation
const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ── Search ────────────────────────────────────────────────────────────────────

interface SearchOptions {
  documentId?: string;
  searchType?: "semantic" | "hybrid";
  matchCount?: number;
}

export async function searchChunks(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { documentId, searchType = "hybrid", matchCount = 5 } = options;

  // The query must be embedded with RETRIEVAL_QUERY task type —
  // this is the asymmetric counterpart to RETRIEVAL_DOCUMENT used when storing.
  const queryEmbedding = await embedQuery(query);
  const db = getSupabaseAdmin();

  if (searchType === "hybrid") {
    // hybrid_search uses Reciprocal Rank Fusion to merge semantic + keyword results.
    // See supabase/migrations/001_setup_vectors.sql for the full RRF explanation.
    const { data, error } = await db.rpc("hybrid_search", {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: matchCount,
      filter_document_id: documentId ?? null,
    });

    if (error) throw new Error(`Hybrid search failed: ${error.message}`);
    return (data as SearchResult[]) ?? [];
  } else {
    // Pure semantic search — only vector cosine similarity, no keyword component.
    const { data, error } = await db.rpc("semantic_search", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      filter_document_id: documentId ?? null,
    });

    if (error) throw new Error(`Semantic search failed: ${error.message}`);
    return (data as SearchResult[]) ?? [];
  }
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function buildPrompt(query: string, chunks: SearchResult[]): string {
  const context = chunks
    .map(
      (chunk, i) =>
        `[Source ${i + 1}${chunk.metadata?.source ? ` — ${chunk.metadata.source}` : ""}]\n${chunk.content}`
    )
    .join("\n\n---\n\n");

  return `You are a knowledgeable assistant for a company knowledge base. Your job is to give clear, well-structured answers based strictly on the provided context excerpts.

CONTEXT:
${context}

QUESTION: ${query}

INSTRUCTIONS:
- Write in full, natural sentences — no bullet dumps or fragmented phrases.
- Open with a direct answer to the question, then expand with supporting detail.
- Cite sources inline as you use them (e.g. "According to Source 1, ..." or "... (Source 2).").
- If multiple sources support the same point, mention both (e.g. "Sources 1 and 3 both state ...").
- If the answer spans multiple aspects, use short paragraphs — one idea per paragraph.
- If the answer is not present in the context, say exactly: "I don't have information about that in the uploaded documents."
- Do NOT add information from outside the provided context.`;
}

// ── Answer Generation ─────────────────────────────────────────────────────────

export async function generateAnswer(
  query: string,
  chunks: SearchResult[]
): Promise<string> {
  if (chunks.length === 0) {
    return "I couldn't find any relevant information in the uploaded documents to answer your question.";
  }

  const prompt = buildPrompt(query, chunks);
  const result = await chatModel.generateContent(prompt);
  return result.response.text();
}

// ── Full RAG Pipeline ─────────────────────────────────────────────────────────

export async function ragQuery(
  query: string,
  options: SearchOptions = {}
): Promise<QueryResponse> {
  const { searchType = "hybrid" } = options;
  const sources = await searchChunks(query, options);
  const answer = await generateAnswer(query, sources);
  return { answer, sources, query, search_type: searchType };
}
