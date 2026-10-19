import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { expandWithVariants, loadTermsOrEmpty, mentions } from '../lib/glossary';
import { rankChunks } from '../lib/rag';
import { scanLiteral } from '../lib/scan';
import { queryStems } from '../lib/textmatch';
import { getLlmProvider } from '../providers';

const searchSchema = z.object({
  q: z.string().min(1).max(300),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // exact: literal matches only (fast, for typing). related: matches by meaning only.
  // all: both, for app versions that make a single request.
  mode: z.enum(['exact', 'related', 'all']).default('all'),
});

export type SearchParams = z.infer<typeof searchSchema>;

// Vector candidates handed to the model, which keeps the ones really about the query.
// Similarity alone separates poorly on short Greek queries, so it only gathers candidates.
const RELATED_CANDIDATES = 25;
// Model calls for related results per user per minute; typing triggers one per pause.
const RELATED_PER_MINUTE = 30;
const relatedCalls = new Map<string, number[]>();

function relatedAllowed(userId: string): boolean {
  const now = Date.now();
  const recent = (relatedCalls.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RELATED_PER_MINUTE) {
    relatedCalls.set(userId, recent);
    return false;
  }
  recent.push(now);
  relatedCalls.set(userId, recent);
  return true;
}
const MAX_RELATED = 10;

interface SearchResult {
  id: string;
  sessionId: string;
  text: string;
  startedAt: Date;
  endedAt: Date;
  score: number;
  /** exact: contains the words searched for. related: about the same thing, in other words. */
  match: 'exact' | 'related';
  /** [start, end) character ranges of the matched words, for highlighting. */
  highlights: Array<[number, number]>;
}

export default async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request) => {
    const params = searchSchema.parse(request.query);
    return { results: await searchMemories(request.userId, params) };
  });
}

/** Literal matches first, then passages that are about the same thing in other words. */
export async function searchMemories(userId: string, params: SearchParams): Promise<SearchResult[]> {
  const q = params.q.trim();
  const stems = queryStems(q);
  const range =
    params.from || params.to ? { from: params.from ?? new Date(0), to: params.to ?? new Date() } : null;

  const exact = async (): Promise<SearchResult[]> => {
    const words = q.split(/\s+/).filter(Boolean);
    const variantWords = expandWithVariants(words, await loadTermsOrEmpty(userId)).filter((w) => !words.includes(w));
    const [hits, variantHits] = await Promise.all([
      scanLiteral(userId, stems, {
        range,
        limit: params.limit,
        // With several words, most of them must appear; with one or two, all of them.
        minShare: stems.length <= 2 ? 1 : 2 / 3,
        phrase: q,
      }),
      // Other spellings of a name searched for: any one of them is a match.
      variantWords.length > 0
        ? scanLiteral(userId, queryStems(...variantWords), { range, limit: params.limit, minShare: 0 })
        : Promise.resolve([]),
    ]);
    const ids = new Set(hits.map((h) => h.id));
    // A name must appear as a whole word in any case form: "Μπατάρα" is not "μπαταρία".
    const named = variantHits.filter((h) => !ids.has(h.id) && variantWords.some((v) => mentions(h.text, v)));
    return [...hits, ...named.map((h) => ({ ...h, share: Math.min(h.share, 0.5) }))]
      .map((h) => ({
        id: h.id,
        sessionId: h.sessionId,
        text: h.text,
        startedAt: h.startedAt,
        endedAt: h.endedAt,
        score: 0.6 + 0.3 * h.share + (h.phrase ? 0.1 : 0),
        match: 'exact' as const,
        highlights: h.ranges,
      }))
      .sort((a, b) => b.score - a.score || b.startedAt.getTime() - a.startedAt.getTime());
  };

  const related = async (exclude: Set<string>): Promise<SearchResult[]> => {
    // Over the limit, exact results still work; related ones resume after a minute.
    if (!relatedAllowed(userId)) return [];
    try {
      const candidates = (await rankChunks(userId, q, [], range, RELATED_CANDIDATES + exclude.size))
        .filter((c) => !exclude.has(c.id))
        .slice(0, RELATED_CANDIDATES);
      if (candidates.length === 0) return [];
      const picked = await pickRelevant(q, candidates.map((c) => c.text));
      return picked.slice(0, MAX_RELATED).map((index, rank) => {
        const c = candidates[index]!;
        return {
          id: c.id,
          sessionId: c.sessionId,
          text: c.text,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          score: 0.5 - rank * 0.01,
          match: 'related' as const,
          highlights: c.ranges,
        };
      });
    } catch (err) {
      // Literal results are still useful if the embedding or model service is down.
      console.warn('[search] related search failed', err instanceof Error ? err.message : err);
      return [];
    }
  };

  if (params.mode === 'exact') return exact();
  if (params.mode === 'related') {
    // Leave out what the exact search already shows.
    const literal = await exact();
    return related(new Set(literal.map((r) => r.id)));
  }
  const literal = await exact();
  const extra = await related(new Set(literal.map((r) => r.id)));
  return [...literal, ...extra].slice(0, params.limit);
}

/** Indexes of the excerpts that are about the query, most relevant first. */
async function pickRelevant(q: string, texts: string[]): Promise<number[]> {
  const list = texts.map((t, i) => `${i + 1}. ${t.slice(0, 300).replace(/\s+/g, ' ')}`).join('\n');
  const raw = await getLlmProvider().chat(
    [
      {
        role: 'system',
        content:
          'You filter search results from a person\'s voice-note transcripts (mostly Greek). ' +
          'Keep an excerpt only if it is clearly about what the search means: the same thing in other words, ' +
          'a specific kind of it, or a named instance of it (e.g. "αμάξι" matches a car service, a car battery, ' +
          'a car model name; "φαγητό" matches a restaurant or a meal). Drop anything that merely shares a word, sounds similar or is loosely associated, and drop it when unsure. ' +
          'Output ONLY JSON: {"keep":[numbers, most relevant first]}. {"keep":[]} if none.',
      },
      { role: 'user', content: `Search: ${q}\n\nExcerpts:\n${list}` },
    ],
    { temperature: 0, json: true },
  );
  const keep = (JSON.parse(raw) as { keep?: unknown }).keep;
  if (!Array.isArray(keep)) return [];
  const seen = new Set<number>();
  return keep
    .map((n) => (typeof n === 'number' ? n - 1 : -1))
    .filter((i) => i >= 0 && i < texts.length && !seen.has(i) && (seen.add(i), true));
}
