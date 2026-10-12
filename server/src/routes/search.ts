import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { ctx, decryptText } from '../lib/crypto';
import { normalizeText } from '../lib/rag';

const searchSchema = z.object({
  q: z.string().min(1).max(300),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const SCAN_PAGE_SIZE = 1000;
const MAX_SCANNED_CHUNKS = 20000;

interface ChunkRow {
  id: string;
  session_id: string;
  text: string;
  started_at: Date;
  ended_at: Date;
}

export default async function searchRoutes(app: FastifyInstance): Promise<void> {
  // Transcript text is encrypted at rest, so the database cannot match on it.
  // We walk the user's chunks newest-first, decrypt in memory and match here.
  app.get('/search', async (request) => {
    const params = searchSchema.parse(request.query);
    const needle = normalizeText(params.q).trim();
    const results: Array<{
      id: string;
      sessionId: string;
      text: string;
      startedAt: Date;
      endedAt: Date;
      score: number;
    }> = [];

    for (
      let offset = 0;
      needle.length > 0 && offset < MAX_SCANNED_CHUNKS && results.length < params.limit;
      offset += SCAN_PAGE_SIZE
    ) {
      const rows = await query<ChunkRow>(
        `SELECT id, session_id, text, started_at, ended_at
         FROM transcript_chunks
         WHERE user_id = $1
           AND text <> ''
           AND ($2::timestamptz IS NULL OR started_at >= $2)
           AND ($3::timestamptz IS NULL OR started_at <= $3)
         ORDER BY started_at DESC, id
         LIMIT $4 OFFSET $5`,
        [
          request.userId,
          params.from ? params.from.toISOString() : null,
          params.to ? params.to.toISOString() : null,
          SCAN_PAGE_SIZE,
          offset,
        ],
      );

      for (const r of rows) {
        const text = decryptText(r.text, ctx.chunkText(request.userId, r.id));
        const haystack = normalizeText(text);
        if (!haystack.includes(needle)) continue;
        results.push({
          id: r.id,
          sessionId: r.session_id,
          text,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          score: Math.min(1, needle.length / Math.max(1, haystack.length)),
        });
        if (results.length >= params.limit) break;
      }

      if (rows.length < SCAN_PAGE_SIZE) break;
    }

    return { results };
  });
}
