# AI Memory

A personal, searchable memory. Record conversations from your phone; speech becomes timestamped, searchable text; ask questions about the past through an AI chat that answers only from your own recorded memories.

```
Microphone → 45s audio chunks → upload → Speech-to-Text → transcript chunks
→ embeddings (pgvector) → hybrid retrieval (vector + keyword + time filters) → RAG chat
```

## Monorepo layout

| Directory    | What it is |
|--------------|------------|
| `app/`       | Expo (React Native + TypeScript) mobile app — recording, offline outbox, timeline, search, chat, settings |
| `server/`    | Node.js + TypeScript backend — uploads, STT pipeline, embeddings, queue worker, hybrid search, RAG chat |
| `supabase/`  | Migrations: schema, Row Level Security, pgvector indexes, hybrid-search SQL functions, private audio storage |

## How it works

### Recording & reliability (the core loop)
1. User presses **Start Recording** (never automatic).
2. `app/src/lib/recorder.ts` records 45-second segments with expo-av, restarting immediately after each segment — recording never blocks on upload.
3. Every finished segment is written to a persistent local **outbox** (`app/src/lib/outbox.ts`): file on disk + metadata in AsyncStorage. Audio is never lost silently.
4. `app/src/lib/sync.ts` uploads outbox entries FIFO (`POST /v1/uploads`). On failure entries stay queued with exponential backoff and retry when connectivity returns.
5. The backend stores the chunk in Supabase Storage, enqueues an `audio_jobs` row, and a worker (`server/src/queue/`) runs the pipeline: `transcribing → embedding → completed`, with automatic retries (audio is kept until a chunk completes).
6. Unless the user's **Keep original audio** setting is ON, audio is deleted after transcription — only text, timestamps and embeddings remain.

### Asking your memory
`POST /v1/chat` → parse time expressions ("yesterday", "this morning", "around 3 PM", "Monday", "last week") into date filters → embed the question → `match_chunks` SQL function (0.75 × vector cosine similarity + 0.25 × keyword rank + substring bonus, with time filtering) → top 12 chunks + question go to the LLM → answer with timestamp citations. The app renders citations as tappable chips that jump to the transcript timeline.

## Setup

### 1. Supabase
Create a project at supabase.com, then either:
- **From the backend repo** (uses `DATABASE_URL` from `server/.env`): `cd server && npm run db:push` — applies all migrations in order, one transaction each, or
- **Dashboard**: open the SQL editor and paste `supabase/migrations/0001_extensions.sql` … `0006_storage.sql` in order, or
- **CLI**: `cd supabase && supabase link --project-ref <ref> && supabase db push`

Note the project URL, anon key and service-role key (Settings → API), and the database password (Settings → Database).

### 2. Backend
```bash
cd server
cp .env.example .env        # fill in DATABASE_URL + Supabase keys + OPENAI_API_KEY
npm install
npm run dev                 # http://localhost:8787
```
**DATABASE_URL gotcha:** on newer Supabase projects the direct host `db.<ref>.supabase.co` is IPv6-only. If your machine has no working IPv6, use the **Session pooler** string from Dashboard → Connect:
`postgres://postgres.<ref>:[password]@aws-0-<region>.pooler.supabase.com:5432/postgres` — port **5432** (session mode) is required, the queue worker relies on `FOR UPDATE SKIP LOCKED` inside a transaction.

Set `STT_PROVIDER=whisper` (default, OpenAI Whisper API) or `deepgram`. Embeddings and chat use OpenAI (`text-embedding-3-small`, `gpt-4o-mini`) — swap providers by implementing the interfaces in `server/src/providers/types.ts`.

**Verify the whole pipeline** (creates a throwaway user, synthesizes speech via OpenAI TTS, uploads it, waits for transcription, runs search + RAG chat, cleans up):
```bash
set -a && . ./.env && set +a && node scripts/smoke-test.mjs
```

### 3. App
```bash
cd app
cp .env.example .env        # EXPO_PUBLIC_SUPABASE_URL / ANON_KEY / API_URL
npm install
npx expo start
```
Background audio recording requires a **dev build** (`npx expo run:ios` / `run:android` or EAS), not Expo Go. `app.json` already declares the iOS `audio` background mode and Android microphone/foreground-service permissions.

## Security & privacy
- Supabase Auth (email) for all users; backend verifies the Supabase JWT on every `/v1` request.
- Row Level Security on every table (`user_id = auth.uid()`); the backend additionally scopes every query by the verified user id.
- All audio storage access happens server-side with the service-role key (audio objects are organized in per-user folders). Per-user storage policies can't be created via SQL on hosted Supabase (`storage.objects` is owned by `supabase_storage_admin`) — if you ever add direct client audio access, create those policies in the Dashboard.
- Recording starts only on explicit user action; the recording screen shows a persistent pulsing indicator and elapsed time.
- Users can delete any chunk, any session, all memories, or their entire account (`DELETE /v1/account` removes the auth user; cascades wipe all data, storage is purged).

## Status & known limits (MVP)
- Verified end-to-end against a live Supabase project: all 6 migrations applied, and the full loop passed — TTS speech → chunk upload → Whisper transcription (verbatim) → embedding → keyword search → RAG chat answer with timestamp citations. See `server/scripts/smoke-test.mjs`.
- Verified locally: backend `tsc` typecheck + build, app `tsc --noEmit`.
- Not verifiable in this environment (needs real devices): actual microphone capture and locked-screen recording behavior on iOS/Android.
- Android 14+ background capture may require a foreground-service native module for full reliability; the chunking/outbox pipeline is designed so such a module can replace `recorder.ts` without touching sync/upload code.
- Timeline answers use server-local timezone in prompts; daily summaries and streaming chat are deliberately left out of the MVP.
