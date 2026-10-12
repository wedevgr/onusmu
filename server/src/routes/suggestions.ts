import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { ctx, decryptText } from '../lib/crypto';
import { getLlmProvider } from '../providers';
import { formatClock, formatDay } from '../lib/timeparse';

const DEFAULT_SUGGESTIONS = [
  'Τι συζήτησα σήμερα;',
  'Σύνοψε την πιο πρόσφατη καταγραφή μου',
  'Τι είπα ότι πρέπει να κάνω;',
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; suggestions: string[] }>();

interface RecentChunkRow {
  id: string;
  text: string;
  started_at: Date;
  ended_at: Date;
}

function parseSuggestionList(raw: string): string[] {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 3);
}

export default async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/suggestions', async (request) => {
    const userId = request.userId;

    const cached = cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { suggestions: cached.suggestions };
    }

    const rows = await query<RecentChunkRow>(
      `SELECT id, text, started_at, ended_at
       FROM transcript_chunks
       WHERE user_id = $1 AND text <> '' AND started_at > now() - interval '24 hours'
       ORDER BY started_at DESC
       LIMIT 12`,
      [userId],
    );

    if (rows.length === 0) {
      return { suggestions: DEFAULT_SUGGESTIONS };
    }

    const excerpts = rows
      .slice()
      .reverse()
      .map((r) => `[${formatClock(r.started_at)}-${formatClock(r.ended_at)}] ${decryptText(r.text, ctx.chunkText(userId, r.id))}`)
      .join('\n');

    let suggestions = DEFAULT_SUGGESTIONS;
    try {
      const raw = await getLlmProvider().chat(
        [
          {
            role: 'user',
            content:
              `Today's date: ${formatDay(new Date())}.\n` +
              `Here are transcript excerpts from the user's recordings of the last 24 hours:\n\n${excerpts}\n\n` +
              'Propose exactly 3 short questions (max 12 words each) the user could ask their personal memory AI about these memories. ' +
              'Write the questions in Greek (ελληνικά). ' +
              'Output ONLY a JSON array of 3 strings, e.g. ["Ερώτηση ένα;","Ερώτηση δύο;","Ερώτηση τρία;"]',
          },
        ],
        { temperature: 0.7 },
      );
      suggestions = parseSuggestionList(raw);
      if (suggestions.length === 0) suggestions = DEFAULT_SUGGESTIONS;
    } catch {
      suggestions = DEFAULT_SUGGESTIONS;
    }

    cache.set(userId, { at: Date.now(), suggestions });
    return { suggestions };
  });
}
