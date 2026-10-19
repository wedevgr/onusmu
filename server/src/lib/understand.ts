import { randomUUID } from 'node:crypto';
import { pool, query, queryOne } from '../db';
import { config } from '../config';
import { getLlmProvider } from '../providers';
import { ctx, decryptText, encryptText } from './crypto';
import {
  doneInsight,
  factInsight,
  saveInsights,
  settledInsight,
  stoppedInsight,
  taskInsight,
  type Insight,
} from './insights';
import { normalizeText, queryStems } from './textmatch';
import { completeReminder } from './reminderOps';
import { describeRepeat, localDay, nextOccurrence, parseRepeat, type Repeat } from './recurrence';
import { formatZoned, zonedToUtc } from './zonedtime';

/**
 * Turns a freshly transcribed chunk into structured data, in one model call:
 * - reminders: things the speaker needs to do,
 * - done: open tasks the speaker says are finished or asks to remove ("διέγραψέ το"),
 * - settled: open debts or money owed to the speaker that the speaker says are paid,
 * - facts: money spent, received, owed or owed to the speaker, and measurements (a car's mileage).
 * Best effort: callers should not fail the chunk if this throws.
 */

const MAX_REMINDERS = 3;
const MAX_FACTS = 6;
const MAX_TEXT_LENGTH = 200;
// Open tasks and debts shown to the model so it can tell which one a "done" refers to.
const OPEN_TASKS = 40;
const OPEN_DEBTS = 20;

// Chunks with none of these skip the model call: most speech is not about tasks or money.
// Matched on accent-free lower case.
const TRIGGERS = [
  // tasks
  'θυμ', 'ξεχασ', 'ξεχνα', 'πρεπει', 'χρειαζεται να', 'ραντεβου', 'αυριο', 'μεθαυριο', 'εκκρεμ', 'κρεμοτ',
  'να παρω', 'να στειλω', 'να αγορασω', 'να πληρωσω', 'να κλεισω', 'να φερω', 'προθεσμια', 'σημειωσε', 'βαλε',
  // done
  'διεγραψ', 'σβησ', 'ακυρωσ', 'το εκανα', 'εγινε', 'πληρωσα', 'εχω πληρωσει', 'το πηρα', 'αγορασα', 'εχω αγορασει',
  'εχω αφησει', 'τελειωσ',
  // repeating, and stopping a repeat
  'καθε ', 'καθημεριν', 'σταματα', 'μη μου θυμιζ', 'μην μου θυμιζ', 'δεν χρειαζεται πια',
  // money and readings
  'ευρω', '€', 'χρωστ', 'πληρω', 'εδωσα', 'κοστισ', 'δανει', 'καρτα', 'χιλιομετρ', 'πηρα',
  'remind', 'forget', 'need to', 'have to', 'tomorrow', 'appointment', 'deadline', 'paid', 'owe',
];

// Stems of verbs and words every task or payment shares; matching on them alone would close
// the wrong task ("πλήρωσα την ΕΙΝΑΛΑΝ" must not close "Πλήρωσε το ρεύμα").
const GENERIC_STEMS = [
  'πληρω', 'πληρωσ', 'αγορα', 'αγορασ', 'παρε', 'πηρ', 'παρω', 'πηγα', 'πηγαιν', 'βαλε', 'βαλω', 'στειλ',
  'φερε', 'φερω', 'κλεισ', 'τηλεφων', 'κανε', 'εκαν', 'αφησ', 'δωσε', 'εδωσ', 'ευρω', 'εκκρεμ', 'διεγραψ',
  'σβησ', 'χρωστ', 'πρεπ', 'σημερ', 'αυρι', 'ενα', 'μια',
];

/** Whether the transcript mentions what the task or debt is about, not just a common verb. */
export function sharesSubject(label: string, transcript: string): boolean {
  const hay = normalizeText(transcript);
  const words = hay.split(/[^\p{L}\p{N}]+/u);
  return queryStems(label)
    .filter((stem) => !GENERIC_STEMS.some((g) => stem.startsWith(g) || g.startsWith(stem)))
    .some((stem) => (/^\d+$/.test(stem) ? hay.includes(stem) : words.some((w) => w.startsWith(stem))));
}

export function worthUnderstanding(text: string): boolean {
  const normalized = normalizeText(text);
  return /\d/.test(normalized) || TRIGGERS.some((trigger) => normalized.includes(trigger));
}

export type FactKind = 'expense' | 'income' | 'debt' | 'receivable' | 'measure';

export const CATEGORIES = [
  'αυτοκίνητο', 'φαγητό', 'σούπερ μάρκετ', 'λογαριασμοί', 'σπίτι', 'υγεία', 'δουλειά',
  'ψώνια', 'μετακινήσεις', 'διασκέδαση', 'οικογένεια', 'άλλο',
] as const;

/** The encrypted part of a fact. */
export interface FactData {
  text: string;
  /** expense and income: one of CATEGORIES. */
  category?: string | null;
  amount: number | null;
  currency: string | null;
  who: string | null;
  /** expense: who paid. "other" means someone paid for the speaker. */
  paidBy: 'me' | 'other' | null;
  item: string | null;
  value: number | null;
  unit: string | null;
  /** debt or receivable: the speaker later said it is paid. */
  settled?: boolean;
}

interface ParsedReminder {
  text: string;
  due: string | null;
  explicit: boolean;
  /** Raw repeat rule from the model; checked by parseRepeat. */
  repeat: unknown;
}

interface ParsedFact extends FactData {
  kind: FactKind;
  when: string | null;
  due: string | null;
  repeat: unknown;
}

interface Parsed {
  reminders: ParsedReminder[];
  done: number[];
  /** Open tasks the speaker asks to stop reminding them of. */
  stopped: number[];
  settled: number[];
  facts: ParsedFact[];
}

const SYSTEM = `You read one excerpt of the user's own voice notes (usually Greek) and turn it into structured data.
Recordings can include other people, TV or radio: only take what the speaker says about their own life.
Only use the CURRENT excerpt. The PREVIOUS excerpt was already processed: use it only to complete a sentence cut in half, and never output its tasks or facts again.

Output ONLY JSON:
{"reminders":[{"text":string,"due":string|null,"explicit":boolean,"repeat":object|null}],
 "done":[number],
 "stopped":[number],
 "settled":[number],
 "facts":[{"kind":"expense"|"income"|"debt"|"receivable"|"measure","text":string,"category":string|null,"amount":number|null,"currency":string|null,"who":string|null,"paidBy":"me"|"other"|null,"when":string|null,"due":string|null,"item":string|null,"value":number|null,"unit":string|null,"repeat":object|null}]}

reminders: tasks for the speaker themselves: an explicit request ("θύμισέ μου", "βάλε εκκρεμότητα", "σημείωσε ότι πρέπει") or a first-person intention or obligation ("πρέπει να…", "να μην ξεχάσω να…").
- Not tasks for other people, not things already done, not hypotheticals, nothing vague, and not opinions or resolutions ("δεν θα ξαναπάρω μπίρα εδώ").
- A sentence whose subject is someone else is their task, not the speaker's: "Η Θεοδόρα τη Δευτέρα πρέπει να πάει σχολείο" is not a reminder. Only make it one if the speaker has to do something about it ("να πάω τη Θεοδόρα στο σχολείο").
- text: a short Greek to-do (max 12 words) starting with an imperative verb, without "θύμισέ μου", "πρέπει να" or the time, e.g. "Πλήρωσε το ρεύμα", "Πάρε ένα κουτί Diabetol Forte".
- due: resolve any time relative to the recording time, local "YYYY-MM-DDTHH:mm"; a weekday means the next such day after the recording day (the same day only if it says "σήμερα"); a day without a time is 09:00; no time is null.
- explicit: true only when the speaker directly asks for it to be noted or reminded ("βάλε εκκρεμότητα", "εκκρεμότητα να…", "θύμισέ μου", "σημείωσε"); a plain "πρέπει να…" is false.
- If the same task is already in OPEN TASKS, do not add it again (a repeating one is already there for every occurrence).
- repeat: when the task recurs ("κάθε Δευτέρα", "κάθε πρωί", "τις καθημερινές", "κάθε 15 του μήνα", "κάθε δύο εβδομάδες", "κάθε Τρίτη μέχρι τέλος Δεκεμβρίου"), an object
  {"freq":"daily"|"weekly"|"monthly"|"yearly","interval":number,"days":["MO","TU","WE","TH","FR","SA","SU"],"monthDay":number|null,"month":number|null,"time":"HH:mm","until":"YYYY-MM-DD"|null}.
  days only for weekly ("τις καθημερινές" = MO-FR); monthDay for monthly and yearly; interval 2 for "κάθε δύο"; time 09:00 if none is said. Otherwise null. A one-off task is never repeating.

done: numbers from OPEN TASKS that the speaker says are done, paid, bought, delivered or handled, or asks to delete, remove or cross off ("Έχω πληρώσει την ΕΙΝΑΛΑΝ, διέγραψέ το", "Το πήρα το φάρμακο"). Only when it clearly means that task.

stopped: numbers from OPEN TASKS the speaker asks to stop: "σταμάτα να μου θυμίζεις τα σκουπίδια", "δεν χρειάζεται πια το φάρμακο κάθε πρωί". Only when it clearly means that task.

settled: numbers from OPEN MONEY that is now paid, by the speaker or to the speaker ("μου έδωσε η Ανθή τα 40 ευρώ", "πλήρωσα την κάρτα").

facts:
- expense: money already spent by or for the speaker. who = the shop, business or person paid; paidBy "me", or "other" when someone else paid for the speaker ("πλήρωσε η μάνα μου").
- income: money the speaker has already received.
- debt: money the speaker owes or must pay or deposit (card balances, bills, loans). who = creditor or card; due when said ("μέχρι τις 23 Οκτώβρη" -> "YYYY-10-23T09:00"). When the excerpt sets a deadline for paying it off ("χρωστάω 77,54€, πρέπει να βάλω 100€ μέχρι τις 20"), that deadline is the debt's due.
- due and when are local "YYYY-MM-DDTHH:mm", resolved from the recording time like reminder due dates.
- receivable: money someone owes the speaker or will pay them ("μου χρωστάει", "πρέπει να μου δώσει", "θα μου δώσει"). who = the person or customer who owes it; due when said.
- The speaker may sell goods: an order sent or delivered to a customer is not an expense; it is income if paid, or receivable if payment is still to come. Promised or future payments are never income or expense.
- measure: a reading worth tracking over time: item (e.g. "Χιλιόμετρα Auris"), value, unit ("km").
- text: a short Greek description, e.g. "Σέρβις Auris (λάδια, φίλτρο)", "Πίτσα και μπίρα στη Φούνκι".
- category (expense and income only): one of ${CATEGORIES.join(', ')}. Anything for a vehicle (service, fuel, battery, tyres, parking, tolls) is "αυτοκίνητο"; a vehicle can be named only by its model (Auris, Avensis). Restaurants, cafés and takeaway are "φαγητό". Null for other kinds.
- amount as a number ("77,54€" -> 77.54, "εβδομήντα" -> 70); currency "EUR" unless another is named.
- when: only if it happened on another day or time than the recording ("χθες πλήρωσα"), else null.
- Only facts actually stated. Planned spending is not an expense. Use null for anything not said.
- repeat (debt, receivable and income only): when the payment recurs ("κάθε μήνα πληρώνω 450 ενοίκιο", "το ρεύμα κάθε δύο μήνες", "κάθε 1 του μήνα ο μισθός"), the same object as for reminders; due is then its next date. Otherwise null.

Most excerpts contain little or nothing: then output empty arrays.`;

function str(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    // "1.170,50" (Greek) or "1170.50": with a comma present, dots group thousands.
    const cleaned = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
    const n = parseFloat(cleaned.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function indexes(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(num).filter((n): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= max))];
}

export function parseUnderstanding(raw: string, openTasks: number, openDebts: number): Parsed {
  const parsed = JSON.parse(raw.replace(/```(?:json)?/g, '').trim()) as Record<string, unknown>;
  const reminders = (Array.isArray(parsed.reminders) ? parsed.reminders : [])
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({ text: str(r.text) ?? '', due: str(r.due, 20), explicit: r.explicit === true, repeat: r.repeat ?? null }))
    .filter((r) => r.text.length > 0)
    .slice(0, MAX_REMINDERS);
  const kinds: FactKind[] = ['expense', 'income', 'debt', 'receivable', 'measure'];
  const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .filter((f) => kinds.includes(f.kind as FactKind))
    .map((f) => ({
      kind: f.kind as FactKind,
      text: str(f.text) ?? '',
      category:
        (f.kind === 'expense' || f.kind === 'income') && CATEGORIES.includes(f.category as (typeof CATEGORIES)[number])
          ? (f.category as string)
          : f.kind === 'expense' || f.kind === 'income'
            ? 'άλλο'
            : null,
      amount: num(f.amount),
      currency: str(f.currency, 8) ?? (num(f.amount) !== null ? 'EUR' : null),
      who: str(f.who, 80),
      paidBy: f.paidBy === 'me' || f.paidBy === 'other' ? (f.paidBy as 'me' | 'other') : null,
      when: str(f.when, 20),
      due: str(f.due, 20),
      item: str(f.item, 80),
      value: num(f.value),
      unit: str(f.unit, 16),
      repeat: f.kind === 'debt' || f.kind === 'receivable' || f.kind === 'income' ? (f.repeat ?? null) : null,
    }))
    // A money fact needs an amount and a reading needs a value, or there is nothing to count.
    .filter((f) => f.text && (f.kind === 'measure' ? f.value !== null : f.amount !== null))
    .slice(0, MAX_FACTS);
  return {
    reminders,
    done: indexes(parsed.done, openTasks),
    stopped: indexes(parsed.stopped, openTasks),
    settled: indexes(parsed.settled, openDebts),
    facts,
  };
}

interface SourceChunk {
  id: string;
  user_id: string;
  session_id: string;
  started_at: Date;
}

interface Prefs {
  timezone: string;
  autoCreate: boolean;
}

async function prefs(userId: string): Promise<Prefs> {
  const row = await queryOne<{ timezone: string | null; auto_reminders: boolean }>(
    `SELECT timezone, auto_reminders FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  return { timezone: row?.timezone ?? config.BILLING_TIMEZONE, autoCreate: row?.auto_reminders ?? false };
}

interface OpenTask {
  id: string;
  text: string;
  dueAt: Date | null;
  repeat: Repeat | null;
}

interface OpenDebt {
  id: string;
  kind: FactKind;
  data: FactData;
  dueAt: Date | null;
  repeat: Repeat | null;
}

/** Tasks still open that existed before the chunk was recorded (dated by their own recording). */
async function openTasks(userId: string, chunk: SourceChunk): Promise<OpenTask[]> {
  const rows = await query<{ id: string; text: string; due_at: Date | null; repeat: Repeat | null }>(
    `SELECT r.id, r.text, r.due_at, r.repeat FROM reminders r
     LEFT JOIN transcript_chunks src ON src.id = r.source_chunk_id
     WHERE r.user_id = $1 AND r.status IN ('suggested', 'pending')
       AND (r.source_chunk_id IS NULL OR r.source_chunk_id <> $2)
       AND COALESCE(src.started_at, r.created_at) < $3
     ORDER BY r.created_at DESC LIMIT ${OPEN_TASKS}`,
    [userId, chunk.id, chunk.started_at],
  );
  return rows.map((r) => ({
    id: r.id,
    text: decryptText(r.text, ctx.reminderText(userId, r.id)),
    dueAt: r.due_at,
    repeat: r.repeat,
  }));
}

/** Unpaid debts and money owed to the speaker, noted before the chunk was recorded. */
async function openDebts(userId: string, chunk: SourceChunk): Promise<OpenDebt[]> {
  const rows = await query<{ id: string; kind: FactKind; data: string; due_at: Date | null; repeat: Repeat | null }>(
    `SELECT id, kind, data, due_at, repeat FROM memory_facts
     WHERE user_id = $1 AND kind IN ('debt', 'receivable') AND chunk_id <> $2 AND occurred_at < $3
     ORDER BY occurred_at DESC LIMIT 100`,
    [userId, chunk.id, chunk.started_at],
  );
  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      data: JSON.parse(decryptText(r.data, ctx.factData(userId, r.id))) as FactData,
      dueAt: r.due_at,
      repeat: r.repeat,
    }))
    .filter((d) => !d.data.settled)
    .slice(0, OPEN_DEBTS);
}

/** Facts recorded from the chunk just before this one in the same recording. */
async function factsOfPreviousChunk(chunk: SourceChunk): Promise<Array<{ kind: FactKind } & FactData>> {
  const rows = await query<{ id: string; kind: FactKind; data: string }>(
    `SELECT f.id, f.kind, f.data FROM memory_facts f
     WHERE f.chunk_id = (
       SELECT id FROM transcript_chunks
       WHERE session_id = $1 AND user_id = $2 AND started_at < $3 AND text <> ''
       ORDER BY started_at DESC LIMIT 1)`,
    [chunk.session_id, chunk.user_id, chunk.started_at],
  );
  return rows.map((r) => ({
    kind: r.kind,
    ...(JSON.parse(decryptText(r.data, ctx.factData(chunk.user_id, r.id))) as FactData),
  }));
}

export interface Understanding {
  reminders: string[];
  /** Texts of the open tasks marked done. */
  done: string[];
  /** Texts of the open tasks the speaker asked to stop. */
  stopped: string[];
  /** Texts of the debts marked paid. */
  settled: string[];
  facts: Array<{ kind: FactKind; repeatLabel?: string } & FactData>;
}

export interface UnderstandOptions {
  /** false when re-reading old recordings: their reminders already exist. */
  createReminders?: boolean;
  /** Work out the result without writing anything. */
  dryRun?: boolean;
  /** Re-reading old recordings: save what was understood without showing it as new. */
  quiet?: boolean;
}

export async function understandChunk(
  chunk: SourceChunk,
  text: string,
  previousText: string,
  options: UnderstandOptions = {},
): Promise<Understanding> {
  const empty: Understanding = { reminders: [], done: [], stopped: [], settled: [], facts: [] };
  if (!worthUnderstanding(`${previousText.slice(-200)} ${text}`)) return empty;
  const createReminders = options.createReminders ?? true;

  const userId = chunk.user_id;
  const [{ timezone, autoCreate }, tasks, debts] = await Promise.all([
    prefs(userId),
    openTasks(userId, chunk),
    openDebts(userId, chunk),
  ]);

  const local = (d: Date | null): string => (d ? `, ως ${formatZoned(d, timezone)}` : '');
  const raw = await getLlmProvider().chat(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `Recorded at (local time): ${formatZoned(chunk.started_at, timezone)}\n\n` +
          `OPEN TASKS:\n${tasks.map((t, i) => `${i + 1}. ${t.text}${local(t.dueAt)}${t.repeat ? ` (${describeRepeat(t.repeat)})` : ''}`).join('\n') || '(none)'}\n\n` +
          `OPEN MONEY:\n${
            debts
              .map(
                (d, i) =>
                  `${i + 1}. ${d.kind === 'debt' ? 'ο χρήστης χρωστάει' : 'χρωστάνε στον χρήστη'}: ` +
                  `${d.data.text} ${d.data.amount ?? ''} ${d.data.currency ?? ''}` +
                  `${d.data.who ? ` (${d.data.who})` : ''}${local(d.dueAt)}`,
              )
              .join('\n') || '(none)'
          }\n\n` +
          (previousText ? `PREVIOUS excerpt:\n${previousText.slice(-600)}\n\n` : '') +
          `CURRENT excerpt:\n${text}`,
      },
    ],
    { temperature: 0, json: true, model: config.EXTRACT_MODEL || undefined },
  );
  const found = parseUnderstanding(raw, tasks.length, debts.length);
  // Models sometimes repeat what the previous excerpt said; that chunk already recorded it.
  const earlier = await factsOfPreviousChunk(chunk);
  found.facts = found.facts.filter(
    (f) =>
      !earlier.some((e) => e.kind === f.kind && e.amount === f.amount && e.value === f.value) &&
      // A debt already open with the same amount is that debt, copied from the OPEN MONEY list.
      !debts.some((d) => d.kind === f.kind && d.data.amount === f.amount),
  );
  // Closing the wrong task is worse than missing one: the note must name what it is about.
  found.done = found.done.filter((n) => sharesSubject(tasks[n - 1]!.text, text));
  found.stopped = found.stopped.filter((n) => sharesSubject(tasks[n - 1]!.text, text) && !found.done.includes(n));
  found.settled = found.settled.filter((n) => {
    const d = debts[n - 1]!.data;
    return sharesSubject(`${d.text} ${d.who ?? ''} ${d.amount ?? ''}`, text);
  });
  // Repeat rules count from the day the note was recorded.
  const recordedDay = localDay(chunk.started_at, timezone);
  const ruleOf = (raw: unknown): Repeat | null => parseRepeat(raw, recordedDay);
  const result: Understanding = {
    reminders: createReminders
      ? found.reminders.map((r) => {
          const rule = ruleOf(r.repeat);
          return `${r.text}${rule ? ` (${describeRepeat(rule)})` : r.due ? ` (${r.due})` : ''}${r.explicit ? ' [ρητό]' : ''}`;
        })
      : [],
    done: found.done.map((n) => tasks[n - 1]!.text),
    stopped: found.stopped.map((n) => tasks[n - 1]!.text),
    settled: found.settled.map((n) => debts[n - 1]!.data.text),
    facts: found.facts.map(({ when: _when, due: _due, repeat, ...fact }) => {
      const rule = ruleOf(repeat);
      return rule ? { ...fact, repeatLabel: describeRepeat(rule) } : fact;
    }),
  };
  if (options.dryRun) return result;

  const now = Date.now();
  // Models often give a date without a time ("2026-10-23"); a day alone means 09:00 that day.
  const toUtc = (local: string | null): Date | null =>
    local ? zonedToUtc(/^\d{4}-\d{2}-\d{2}$/.test(local.trim()) ? `${local.trim()}T09:00` : local, timezone) : null;
  const insights: Insight[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (createReminders) {
      // A retried chunk replaces what it created before instead of adding duplicates.
      await client.query(
        `DELETE FROM reminders WHERE source_chunk_id = $1 AND status IN ('suggested', 'pending')`,
        [chunk.id],
      );
      for (const item of found.reminders) {
        const rule = ruleOf(item.repeat);
        // A repeating task is due at its next occurrence from now, whatever date the model gave.
        const due = rule ? nextOccurrence(rule, new Date(now - 60_000), timezone) : toUtc(item.due);
        const id = randomUUID();
        // Asked for in so many words, or auto-create is on: no confirmation step.
        const status = item.explicit || autoCreate ? 'pending' : 'suggested';
        const dueAt = due && due.getTime() > now ? due : null;
        await client.query(
          `INSERT INTO reminders (id, user_id, text, due_at, status, source_chunk_id, repeat)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            userId,
            encryptText(item.text, ctx.reminderText(userId, id)),
            dueAt?.toISOString() ?? null,
            status,
            chunk.id,
            rule ? JSON.stringify(rule) : null,
          ],
        );
        insights.push(taskInsight(id, item.text, status === 'suggested', dueAt, timezone, rule));
      }
    }

    // A repeating task moves to its next date instead of closing.
    for (const n of found.done) {
      const task = tasks[n - 1]!;
      const completion = await completeReminder(client, userId, task.id, timezone, new Date(now));
      if (completion) insights.push(doneInsight(task.id, task.text, completion, timezone));
    }

    for (const n of found.stopped) {
      const task = tasks[n - 1]!;
      await client.query(
        `UPDATE reminders SET status = 'dismissed', updated_at = now() WHERE id = $1 AND user_id = $2`,
        [task.id, userId],
      );
      insights.push(stoppedInsight(task.id, task.text));
    }

    for (const n of found.settled) {
      const debt = debts[n - 1]!;
      // A repeating payment moves to its next date; a one-off one is marked paid.
      const after = debt.dueAt && debt.dueAt.getTime() > now ? debt.dueAt : new Date(now);
      const next = debt.repeat ? nextOccurrence(debt.repeat, after, timezone) : null;
      if (next) {
        await client.query(`UPDATE memory_facts SET due_at = $3 WHERE id = $1 AND user_id = $2`, [
          debt.id,
          userId,
          next.toISOString(),
        ]);
      } else {
        await client.query(`UPDATE memory_facts SET data = $3 WHERE id = $1 AND user_id = $2`, [
          debt.id,
          userId,
          encryptText(JSON.stringify({ ...debt.data, settled: true }), ctx.factData(userId, debt.id)),
        ]);
      }
      insights.push(settledInsight(debt.id, debt.data, { next, previousDue: debt.dueAt }, timezone));
    }

    await client.query(`DELETE FROM memory_facts WHERE chunk_id = $1`, [chunk.id]);
    for (const fact of found.facts) {
      const id = randomUUID();
      const { kind, when, due, repeat, ...data } = fact;
      const rule = ruleOf(repeat);
      const dueAt = rule ? nextOccurrence(rule, new Date(now - 60_000), timezone) : toUtc(due);
      await client.query(
        `INSERT INTO memory_facts (id, user_id, chunk_id, kind, data, occurred_at, due_at, repeat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          userId,
          chunk.id,
          kind,
          encryptText(JSON.stringify(data), ctx.factData(userId, id)),
          (toUtc(when) ?? chunk.started_at).toISOString(),
          dueAt?.toISOString() ?? null,
          rule ? JSON.stringify(rule) : null,
        ],
      );
      insights.push(factInsight(id, kind, data, dueAt, timezone, rule));
    }

    await saveInsights(client, userId, chunk.id, insights, options.quiet ?? false);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return result;
}
