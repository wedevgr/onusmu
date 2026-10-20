import { getLlmProvider } from '../providers';
import { normalizeText } from './textmatch';

/**
 * Questions to suggest in chat, each tied to a quote from the user's own recordings. A
 * question is kept only when its quote really is in the excerpts, so the app never suggests
 * asking about something the memory does not hold.
 */

export interface Excerpt {
  /** e.g. "Τρίτη 20 Οκτωβρίου 17:30"; lets questions use the right day words. */
  label: string;
  text: string;
}

const MAX_QUESTIONS = 3;
// A quote shorter than this proves little ("ναι", "το").
const MIN_QUOTE_CHARS = 12;

const SYSTEM = `You suggest questions a user can ask an assistant that answers only from their own voice-note transcripts (mostly Greek).
Output ONLY JSON: {"questions":[{"q":string,"quote":string}]}

- Every question must be fully answerable from the excerpts given, about something actually said in them: a person, place, task, money amount, plan or event.
- quote: the exact words from one excerpt that answer the question, copied character for character, at least a few words long.
- Never ask about anything not in the excerpts, general knowledge, advice, opinions, photos or files.
- Use day words only when they match the excerpt label (σήμερα only for today's excerpts, χθες for yesterday's); otherwise name the day or leave time out.
- Each question in Greek, short (max 9 words), all different. Fewer questions, or none, is better than one not answered by the excerpts.`;

/** The questions whose quote appears in the excerpts, ignoring case, accents and spacing. */
export function keepGrounded(raw: string, excerpts: Excerpt[], exclude: string[] = []): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];
  const squash = (s: string): string => normalizeText(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = squash(excerpts.map((e) => e.text).join('\n'));
  const skip = new Set(exclude.map(squash));
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { q, quote } = item as { q?: unknown; quote?: unknown };
    if (typeof q !== 'string' || typeof quote !== 'string') continue;
    const question = q.trim().slice(0, 80);
    const evidence = squash(quote);
    if (!question || evidence.length < MIN_QUOTE_CHARS || !haystack.includes(evidence)) continue;
    if (skip.has(squash(question)) || out.some((o) => squash(o) === squash(question))) continue;
    out.push(question);
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}

/** Up to three questions answerable from these excerpts; empty when there are none or on failure. */
export async function groundedQuestions(
  excerpts: Excerpt[],
  context: string,
  exclude: string[] = [],
): Promise<string[]> {
  if (excerpts.length === 0) return [];
  try {
    const raw = await getLlmProvider().chat(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${context}\n\nEXCERPTS:\n${excerpts.map((e, i) => `[${i + 1}] (${e.label}) ${e.text}`).join('\n')}`,
        },
      ],
      { temperature: 0.2, json: true },
    );
    return keepGrounded(raw, excerpts, exclude);
  } catch {
    return [];
  }
}
