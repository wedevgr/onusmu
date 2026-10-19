import { query } from '../db';
import { ctx, decryptText } from './crypto';
import { matchText, normalizeText } from './textmatch';
import type { TimeRange } from './timeparse';

const MAX_SCANNED_CHUNKS = 20000;
// Decrypted transcripts kept in memory per user, so search while typing does not decrypt every
// chunk again on each keystroke. Dropped when a chunk is written or deleted, and after a while.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_USERS = 25;

interface ChunkRow {
  id: string;
  session_id: string;
  text: string;
  started_at: Date;
  ended_at: Date;
}

interface CachedChunk {
  id: string;
  sessionId: string;
  text: string;
  /** normalizeText(text), computed once. */
  normalized: string;
  startedAt: Date;
  endedAt: Date;
}

const cache = new Map<string, { at: number; chunks: CachedChunk[] }>();

/** Forgets a user's cached transcripts; call after any transcript is written or deleted. */
export function invalidateTranscriptCache(userId: string): void {
  cache.delete(userId);
}

/** The user's transcripts with text, newest first, decrypted. */
async function userChunks(userId: string): Promise<CachedChunk[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    // Most recently used last, so the oldest entry is the one evicted.
    cache.delete(userId);
    cache.set(userId, hit);
    return hit.chunks;
  }
  const rows = await query<ChunkRow>(
    `SELECT id, session_id, text, started_at, ended_at
     FROM transcript_chunks
     WHERE user_id = $1 AND text <> ''
     ORDER BY started_at DESC, id
     LIMIT ${MAX_SCANNED_CHUNKS}`,
    [userId],
  );
  const chunks = rows.map((r) => {
    const text = decryptText(r.text, ctx.chunkText(userId, r.id));
    return {
      id: r.id,
      sessionId: r.session_id,
      text,
      normalized: normalizeText(text),
      startedAt: r.started_at,
      endedAt: r.ended_at,
    };
  });
  cache.set(userId, { at: Date.now(), chunks });
  while (cache.size > CACHE_MAX_USERS) cache.delete(cache.keys().next().value!);
  return chunks;
}

export interface LiteralHit {
  id: string;
  sessionId: string;
  text: string;
  startedAt: Date;
  endedAt: Date;
  /** Share of stems found, 0..1. */
  share: number;
  phrase: boolean;
  ranges: Array<[number, number]>;
}

/**
 * Transcript text is encrypted at rest, so the database cannot match on it. This matches the
 * user's decrypted chunks in memory, newest first, keeping those containing enough of the
 * stems (or the whole phrase).
 */
export async function scanLiteral(
  userId: string,
  stems: string[],
  opts: { range: TimeRange | null; limit: number; minShare: number; phrase?: string },
): Promise<LiteralHit[]> {
  const phrase = opts.phrase?.trim() ?? '';
  if (stems.length === 0 && !phrase) return [];
  const normalizedPhrase = normalizeText(phrase);
  const found: LiteralHit[] = [];
  for (const c of await userChunks(userId)) {
    if (opts.range && (c.startedAt < opts.range.from || c.startedAt > opts.range.to)) continue;
    // Cheap check first: skip chunks with none of the stems and not the phrase.
    if (!stems.some((s) => c.normalized.includes(s)) && !(normalizedPhrase && c.normalized.includes(normalizedPhrase))) {
      continue;
    }
    const m = matchText(c.text, stems, phrase);
    if (!m.phrase && (stems.length === 0 || m.share < opts.minShare || m.share === 0)) continue;
    found.push({
      id: c.id,
      sessionId: c.sessionId,
      text: c.text,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      share: m.share,
      phrase: m.phrase,
      ranges: m.ranges,
    });
    if (found.length >= opts.limit) break;
  }
  return found;
}
