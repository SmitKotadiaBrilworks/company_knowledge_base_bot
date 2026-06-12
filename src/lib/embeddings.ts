// ============================================================
// Embeddings — Gemini-embedding-001
// ============================================================
// Embeddings convert text into a fixed-size vector of floating-point numbers.
// Similar texts produce vectors that point in the same direction in this
// high-dimensional space. We measure similarity with cosine distance.
//
// Gemini gemini-embedding-001 facts:
//   • Output dimension: 768
//   • Max input tokens: 2048
//   • Task types: RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY (important!)
//
// WHY SEPARATE TASK TYPES?
// When you embed a document chunk and a query with the same generic embedding,
// the model doesn't know whether to optimise the vector for "being found" vs
// "finding things". Using RETRIEVAL_DOCUMENT for chunks and RETRIEVAL_QUERY
// for questions tells Gemini to produce asymmetric embeddings that are
// specifically tuned for this retrieval scenario. This measurably improves
// recall (fewer missed relevant chunks).
// ============================================================

import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

// gemini-embedding-001 natively outputs 3072 dims; pgvector indexes cap at 2000.
// outputDimensionality truncates to 768 via Matryoshka representation learning —
// the model is trained so that the first N dims of a longer vector are themselves
// a valid, high-quality embedding (no quality cliff from truncation).
const EMBED_DIMS = 768;

export async function embedDocument(text: string): Promise<number[]> {
  const result = await model.embedContent({
    content: { parts: [{ text }], role: "user" },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
    outputDimensionality: EMBED_DIMS,
  } as never);
  return result.embedding.values;
}

export async function embedQuery(text: string): Promise<number[]> {
  const result = await model.embedContent({
    content: { parts: [{ text }], role: "user" },
    taskType: TaskType.RETRIEVAL_QUERY,
    outputDimensionality: EMBED_DIMS,
  } as never);
  return result.embedding.values;
}

// Embed multiple chunks in batches to avoid Gemini rate limits.
// Gemini free tier: 1500 req/min; paid: 2000 req/min.
// Batching with a small concurrency limit keeps us safely under quota.
export async function embedDocumentBatch(
  texts: string[],
  batchSize = 5
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await Promise.all(batch.map(embedDocument));
    results.push(...batchEmbeddings);
  }

  return results;
}
