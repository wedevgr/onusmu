import { query } from '../db';
import { getLlmProvider } from '../providers';
import { ctx, decryptText, encryptText } from './crypto';

/**
 * Tags for grouping and filtering reminders in the app, and for a money reminder its amount
 * and direction. Made by the model the first time a reminder is listed, kept encrypted in
 * reminder_tags, and dropped when the text is edited so the next listing tags it again.
 */

export const REMINDER_TAGS = ['money', 'work', 'home', 'car', 'health', 'family', 'shopping', 'errands'] as const;
export type ReminderTag = (typeof REMINDER_TAGS)[number];

export interface ReminderMoney {
  /** Null when the reminder is about money but names no amount. */
  amount: number | null;
  currency: string;
  /** pay: the user pays or deposits. receive: someone pays the user. */
  direction: 'pay' | 'receive';
}

export interface ReminderMeta {
  tags: ReminderTag[];
  money: ReminderMoney | null;
}

const MAX_TAGS = 2;
// One model call covers this many reminders; a listing tags at most two calls' worth.
const BATCH = 40;
const MAX_PER_LISTING = BATCH * 2;

const SYSTEM = `You sort a person's to-do reminders (mostly Greek) into groups.
Output ONLY JSON: {"items":[{"id":string,"tags":string[],"amount":number|null,"currency":string|null,"direction":"pay"|"receive"|null}]}, one item per input reminder, same ids.

tags: 1 or 2 of these, the best fitting first:
- money: paying, collecting, depositing or transferring money; bills, rent, debts, loans, cards, the bank, invoices, getting paid.
- work: the person's job, customers, colleagues, work orders.
- home: the house, repairs, cleaning, utilities at home, rubbish.
- car: any vehicle: service, tyres, fuel, insurance, KTEO, parking.
- health: doctors, medicine, appointments, tests, exercise.
- family: children, partner, parents, relatives, school runs.
- shopping: things to buy.
- errands: paperwork, public services, post, phone calls and anything that fits nowhere else.
A reminder about paying for something gets "money" plus its subject ("πλήρωσε το συνεργείο" -> ["money","car"]).

amount, currency, direction: only for a "money" reminder, else null.
- amount: the number said ("120€" -> 120, "εκατόν είκοσι ευρώ" -> 120, "77,54" -> 77.54); null when none is said.
- currency: "EUR" unless another is named.
- direction: "pay" when the person pays, deposits or owes ("να πληρώσω", "να δώσω", "να καταθέσω"); "receive" when someone pays or owes the person ("να μου δώσει", "να εισπράξω", "να πληρωθώ").`;

/** Turns the model's reply into a meta per id; anything malformed is dropped or emptied. */
export function parseClassification(raw: string, ids: string[]): Map<string, ReminderMeta> {
  const out = new Map<string, ReminderMeta>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return out;
  const wanted = new Set(ids);
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !wanted.has(r.id)) continue;
    const tags = (Array.isArray(r.tags) ? r.tags : [])
      .filter((t): t is ReminderTag => REMINDER_TAGS.includes(t as ReminderTag))
      .filter((t, i, all) => all.indexOf(t) === i)
      .slice(0, MAX_TAGS);
    const amount = typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0 ? r.amount : null;
    const direction = r.direction === 'pay' || r.direction === 'receive' ? r.direction : null;
    const isMoney = tags.includes('money');
    out.set(r.id, {
      tags,
      money: isMoney
        ? {
            amount: amount === null ? null : Math.round(amount * 100) / 100,
            currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : 'EUR',
            direction: direction ?? 'pay',
          }
        : null,
    });
  }
  return out;
}

async function classify(items: { id: string; text: string }[]): Promise<Map<string, ReminderMeta>> {
  const raw = await getLlmProvider().chat(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(items.map((i) => ({ id: i.id, text: i.text }))) },
    ],
    { temperature: 0, json: true },
  );
  return parseClassification(raw, items.map((i) => i.id));
}

/**
 * The tags for these reminders, tagging the ones that have none yet. Optional: on any failure
 * (no reminder_tags table yet, the model down) the reminders are returned untagged.
 */
export async function reminderMeta(
  userId: string,
  reminders: { id: string; text: string }[],
): Promise<Map<string, ReminderMeta>> {
  const metas = new Map<string, ReminderMeta>();
  if (reminders.length === 0) return metas;
  try {
    const rows = await query<{ reminder_id: string; meta: string }>(
      `SELECT reminder_id, meta FROM reminder_tags WHERE user_id = $1 AND reminder_id = ANY($2::uuid[])`,
      [userId, reminders.map((r) => r.id)],
    );
    for (const row of rows) {
      try {
        metas.set(row.reminder_id, JSON.parse(decryptText(row.meta, ctx.reminderMeta(userId, row.reminder_id))));
      } catch {
        // Unreadable: tagged again below.
      }
    }

    const missing = reminders.filter((r) => !metas.has(r.id)).slice(0, MAX_PER_LISTING);
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const found = await classify(batch);
      if (found.size === 0) continue;
      const ids = [...found.keys()];
      await query(
        `INSERT INTO reminder_tags (reminder_id, user_id, meta)
         SELECT id, $1, meta FROM unnest($2::uuid[], $3::text[]) AS t(id, meta)
         WHERE EXISTS (SELECT 1 FROM reminders r WHERE r.id = t.id AND r.user_id = $1)
         ON CONFLICT (reminder_id) DO UPDATE SET meta = EXCLUDED.meta`,
        [userId, ids, ids.map((id) => encryptText(JSON.stringify(found.get(id)), ctx.reminderMeta(userId, id)))],
      );
      for (const [id, meta] of found) metas.set(id, meta);
    }
  } catch (err) {
    console.error('[reminder-tags] tagging failed', err instanceof Error ? err.message : err);
  }
  return metas;
}

/** Forgets a reminder's tags after its text changed; the next listing tags it again. */
export async function forgetReminderMeta(userId: string, reminderId: string): Promise<void> {
  try {
    await query(`DELETE FROM reminder_tags WHERE reminder_id = $1 AND user_id = $2`, [reminderId, userId]);
  } catch (err) {
    console.error('[reminder-tags] could not forget tags', err instanceof Error ? err.message : err);
  }
}
