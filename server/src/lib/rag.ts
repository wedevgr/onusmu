import { config } from '../config';
import { query, queryOne } from '../db';
import { ctx, decryptText } from './crypto';
import { planQuery, type QueryPlan } from './planner';
import { matchText, queryStems } from './textmatch';
import type { TimeRange } from './timeparse';
import { describeTerms, expandWithVariants, loadTermsOrEmpty, topTerms, type Term } from './glossary';
import { buildLedger, type Ledger } from './ledger';
import { scanLiteral } from './scan';
import { formatZonedClock, formatZonedGreek } from './zonedtime';
import { groundedQuestions } from './groundedQuestions';
import { getEmbeddingProvider, getLlmProvider } from '../providers';
import type { ChatMessage } from '../providers/types';

export interface Citation {
  chunkId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  score: number;
}

/** A stretch of one recording: one or more consecutive chunks, read as one excerpt. */
export interface Passage {
  sessionId: string;
  /** The chunk to open in the timeline for this passage. */
  anchorChunkId: string;
  startedAt: Date;
  endedAt: Date;
  text: string;
  score: number;
}

interface ChunkRow {
  id: string;
  session_id: string;
  text: string;
  started_at: Date;
  ended_at: Date;
}

interface Piece {
  id: string;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  text: string;
}

interface ScoredPiece extends Piece {
  score: number;
}

// Candidates fetched by vector similarity before the keyword part of the score re-ranks them.
const CANDIDATES = 48;
// Best matches kept as passage anchors.
const MAX_HITS = 8;
// A hit far below the best one is noise, not a second source.
const HIT_SCORE_MARGIN = 0.18;
// Text the answer model reads at most, so a long day still fits with room for the answer.
const MOMENTS_CHAR_BUDGET = 16000;
const OVERVIEW_CHAR_BUDGET = 48000;
// Chunks further apart than this are separate passages even in the same recording.
const PASSAGE_GAP_MS = 20_000;
// Longest passage in an overview, so sources stay specific enough to be useful.
const PASSAGE_MAX_CHUNKS = 8;

export async function getUserTimezone(userId: string): Promise<string> {
  const row = await queryOne<{ timezone: string | null }>(
    `SELECT timezone FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  return row?.timezone ?? config.BILLING_TIMEZONE;
}

function decryptRow(userId: string, row: ChunkRow): Piece {
  return {
    id: row.id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    text: decryptText(row.text, ctx.chunkText(userId, row.id)),
  };
}

/**
 * Transcript text is encrypted at rest, so Postgres ranks by vector similarity only. The
 * candidates are decrypted here and re-ranked with the literal match:
 *   0.7 * cosine similarity + 0.3 * share of query stems present + 0.1 exact-phrase bonus
 */
export async function rankChunks(
  userId: string,
  searchText: string,
  keywords: string[],
  range: TimeRange | null,
  limit = CANDIDATES,
): Promise<Array<ScoredPiece & { ranges: Array<[number, number]>; literal: boolean; similarity: number }>> {
  const [embedding] = await getEmbeddingProvider().embed([searchText]);
  const rows = await query<ChunkRow & { score: number | string }>(
    `SELECT * FROM match_chunks($1, $2::vector, $3::timestamptz, $4::timestamptz, $5)`,
    [
      userId,
      `[${embedding.join(',')}]`,
      range ? range.from.toISOString() : null,
      range ? range.to.toISOString() : null,
      limit,
    ],
  );

  const stems = queryStems(searchText, ...keywords);
  return rows
    .map((row) => {
      const piece = decryptRow(userId, row);
      const similarity = typeof row.score === 'string' ? parseFloat(row.score) : row.score;
      const match = matchText(piece.text, stems, searchText);
      return {
        ...piece,
        similarity,
        literal: match.share > 0,
        ranges: match.ranges,
        score: 0.7 * similarity + 0.3 * match.share + (match.phrase ? 0.1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Groups chunks of one recording that follow each other into passages. */
function toPassages(pieces: Piece[], scoreOf: (piece: Piece) => number, maxChunks = Infinity): Passage[] {
  const sorted = [...pieces].sort(
    (a, b) => a.sessionId.localeCompare(b.sessionId) || a.startedAt.getTime() - b.startedAt.getTime(),
  );
  const groups: Piece[][] = [];
  for (const piece of sorted) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    const continues =
      group !== undefined &&
      last !== undefined &&
      last.sessionId === piece.sessionId &&
      piece.startedAt.getTime() - last.endedAt.getTime() <= PASSAGE_GAP_MS &&
      group.length < maxChunks;
    if (continues) group.push(piece);
    else groups.push([piece]);
  }
  return groups.map((group) => {
    const first = group[0]!;
    const best = group.reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a));
    return {
      sessionId: first.sessionId,
      anchorChunkId: best.id,
      startedAt: first.startedAt,
      endedAt: group[group.length - 1]!.endedAt,
      text: group.map((p) => p.text.trim()).filter(Boolean).join(' '),
      score: Math.max(...group.map(scoreOf)),
    };
  });
}

function withinBudget(passages: Passage[], budget: number): Passage[] {
  const kept: Passage[] = [];
  let used = 0;
  for (const passage of passages) {
    if (used + passage.text.length > budget && kept.length > 0) break;
    kept.push(passage);
    used += passage.text.length;
  }
  return kept;
}

/** The best matching chunks, each with the chunk before and after it in the same recording. */
async function findMoments(userId: string, plan: QueryPlan, terms: Term[]): Promise<Passage[]> {
  // Vector search alone can miss a note that names the thing asked about, so the keywords
  // are also matched literally across all recordings in the window.
  const [ranked, literal] = await Promise.all([
    rankChunks(userId, plan.search, plan.keywords, plan.range),
    // Misheard spellings of a name ("Μπατάρα" for "Πατάρας") count as the name.
    scanLiteral(userId, queryStems(...expandWithVariants(plan.keywords, terms)), {
      range: plan.range,
      limit: MAX_HITS,
      minShare: 0,
    }),
  ]);
  const scores = new Map<string, number>();
  for (const c of ranked) scores.set(c.id, c.score);
  for (const h of literal) scores.set(h.id, Math.max(scores.get(h.id) ?? 0, 0.45 + 0.3 * h.share));
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  if (!best) return [];
  const hits = sorted.filter(([, score]) => score >= best[1] - HIT_SCORE_MARGIN).slice(0, MAX_HITS);
  const hitScore = new Map(hits);

  // A 45-second chunk often starts or ends mid-sentence; its neighbours complete it.
  const rows = await query<ChunkRow>(
    `SELECT DISTINCT c.id, c.session_id, c.text, c.started_at, c.ended_at
     FROM transcript_chunks h
     JOIN transcript_chunks c
       ON c.session_id = h.session_id
      AND c.user_id = h.user_id
      AND c.started_at BETWEEN h.started_at - interval '60 seconds' AND h.ended_at + interval '15 seconds'
     WHERE h.user_id = $1 AND h.id = ANY($2::uuid[]) AND c.text <> ''`,
    [userId, hits.map(([id]) => id)],
  );
  const pieces = rows.map((row) => decryptRow(userId, row));
  const passages = toPassages(pieces, (p) => hitScore.get(p.id) ?? 0).sort((a, b) => b.score - a.score);
  return withinBudget(passages, MOMENTS_CHAR_BUDGET);
}

/** Everything said in the period, or in the latest recording, in order. */
async function readPeriod(userId: string, plan: QueryPlan): Promise<Passage[]> {
  const rows = plan.scope === 'period' && plan.range
    ? await query<ChunkRow>(
        `SELECT id, session_id, text, started_at, ended_at FROM transcript_chunks
         WHERE user_id = $1 AND text <> '' AND started_at >= $2 AND started_at < $3
         ORDER BY started_at LIMIT 1500`,
        [userId, plan.range.from.toISOString(), plan.range.to.toISOString()],
      )
    : await query<ChunkRow>(
        `SELECT id, session_id, text, started_at, ended_at FROM transcript_chunks
         WHERE user_id = $1 AND text <> '' AND session_id = (
           SELECT session_id FROM transcript_chunks
           WHERE user_id = $1 AND text <> '' ORDER BY started_at DESC LIMIT 1)
         ORDER BY started_at LIMIT 1500`,
        [userId],
      );
  const pieces = rows.map((row) => decryptRow(userId, row));
  const total = pieces.reduce((sum, p) => sum + p.text.length, 0);

  if (total <= OVERVIEW_CHAR_BUDGET) {
    return toPassages(pieces, () => 1, PASSAGE_MAX_CHUNKS).sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );
  }

  // Too much to read in full: keep what is closest to the question, then restore the order.
  const ranked = await rankChunks(userId, plan.search, plan.keywords, plan.range, 200);
  const score = new Map(ranked.map((c) => [c.id, c.score]));
  const chosen: Piece[] = [];
  let used = 0;
  for (const c of ranked) {
    if (used + c.text.length > OVERVIEW_CHAR_BUDGET) break;
    chosen.push(c);
    used += c.text.length;
  }
  return toPassages(chosen, (p) => score.get(p.id) ?? 0, PASSAGE_MAX_CHUNKS).sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );
}

export async function retrievePassages(userId: string, plan: QueryPlan, terms: Term[] = []): Promise<Passage[]> {
  return plan.scope === 'moments' ? findMoments(userId, plan, terms) : readPeriod(userId, plan);
}

const SYSTEM_PROMPT = `You are the user's personal memory. You answer from transcript excerpts of their own voice recordings, and from nothing else.

Each excerpt is labeled [n] with the local day and time it was recorded.
- Base every statement on the excerpts. Put the excerpt number right after each fact, like [2] or [1][3].
- Records may be given: expenses, income, debts and readings taken from the recordings, each labeled [F n], with totals already calculated, plus open and finished tasks. For amounts, sums, debts, tasks and latest readings, use the records and their totals exactly as given; never add numbers up yourself. Cite records like [F2]. Mention who paid when someone else did.
- Recordings also pick up other people, calls, TV and radio. Say who said something when the excerpt makes it clear; do not assume everything was said by the user.
- Mention when things happened ("χθες γύρω στις 17:30", "την Τετάρτη 14 Οκτωβρίου το απόγευμα"). Copy the day, date and weekday from the excerpt label; never work out a weekday yourself.
- Speak to the user in the second person ("χρωστάς", "πήγες"), even when the excerpt is their own words in the first person.
- For a summary of a period, go in time order and group by part of the day.
- If the excerpts do not answer the question, say so plainly in one sentence, mention the period you searched if there was one, and do not guess.
- Never add advice, tips, ideas, next steps or anything else of your own ("μπορείς επίσης να…", "καλό θα ήταν…", "θέλεις να…;"). Only tell what the recordings and records say.
- A list of names the user often mentions may be given; use it to say who or what someone is, but take facts only from the excerpts.
- Earlier messages are the conversation so far; use them to understand follow-up questions.
- Be concise and natural. Plain text only: no markdown, no headings, no bold. Short lines starting with "- " are fine for lists.
- Answer in the language the user writes in.`;

/** "σήμερα", "χθες", "προχθές" or "πριν 5 μέρες", counted in calendar days in the timezone. */
function daysAgo(instant: Date, now: Date, timezone: string): string {
  const day = (d: Date): number => {
    const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d).split('-').map(Number);
    return Date.UTC(y!, m! - 1, dd!) / 86400000;
  };
  const n = day(now) - day(instant);
  return n <= 0 ? 'σήμερα' : n === 1 ? 'χθες' : n === 2 ? 'προχθές' : `πριν ${n} μέρες`;
}

/** A source an answer can point to: an excerpt [n] or a ledger record [F n]. */
interface Source {
  chunkId: string;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  text: string;
  score: number;
}

/** Turns "[2][3]" and "[F1]" markers into a list of sources and removes them from the text. */
export function extractCitations(
  answer: string,
  passages: Passage[],
  ledger: Ledger | null,
): { text: string; used: Source[] } {
  const used: Source[] = [];
  const seen = new Set<string>();
  const add = (key: string, source: Source | undefined): void => {
    // Several records from one recording are one source.
    if (!source || seen.has(key) || seen.has(source.chunkId)) return;
    seen.add(key);
    seen.add(source.chunkId);
    used.push(source);
  };
  for (const match of answer.matchAll(/\[(F?\d+(?:\s*,\s*F?\d+)*)\]/g)) {
    for (const ref of (match[1] ?? '').split(',').map((s) => s.trim())) {
      if (ref.startsWith('F')) {
        const n = parseInt(ref.slice(1), 10);
        const s = ledger?.sources[n - 1];
        add(ref, s && { ...s, text: '', score: 1 });
      } else {
        const p = passages[parseInt(ref, 10) - 1];
        add(ref, p && { chunkId: p.anchorChunkId, sessionId: p.sessionId, startedAt: p.startedAt, endedAt: p.endedAt, text: p.text, score: p.score });
      }
    }
  }
  const text = answer
    .replace(/\s*\[F?\d+(?:\s*,\s*F?\d+)*\]/g, '')
    .replace(/[ \t]+([.,;:!?·])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, used };
}

export interface AnswerHandlers {
  /** A short Greek line on what is happening, for the wait before the first words. */
  onStatus?: (text: string) => void;
  /** Each piece of the answer as it is written (still containing [n] source markers). */
  onDelta?: (text: string) => void;
}

/** What the search covers, e.g. "Ψάχνω στις καταγραφές από Δευτέρα 12/10 έως σήμερα…". */
function searchingLine(plan: QueryPlan, timezone: string, now: Date): string {
  if (plan.scope === 'latest') return 'Διαβάζω την τελευταία σου καταγραφή…';
  const what = plan.ledger ? 'στα έξοδα και τις εκκρεμότητές σου' : 'στις καταγραφές σου';
  if (!plan.range) return `Ψάχνω ${what}…`;
  const day = (d: Date): string =>
    new Intl.DateTimeFormat('el-GR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'numeric' }).format(d);
  const sameDay = (a: Date, b: Date): boolean => day(a) === day(b);
  const end = new Date(plan.range.to.getTime() - 1);
  const to = sameDay(end, now) ? 'σήμερα' : day(end);
  return sameDay(plan.range.from, end)
    ? `Ψάχνω ${what}: ${to}…`
    : `Ψάχνω ${what} από ${day(plan.range.from)} έως ${to}…`;
}

/** Answers a question from the user's recordings, optionally streaming progress and text. */
export async function answerWithRag(
  userId: string,
  question: string,
  history: ChatMessage[] = [],
  handlers: AnswerHandlers = {},
): Promise<{ answer: string; citations: Citation[]; plan: QueryPlan }> {
  const { onDelta, onStatus } = handlers;
  const [timezone, terms] = await Promise.all([getUserTimezone(userId), loadTermsOrEmpty(userId)]);
  const known = describeTerms(topTerms(terms, 40));
  const now = new Date();
  onStatus?.('Καταλαβαίνω την ερώτηση…');
  const plan = await planQuery(question, history, timezone, now, known);
  onStatus?.(searchingLine(plan, timezone, now));
  const [passages, ledger] = await Promise.all([
    retrievePassages(userId, plan, terms),
    plan.ledger ? buildLedger(userId, plan.range, timezone, now) : Promise.resolve(null),
  ]);

  const context = passages
    .map(
      (p, i) =>
        `[${i + 1}] ${formatZonedGreek(p.startedAt, timezone)}-${formatZonedClock(p.endedAt, timezone)} (${daysAgo(p.startedAt, now, timezone)})\n${p.text}`,
    )
    .join('\n\n');
  const searched =
    plan.scope === 'latest'
      ? 'the most recent recording'
      : plan.range
        ? `${formatZonedGreek(plan.range.from, timezone)} έως ${formatZonedGreek(plan.range.to, timezone)}`
        : 'all recordings';

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content:
        `Current local time: ${formatZonedGreek(now, timezone)}\n` +
        `Searched: ${searched}\n\n` +
        (known ? `Names the user often mentions, and what they are:\n${known}\n\n` : '') +
        (ledger ? `Records:\n${ledger.text}\n\n` : '') +
        `Excerpts:\n\n${context || '(nothing found)'}\n\n` +
        `Question: ${question}`,
    },
  ];

  const raw = onDelta
    ? await getLlmProvider().chatStream(messages, onDelta, { temperature: 0.2 })
    : await getLlmProvider().chat(messages, { temperature: 0.2 });
  const { text, used } = extractCitations(raw, passages, ledger);

  const citations: Citation[] = used.map((p) => ({
    chunkId: p.chunkId,
    sessionId: p.sessionId,
    startedAt: p.startedAt.toISOString(),
    endedAt: p.endedAt.toISOString(),
    text: p.text.slice(0, 500),
    score: Math.round(p.score * 1000) / 1000,
  }));

  return { answer: text, citations, plan };
}

export function assertEmbeddingDim(dim: number): void {
  if (dim !== config.EMBEDDING_DIM) {
    throw new Error(`Embedding dim mismatch: model returned ${dim}, expected ${config.EMBEDDING_DIM}`);
  }
}

/**
 * Up to three questions to ask next, each answerable from the recordings this answer cited.
 * None when the answer found nothing, so the app never points at things the memory lacks.
 */
export async function suggestFollowUps(
  userId: string,
  question: string,
  answer: string,
  citations: Citation[],
): Promise<string[]> {
  if (citations.length === 0) return [];
  const timezone = await getUserTimezone(userId);
  const excerpts = citations.map((c) => ({ label: formatZonedGreek(new Date(c.startedAt), timezone), text: c.text }));
  return groundedQuestions(
    excerpts,
    `The user asked: ${question}
The assistant answered: ${answer.slice(0, 1000)}
` +
      `Today is ${formatZonedGreek(new Date(), timezone)}. Suggest follow-up questions about other details in these excerpts that the answer did not already give.`,
    [question],
  );
}
