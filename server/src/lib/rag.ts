import { config } from '../config';
import { query } from '../db';
import { ctx, decryptText } from './crypto';
import { formatClock, formatDay, type TimeRange } from './timeparse';
import { getEmbeddingProvider, getLlmProvider } from '../providers';
import type { ChatMessage } from '../providers/types';

export interface RetrievedChunk {
  chunkId: string;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  text: string;
  score: number;
}

export interface Citation {
  chunkId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  score: number;
}

interface MatchRow {
  id: string;
  session_id: string;
  text: string;
  started_at: Date;
  ended_at: Date;
  score: number;
}

/** Case- and accent-insensitive form used for keyword matching on decrypted text. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Transcript text is encrypted at rest, so Postgres can only rank by vector
 * similarity. We over-fetch candidates, decrypt them here and apply the keyword
 * part of the hybrid score in memory:
 *   0.75 * cosine similarity + 0.25 * share of query terms present + 0.1 exact-phrase bonus
 */
export async function retrieveMemories(
  userId: string,
  question: string,
  range: TimeRange | null,
  limit = 12,
): Promise<RetrievedChunk[]> {
  const [embedding] = await getEmbeddingProvider().embed([question]);
  const vector = `[${embedding.join(',')}]`;
  const rows = await query<MatchRow>(
    `SELECT * FROM match_chunks($1, $2::vector, $3::timestamptz, $4::timestamptz, $5)`,
    [
      userId,
      vector,
      range ? range.from.toISOString() : null,
      range ? range.to.toISOString() : null,
      limit * 3,
    ],
  );

  const phrase = normalizeText(question).trim();
  const terms = [...new Set(phrase.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 4))];

  return rows
    .map((r) => {
      const text = decryptText(r.text, ctx.chunkText(userId, r.id));
      const haystack = normalizeText(text);
      const similarity = typeof r.score === 'string' ? parseFloat(r.score) : r.score;
      const termShare =
        terms.length > 0 ? terms.filter((t) => haystack.includes(t)).length / terms.length : 0;
      const phraseBonus = phrase.length > 0 && haystack.includes(phrase) ? 0.1 : 0;
      return {
        chunkId: r.id,
        sessionId: r.session_id,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        text,
        score: 0.75 * similarity + 0.25 * termShare + phraseBonus,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const SYSTEM_PROMPT = `You are the user's personal memory. You answer questions using ONLY the transcript excerpts provided below.

Rules:
- Each excerpt is labeled [CHUNK n | date | start-end]. Refer to concrete times and dates in your answer (e.g. "yesterday around 14:32").
- If the excerpts do not contain the answer, say clearly that you do not have that memory. Never invent facts.
- The messages before the question are the recent conversation history — use them to interpret follow-ups (e.g. "what else?", "and then?", "tell me more about that").
- Be concise. Answer in the same language the user writes in.`;

export async function answerWithRag(
  userId: string,
  question: string,
  range: TimeRange | null,
  history: ChatMessage[] = [],
): Promise<{ answer: string; citations: Citation[] }> {
  const chunks = await retrieveMemories(userId, question, range);

  const context = chunks
    .map(
      (c, i) =>
        `[CHUNK ${i + 1} | ${formatDay(c.startedAt)} | ${formatClock(c.startedAt)}-${formatClock(c.endedAt)}]\n${c.text}`,
    )
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content: `Memories:\n\n${context || '(no relevant memories found)'}\n\nToday's date: ${formatDay(new Date())}\n\nQuestion: ${question}`,
    },
  ];

  const answer = await getLlmProvider().chat(messages, { temperature: 0.2 });

  const citations: Citation[] = chunks.map((c) => ({
    chunkId: c.chunkId,
    sessionId: c.sessionId,
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt.toISOString(),
    text: c.text,
    score: Math.round(c.score * 1000) / 1000,
  }));

  return { answer, citations };
}

export function assertEmbeddingDim(dim: number): void {
  if (dim !== config.EMBEDDING_DIM) {
    throw new Error(`Embedding dim mismatch: model returned ${dim}, expected ${config.EMBEDDING_DIM}`);
  }
}
