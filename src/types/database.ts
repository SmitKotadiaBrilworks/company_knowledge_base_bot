// Supabase Database type definition.
// For production, auto-generate this with:
//   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      documents: {
        Row: {
          id: string;
          name: string;
          file_size: number;
          page_count: number;
          created_at: string;
          metadata: Json;
        };
        Insert: {
          id?: string;
          name: string;
          file_size?: number;
          page_count?: number;
          created_at?: string;
          metadata?: Json;
        };
        Update: {
          id?: string;
          name?: string;
          file_size?: number;
          page_count?: number;
          created_at?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      document_chunks: {
        Row: {
          id: string;
          document_id: string;
          content: string;
          embedding: string;
          chunk_index: number;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          content: string;
          embedding: string;
          chunk_index: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          content?: string;
          embedding?: string;
          chunk_index?: number;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      semantic_search: {
        Args: {
          query_embedding: number[]; // 3072 floats — gemini-embedding-001
          match_count?: number;
          filter_document_id?: string | null;
        };
        Returns: {
          id: string;
          content: string;
          metadata: Json;
          document_id: string;
          similarity: number;
        }[];
      };
      hybrid_search: {
        Args: {
          query_text: string;
          query_embedding: number[];
          match_count?: number;
          filter_document_id?: string | null;
          rrf_k?: number;
        };
        Returns: {
          id: string;
          content: string;
          metadata: Json;
          document_id: string;
          rrf_score: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row types
export type DbDocument = Database["public"]["Tables"]["documents"]["Row"];
export type DbDocumentChunk = Database["public"]["Tables"]["document_chunks"]["Row"];
