import { getLlmProvider } from '../providers';
import type { ChatMessage } from '../providers/types';
import type { TimeRange } from './timeparse';
import { formatZoned, zonedToUtc } from './zonedtime';

/**
 * How to look for the answer to one chat question.
 * - moments: find the few passages that talk about something specific.
 * - period: read everything in the time window in order ("what did I do yesterday?").
 * - latest: read the most recent recording in full.
 */
export interface QueryPlan {
  /** The question rewritten to stand on its own, for vector search. */
  search: string;
  /** Distinctive words to match literally (names, places, things). */
  keywords: string[];
  range: TimeRange | null;
  scope: 'moments' | 'period' | 'latest';
  /** The question is about money, debts, tasks or tracked numbers: give the model the ledger. */
  ledger: boolean;
}

const SYSTEM = `You prepare a search over the user's own voice-recording transcripts (mostly Greek).
Given the conversation so far and the user's new message, output ONLY JSON:
{"search": string, "keywords": string[], "from": string|null, "to": string|null, "scope": "moments"|"period"|"latest", "ledger": boolean}

- search: the new message rewritten as a complete, standalone question in the user's language, with pronouns and follow-ups ("και μετά;", "τι άλλο;", "εκεί", "πες μου περισσότερα") resolved from the conversation. Keep its meaning and its time words exactly; only fill in what is missing.
- keywords: up to 6 distinctive words a matching transcript would literally contain (names, places, objects, topics), in the transcript's language, no stop words, no time words. When the message refers to a known name by its role ("ο μηχανικός", "η κόρη μου"), include that name. [] if none.
- from / to: the time window the message is about, as local time "YYYY-MM-DDTHH:mm", "to" exclusive. Resolve relative expressions from the current local time given below: σήμερα, χθες, προχθές, weekdays (the most recent past one; today if it is today), το πρωί (05:00-12:00), το μεσημέρι (12:00-16:00), το απόγευμα (12:00-19:00), το βράδυ (18:00-24:00), "πριν από 2 ώρες" (±1 hour), "αυτή την εβδομάδα" / "τις τελευταίες μέρες" (from 7 days ago to the current local time), "την προηγούμενη εβδομάδα" (the previous Monday to Sunday), "αυτόν τον μήνα", dates like "5 Οκτωβρίου" or "5/10". A follow-up keeps the window of the question it follows unless it names a new one. null/null when no time is implied.
- scope: "period" when the user wants an account or summary of everything in a time window (τι έκανα χθες / τι συζήτησα σήμερα / πώς πήγε η μέρα μου) and from/to are set; "latest" when they ask about their most recent recording; otherwise "moments" (any question about a specific thing, person, amount or event, with or without a time window).
- ledger: true when answering needs the user's money or task records: spending, costs, income, debts, payments due, totals, open, repeating or finished tasks (εκκρεμότητες), recurring payments (πάγια, ενοίκιο, λογαριασμοί κάθε μήνα), or a tracked number like a car's kilometres; otherwise false.`;

interface RawPlan {
  search?: unknown;
  keywords?: unknown;
  from?: unknown;
  to?: unknown;
  scope?: unknown;
  ledger?: unknown;
}

function fallbackPlan(question: string): QueryPlan {
  return { search: question, keywords: [], range: null, scope: 'moments', ledger: false };
}

export async function planQuery(
  question: string,
  history: ChatMessage[],
  timezone: string,
  now: Date = new Date(),
  knownNames = '',
): Promise<QueryPlan> {
  const conversation = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  let parsed: RawPlan;
  try {
    const raw = await getLlmProvider().chat(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content:
            `Current local time: ${formatZoned(now, timezone)}\n\n` +
            (knownNames ? `Names the user often mentions (use these spellings in keywords):\n${knownNames}\n\n` : '') +
            (conversation ? `Conversation so far:\n${conversation}\n\n` : '') +
            `New message: ${question}`,
        },
      ],
      { temperature: 0, json: true },
    );
    parsed = JSON.parse(raw) as RawPlan;
  } catch (err) {
    console.error('[planner] failed, searching with the raw question', err instanceof Error ? err.message : err);
    return fallbackPlan(question);
  }

  const search = typeof parsed.search === 'string' && parsed.search.trim() ? parsed.search.trim() : question;
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 1)
        .map((k) => k.trim())
        .slice(0, 6)
    : [];

  const from = typeof parsed.from === 'string' ? zonedToUtc(parsed.from, timezone) : null;
  const to = typeof parsed.to === 'string' ? zonedToUtc(parsed.to, timezone) : null;
  let range: TimeRange | null = null;
  if (from && to && to > from) range = { from, to };
  else if (from && !to) range = { from, to: now };

  // Reading a whole period needs a period; without one, look for the moments instead.
  const scope =
    parsed.scope === 'latest' ? 'latest' : parsed.scope === 'period' && range ? 'period' : 'moments';
  return { search, keywords, range, scope, ledger: parsed.ledger === true };
}
