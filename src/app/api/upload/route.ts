import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { getSupabaseAdmin } from "@/lib/supabase";
import { chunkDocument } from "@/lib/chunker";
import { embedDocumentBatch } from "@/lib/embeddings";
export const runtime = "nodejs";
export const maxDuration = 180; // 3 minutes — large PDFs + many Gemini embedding calls

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (max 20MB)" },
        { status: 400 }
      );
    }

    // ── Step 1: Parse PDF ───────────────────────────────────────────────────
    // pdf-parse extracts raw text from all pages into a single string.
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdfParse(buffer);

    if (!pdfData.text.trim()) {
      return NextResponse.json(
        { error: "PDF appears to be empty or image-only (no extractable text)" },
        { status: 400 }
      );
    }

    const db = getSupabaseAdmin();

    // ── Step 2: Create document record ────────────────────────────────────
    const { data: docData, error: docError } = await db
      .from("documents")
      .insert({ name: file.name, file_size: file.size, page_count: pdfData.numpages })
      .select()
      .single();

    if (docError) throw new Error(`Failed to create document: ${docError.message}`);
    const document = docData!;

    // ── Step 3: Chunk the document ────────────────────────────────────────
    // RecursiveCharacterTextSplitter: splits on \n\n → \n → ". " → " " → ""
    // chunkSize=1000 chars with 200-char overlap for context continuity.
    const chunks = await chunkDocument(pdfData.text, file.name);

    if (chunks.length === 0) {
      await db.from("documents").delete().eq("id", document.id);
      return NextResponse.json(
        { error: "Could not extract meaningful text chunks from this PDF" },
        { status: 400 }
      );
    }

    // ── Step 4: Embed all chunks (batched) ────────────────────────────────
    // Batches of 5 to stay within Gemini rate limits.
    // Each chunk → 768-dimensional vector via gemini-embedding-001 (RETRIEVAL_DOCUMENT).
    const texts = chunks.map((c) => c.content);
    const embeddings = await embedDocumentBatch(texts, 5);

    // ── Step 5: Bulk insert chunks + embeddings ───────────────────────────
    // Embedding is formatted as "[0.1,0.2,...]" — required by pgvector REST API.
    const rows = chunks.map((chunk, i) => ({
      document_id: document.id,
      content: chunk.content,
      embedding: `[${embeddings[i].join(",")}]`,
      chunk_index: chunk.metadata.chunk_index,
      metadata: {
        source: file.name,
        document_name: file.name,
        chunk_index: chunk.metadata.chunk_index,
        char_count: chunk.metadata.char_count,
      },
    }));

    const { error: chunksError } = await db.from("document_chunks").insert(rows);

    if (chunksError) {
      await db.from("documents").delete().eq("id", document.id);
      throw new Error(`Failed to store chunks: ${chunksError.message}`);
    }

    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        name: document.name,
        chunks: chunks.length,
        pages: pdfData.numpages,
      },
    });
  } catch (err) {
    console.error("[upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
