-- Semantic Content Memory — pgvector embeddings for anti-repetition
-- User priority #1: prevent Studio from becoming repetitive after 30-60 days

-- 1. Ensure pgvector extension (idempotent)
create extension if not exists vector;

-- 2. Add embedding column to content_memories
alter table content_memories
  add column if not exists embedding vector(384),
  add column if not exists content_fingerprint text;

comment on column content_memories.embedding is '384-dim embedding of topic+angle+hook for semantic dedup';
comment on column content_memories.content_fingerprint is 'Content hash for exact dedup guard';

-- 3. HNSW index for fast cosine similarity search
create index if not exists content_memories_embedding_idx
  on content_memories
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- 4. Index for persona-scoped lookups
create index if not exists content_memories_persona_type_idx
  on content_memories (persona_id, memory_type, created_at desc);

-- 5. Semantic match function (mirrors match_proofs_by_embedding)
create or replace function match_memories_by_embedding(
  query_embedding vector(384),
  match_persona_id uuid,
  match_threshold float default 0.75,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  memory_type text,
  similarity float,
  created_at timestamptz
)
language sql
security invoker
set search_path = public, extensions
as $$
  select
    m.id,
    m.content,
    m.memory_type,
    1 - (m.embedding <=> query_embedding) as similarity,
    m.created_at
  from content_memories m
  where m.persona_id = match_persona_id
    and m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) >= match_threshold
  order by m.embedding <=> query_embedding
  limit match_count
$$;

comment on function match_memories_by_embedding is 'Find semantically similar content memories for anti-repetition';
