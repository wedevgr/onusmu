import { config } from '../config';
import { query } from '../db';
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

export async function retrieveMemories(
  userId: string,
  question: string,
  range: TimeRange | null,
  limit = 12,
): Promise<RetrievedChunk[]> {
  const [embedding] = await getEmbeddingProvider().embed([question]);
  const vector = `[${embedding.join(',')}]`;
  const rows = await query<MatchRow>(
    `SELECT * FROM match_chunks($1, $2::vector, $3, $4::timestamptz, $5::timestamptz, $6)`,
    [
      userId,
      vector,
      question,
      range ? range.from.toISOString() : null,
      range ? range.to.toISOString() : null,
      limit,
    ],
  );
  return rows.map((r) => ({
    chunkId: r.id,
    sessionId: r.session_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    text: r.text,
    score: typeof r.score === 'string' ? parseFloat(r.score) : r.score,
  }));
}

const SYSTEM_PROMPT = `You are the user's personal memory. You answer questions using ONLY the transcript excerpts provided below.

Rules:
- Each excerpt is labeled [CHUNK n | date | start-end]. Refer to concrete times and dates in your answer (e.g. "yesterday around 14:32").
- If the excerpts do not contain the answer, say clearly that you do not have that memory. Never invent facts.
- Be concise. Answer in the same language the user writes in.`;

export async function answerWithRag(
  userId: string,
  question: string,
  range: TimeRange | null,
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
