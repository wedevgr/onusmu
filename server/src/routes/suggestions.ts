import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { ctx, decryptText } from '../lib/crypto';
import { groundedQuestions } from '../lib/groundedQuestions';
import { getUserTimezone } from '../lib/rag';
import { formatZonedGreek } from '../lib/zonedtime';

// Asked when the model suggests nothing usable; true whenever the user has any recording.
const FALLBACK = 'Σύνοψε την πιο πρόσφατη καταγραφή μου';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; suggestions: string[] }>();

interface RecentChunkRow {
  id: string;
  text: string;
  started_at: Date;
}

export default async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  // Questions to start a chat with, each answerable from the user's latest recordings.
  // None for a user with no recordings: there is nothing to ask about yet.
  app.get('/suggestions', async (request) => {
    const userId = request.userId;

    const cached = cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { suggestions: cached.suggestions };
    }

    // The latest recordings, whenever they were: a quiet day still has something to ask about.
    const rows = await query<RecentChunkRow>(
      `SELECT id, text, started_at
       FROM transcript_chunks
       WHERE user_id = $1 AND text <> ''
       ORDER BY started_at DESC
       LIMIT 12`,
      [userId],
    );

    let suggestions: string[] = [];
    if (rows.length > 0) {
      const timezone = await getUserTimezone(userId);
      const excerpts = rows
        .slice()
        .reverse()
        .map((r) => ({
          label: formatZonedGreek(r.started_at, timezone),
          text: decryptText(r.text, ctx.chunkText(userId, r.id)),
        }));
      suggestions = await groundedQuestions(
        excerpts,
        `Today is ${formatZonedGreek(new Date(), timezone)}. Suggest 3 questions the user could start a chat with about these recent recordings.`,
      );
      if (suggestions.length === 0) suggestions = [FALLBACK];
    }

    cache.set(userId, { at: Date.now(), suggestions });
    return { suggestions };
  });
}
