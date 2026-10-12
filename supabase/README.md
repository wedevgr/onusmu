# Supabase database layer — AI Memory App

Postgres schema, Row Level Security, search functions, and private audio storage for the AI Memory monorepo. Uses the [Supabase CLI](https://supabase.com/docs/guides/cli) migrations layout.

## Layout

| File | Purpose |
|---|---|
| `config.toml` | Local-dev Supabase CLI config (project id `ai-memory`, API on port 54321) |
| `migrations/0001_extensions.sql` | Enables `vector` (pgvector) and `pg_trgm` extensions |
| `migrations/0002_tables.sql` | Creates the 6 app tables |
| `migrations/0003_indexes.sql` | B-tree, HNSW (vector) and GIN (trigram) indexes |
| `migrations/0004_rls.sql` | Enables RLS + owner-scoped policies on all 6 tables |
| `migrations/0005_functions.sql` | `match_chunks()` (hybrid vector + full-text) and `search_chunks_text()` (trigram) |
| `migrations/0006_storage.sql` | Private `audio-chunks` bucket + object-level storage policies |
| `migrations/0007_encrypted_text.sql` | Drops text-based search (trigram index, `search_chunks_text()`); `match_chunks()` becomes vector-only |
| `seed.sql` | Empty by default (all data is user-owned); add local fixtures here if needed |

## Applying migrations

### Option A — Supabase dashboard (no CLI required)

Open the **SQL editor** on your Supabase project and paste the migration files **in order** (`0001` → `0006`), running each in full. The files are written to be idempotent where PostgreSQL allows (extensions/tables/indexes use `if not exists`, policies and functions are dropped before creation), so re-running a file is safe.

### Option B — Supabase CLI

```bash
# Against a hosted project:
supabase link --project-ref <your-project-ref>
supabase db push

# Or against the local stack defined by config.toml:
supabase start
supabase db reset   # applies migrations/ then seed.sql
```

## Schema notes for the backend

- **Session upserts**: the server upserts `recording_sessions` by its unique key `(user_id, client_id)`.
- **Audio lifecycle**: raw audio is uploaded to the private `audio-chunks` bucket at `<user_id>/<chunk_id>.m4a` and `transcript_chunks.audio_path` mirrors that path. When `user_settings.keep_audio` is `false` (the default), the backend deletes the object after transcription/embedding and sets `audio_path` to NULL.
- **Job queue**: `audio_jobs` is polled with `where status = 'pending' and next_attempt_at <= now() order by next_attempt_at`, bumping `attempts` until `max_attempts` (default 8) is reached.
- **Encryption at rest**: the backend encrypts `transcript_chunks.text`, `chat_conversations.title`, `chat_messages.content`, citation text and stored audio objects with AES-256-GCM (`CHAT_ENCRYPTION_KEY`). Encrypted text looks like `enc:v2:<keyId>:...`: the key id allows key rotation, and each value is bound to its owner and row id, so it cannot be decrypted from any other row. Empty `text` stays empty and means "no speech". The database never sees plaintext, so it cannot match or rank on text.
- **Search**:
  - `match_chunks(p_user_id, p_query_embedding, p_from, p_to, p_limit)` — pure cosine similarity; returns the stored (encrypted) text. The backend over-fetches, decrypts and adds the keyword part of the hybrid score. Rows with NULL `embedding` are excluded.
  - Text search has no SQL function: the backend scans the user's chunks newest-first and matches after decryption.
  - `match_chunks` is `security invoker` with an explicit `(p_user_id = auth.uid() or auth.uid() is null)` guard, so it can be called from the backend over a direct Postgres connection as the `postgres` role (where `auth.uid()` returns NULL). A client calling with a user JWT must still pass its own uid; anonymous callers pass the guard but get zero rows because RLS filters the underlying `transcript_chunks` select for `anon`.
- **RLS**: every table has a single `for all` policy restricted to `authenticated`, requiring `user_id = auth.uid()`. The `anon` role has no access; `service_role` bypasses RLS as usual.

## Changing the embedding dimension

The schema targets OpenAI `text-embedding-3-small` (`vector(1536)`). To use a different model/dimension, update all of the following, then re-embed existing rows:

1. `migrations/0002_tables.sql` — change `embedding vector(1536)` to `vector(N)`.
2. `migrations/0003_indexes.sql` — drop and recreate `transcript_chunks_embedding_idx` (indexes on `vector` do not support an in-place dimension change).
3. `migrations/0005_functions.sql` — change the `p_query_embedding vector(1536)` parameter in `match_chunks` (drop + recreate the function).

For a live database, run the equivalent `alter table` / `drop index` / `drop function` statements in the SQL editor before applying the new migration.
