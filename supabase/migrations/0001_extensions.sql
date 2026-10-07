-- 0001_extensions.sql
-- Enable required PostgreSQL extensions for the AI Memory app.
-- pgvector provides the vector type + HNSW indexing used for transcript embeddings.
-- pg_trgm powers fuzzy/substring text search on transcript chunks.

create extension if not exists vector;
create extension if not exists pg_trgm;
