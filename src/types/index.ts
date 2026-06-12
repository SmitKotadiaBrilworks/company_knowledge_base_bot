export interface Document {
  id: string;
  name: string;
  file_size: number;
  page_count: number;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ChunkMetadata {
  source: string;
  document_name: string;
  chunk_index: number;
  page?: number;
  [key: string]: unknown;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  metadata: ChunkMetadata;
  created_at: string;
}

// Returned by semantic_search() and hybrid_search() Supabase RPC calls
export interface SearchResult {
  id: string;
  content: string;
  metadata: ChunkMetadata;
  document_id: string;
  similarity?: number;   // semantic_search only
  rrf_score?: number;    // hybrid_search only
}

export interface UploadResponse {
  success: boolean;
  document: {
    id: string;
    name: string;
    chunks: number;
    pages: number;
  };
}

export interface QueryRequest {
  query: string;
  document_id?: string;               // optional: filter to a single document
  search_type?: "semantic" | "hybrid";
  match_count?: number;               // how many chunks to retrieve (default 5)
}

export interface QueryResponse {
  answer: string;
  sources: SearchResult[];
  query: string;
  search_type: string;
}
