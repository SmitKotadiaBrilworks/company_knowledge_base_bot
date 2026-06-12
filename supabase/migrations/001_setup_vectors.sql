-- ============================================================
-- RAG Knowledge Base — Database Schema
-- ============================================================
-- This file sets up the full vector search infrastructure:
--   1. pgvector extension (adds vector data type)
--   2. documents table (tracks uploaded PDF files)
--   3. document_chunks table (stores text chunks + embeddings)
--   4. Indexes for fast ANN and full-text search
--   5. semantic_search() function
--   6. hybrid_search() function with Reciprocal Rank Fusion (RRF)
--
-- Run this once against your Supabase project via:
--   Dashboard → SQL Editor → paste & run
-- ============================================================

-- Step 1: Enable pgvector
-- pgvector adds the `vector` data type and similarity operators to Postgres.
-- Operators:
--   <=>  cosine distance       (most common for text embeddings)
--   <#>  negative inner product
--   <->  L2 (Euclidean) distance
create extension if not exists vector;

-- Step 2: Documents table
-- Each row represents one uploaded PDF file.
create table if not exists documents (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  file_size  bigint      default 0,
  page_count int         default 0,
  created_at timestamptz default now(),
  metadata   jsonb       default '{}'::jsonb
);

-- Step 3: Document chunks table
-- Each row is a single text chunk from a document, with:
--   content    — the raw text (what gets shown to the LLM as context)
--   embedding  — 768-float vector from Gemini gemini-embedding-001
--   metadata   — arbitrary JSON: source filename, page number, etc.
--
-- gemini-embedding-001 natively outputs 3072 dims but we truncate to 768 via
-- outputDimensionality. The model uses Matryoshka training so the first 768
-- dims are a complete, high-quality embedding — no quality loss from truncation.
-- 768 dims also keeps us under pgvector's 2000-dim index limit.
create table if not exists document_chunks (
  id          uuid        primary key default gen_random_uuid(),
  document_id uuid        references documents(id) on delete cascade,
  content     text        not null,
  embedding   vector(768),
  chunk_index int         not null,
  metadata    jsonb       default '{}'::jsonb,
  created_at  timestamptz default now()
);

-- Step 4: IVFFlat index for Approximate Nearest Neighbor (ANN) search
-- -----------------------------------------------------------------------
-- IVFFlat clusters vectors into `lists` buckets. At query time it only
-- scans nearby buckets — much faster than brute-force for large collections.
-- `lists = 100` is a good default for up to ~1M vectors.
-- `vector_cosine_ops` matches the <=> cosine distance operator used in queries.
create index if not exists idx_document_chunks_embedding
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Step 5: GIN index for full-text search (keyword component of hybrid search)
-- GIN (Generalized Inverted Index) stores a mapping of each lexeme to the rows
-- containing it — analogous to a book's index.
-- `to_tsvector('english', content)` normalises text: removes stopwords,
-- applies stemming (run → run, runs → run, running → run).
create index if not exists idx_document_chunks_content_fts
  on document_chunks
  using gin(to_tsvector('english', content));

-- ============================================================
-- Step 6: Semantic Search Function
-- ============================================================
-- Pure vector similarity search.
-- Returns chunks ordered by cosine similarity to the query embedding.
--
-- How cosine similarity works:
--   Two vectors are "similar" when they point in the same direction,
--   regardless of magnitude. `1 - cosine_distance` converts [0,2] → [1,-1]
--   so that 1.0 = identical, 0.0 = orthogonal, -1.0 = opposite.
--
-- When to use: when you care about meaning/intent more than exact words.
--   e.g. "how do I reset my password?" matches "account recovery steps"
create or replace function semantic_search(
  query_embedding    vector(768),
  match_count        int     default 5,
  filter_document_id uuid    default null
)
returns table (
  id          uuid,
  content     text,
  metadata    jsonb,
  document_id uuid,
  similarity  float
)
language sql stable
as $$
  select
    dc.id,
    dc.content,
    dc.metadata,
    dc.document_id,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where (filter_document_id is null or dc.document_id = filter_document_id)
  order by dc.embedding <=> query_embedding  -- ascending = closest first
  limit match_count;
$$;

-- ============================================================
-- Step 7: Hybrid Search with Reciprocal Rank Fusion (RRF)
-- ============================================================
-- Combines semantic (vector) search + keyword (BM25/FTS) search.
--
-- WHY HYBRID?
--   Semantic search: good at conceptual matches, bad at exact terms.
--     e.g. "Q4 revenue" might not match "fourth-quarter earnings" semantically
--         because financial jargon may not be well-represented in the embedding space.
--   Keyword search: good at exact matches, bad at paraphrases.
--     e.g. "password reset" won't find "account recovery" via keyword.
--   Combined: you get both coverage of meaning AND precision on exact terms.
--
-- RECIPROCAL RANK FUSION (RRF):
--   Instead of trying to normalise and combine raw scores (which are on
--   incompatible scales), RRF only cares about RANK POSITION.
--   Formula: score = Σ  1 / (k + rank_i)
--   where k=60 is a smoothing constant that prevents top ranks from dominating.
--
--   Example with k=60:
--     Rank 1:  1/(60+1)  = 0.0164
--     Rank 2:  1/(60+2)  = 0.0161
--     Rank 10: 1/(60+10) = 0.0143
--   The difference between rank 1 and rank 10 is only ~12% — RRF is robust
--   to outliers in either ranking list.
create or replace function hybrid_search(
  query_text         text,
  query_embedding    vector(768),
  match_count        int  default 5,
  filter_document_id uuid default null,
  rrf_k              int  default 60
)
returns table (
  id          uuid,
  content     text,
  metadata    jsonb,
  document_id uuid,
  rrf_score   float
)
language plpgsql stable
as $$
begin
  return query
  with
  -- ── Semantic leg: rank by cosine distance (ascending = more similar) ──
  semantic_ranked as (
    select
      dc.id,
      row_number() over (order by dc.embedding <=> query_embedding) as rank_pos
    from document_chunks dc
    where (filter_document_id is null or dc.document_id = filter_document_id)
    order by dc.embedding <=> query_embedding
    limit match_count * 4  -- over-fetch; RRF will re-rank and trim
  ),
  -- ── Keyword leg: rank by BM25-like tf-idf score (descending = more relevant) ──
  -- ts_rank_cd weights position and density of query terms in the document.
  keyword_ranked as (
    select
      dc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('english', dc.content),
          plainto_tsquery('english', query_text)
        ) desc
      ) as rank_pos
    from document_chunks dc
    where
      (filter_document_id is null or dc.document_id = filter_document_id)
      and to_tsvector('english', dc.content) @@ plainto_tsquery('english', query_text)
    limit match_count * 4
  ),
  -- ── RRF fusion: merge both ranked lists ──
  -- FULL OUTER JOIN keeps chunks that appear in only one leg.
  -- A chunk that appears in both lists gets scores from both added together.
  fused as (
    select
      coalesce(sr.id, kr.id) as id,
      coalesce(1.0 / (rrf_k + sr.rank_pos), 0.0) +
      coalesce(1.0 / (rrf_k + kr.rank_pos), 0.0) as rrf_score
    from semantic_ranked sr
    full outer join keyword_ranked kr on sr.id = kr.id
  )
  select
    dc.id,
    dc.content,
    dc.metadata,
    dc.document_id,
    f.rrf_score
  from fused f
  join document_chunks dc on dc.id = f.id
  order by f.rrf_score desc
  limit match_count;
end;
$$;
