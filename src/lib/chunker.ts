// ============================================================
// Document Chunking — Recursive Character Text Splitter
// ============================================================
// WHY DO WE CHUNK?
//
// LLMs and embedding models have token limits. Gemini-embedding-001
// accepts up to 2048 tokens. But the bigger reason is RETRIEVAL PRECISION:
// embedding a 10-page document as one vector averages all topics together.
// A query about "Q4 revenue" would match "HR policies" and "engineering
// roadmap" in the same diluted vector. Smaller, focused chunks produce
// sharper embeddings that match specific questions precisely.
//
// CHUNK SIZE TRADEOFFS:
//   Small (200-400 chars):  precise retrieval, risk losing context
//   Large (1500-2000 chars): more context per result, less precise match
//   1000 chars + 200 overlap: good default for business documents
//
// OVERLAP:
//   A sentence that spans the split boundary gets cut in half, losing
//   its meaning. Including the last 200 chars of the previous chunk at
//   the start of the next chunk preserves context at every boundary.
//
// RECURSIVE STRATEGY:
//   Try to split on paragraph breaks (\n\n) first.
//   If a piece is still too large, try line breaks (\n).
//   Then sentence endings (". "), then words, then characters.
//   This produces semantically coherent chunks whenever possible.
// ============================================================

export interface TextChunk {
  content: string;
  metadata: {
    chunk_index: number;
    source: string;
    char_count: number;
    [key: string]: unknown;
  };
}

export interface ChunkConfig {
  chunkSize?: number;
  chunkOverlap?: number;
}

const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

function splitOnSeparator(text: string, separator: string): string[] {
  if (separator === "") return text.split("");
  return text.split(separator).filter((s) => s.length > 0);
}

function mergeWithOverlap(
  pieces: string[],
  separator: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const piece of pieces) {
    const addLen = piece.length + (current.length > 0 ? separator.length : 0);

    if (currentLen + addLen > chunkSize && current.length > 0) {
      chunks.push(current.join(separator));

      // Keep enough tail for overlap
      while (current.length > 0 && currentLen > chunkOverlap) {
        const removed = current.shift()!;
        currentLen -= removed.length + separator.length;
      }
    }

    current.push(piece);
    currentLen += addLen;
  }

  if (current.length > 0) {
    chunks.push(current.join(separator));
  }

  return chunks;
}

function recursiveSplit(
  text: string,
  separators: string[],
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (text.length <= chunkSize) return [text];

  const [sep, ...rest] = separators;
  const pieces = splitOnSeparator(text, sep ?? "");

  const good: string[] = [];
  const toSplit: string[] = [];

  for (const piece of pieces) {
    if (piece.length <= chunkSize) {
      good.push(piece);
    } else {
      // Flush good pieces first, then recursively split the large piece
      if (good.length > 0) {
        const merged = mergeWithOverlap(good, sep ?? "", chunkSize, chunkOverlap);
        for (const c of merged) toSplit.push(c);
        good.length = 0;
      }
      const sub = recursiveSplit(piece, rest, chunkSize, chunkOverlap);
      toSplit.push(...sub);
    }
  }

  if (good.length > 0) {
    const merged = mergeWithOverlap(good, sep ?? "", chunkSize, chunkOverlap);
    toSplit.push(...merged);
  }

  return toSplit;
}

export function chunkDocument(
  text: string,
  source: string,
  config: ChunkConfig = {}
): TextChunk[] {
  const { chunkSize = 1000, chunkOverlap = 200 } = config;

  const rawChunks = recursiveSplit(
    text.trim(),
    SEPARATORS,
    chunkSize,
    chunkOverlap
  );

  return rawChunks
    .map((content) => content.trim())
    .filter((content) => content.length > 50)
    .map((content, index) => ({
      content,
      metadata: { chunk_index: index, source, char_count: content.length },
    }));
}
