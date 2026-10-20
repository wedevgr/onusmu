import type { IconName } from '../components/Icon';
import type { Reminder, ReminderTag } from '../api/types';

export const TAG_INFO: Record<ReminderTag, { label: string; icon: IconName }> = {
  money: { label: 'Χρήματα', icon: 'credit-card' },
  work: { label: 'Δουλειά', icon: 'briefcase' },
  home: { label: 'Σπίτι', icon: 'home' },
  car: { label: 'Αυτοκίνητο', icon: 'truck' },
  health: { label: 'Υγεία', icon: 'heart' },
  family: { label: 'Οικογένεια', icon: 'users' },
  shopping: { label: 'Ψώνια', icon: 'shopping-bag' },
  errands: { label: 'Διεκπεραιώσεις', icon: 'clipboard' },
};

/** The tags in use, most used first, with how many reminders carry each. */
export function tagCounts(reminders: Reminder[]): { tag: ReminderTag; count: number }[] {
  const counts = new Map<ReminderTag, number>();
  for (const r of reminders) for (const tag of r.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export interface MoneySummary {
  pay: number;
  receive: number;
  payCount: number;
  receiveCount: number;
  // Money reminders with no amount said.
  unpriced: number;
  currency: string;
}

/** Totals to pay and to collect across money reminders, in the most used currency. */
export function moneySummary(reminders: Reminder[]): MoneySummary {
  const summary: MoneySummary = { pay: 0, receive: 0, payCount: 0, receiveCount: 0, unpriced: 0, currency: 'EUR' };
  const currencies = new Map<string, number>();
  for (const r of reminders) if (r.money) currencies.set(r.money.currency, (currencies.get(r.money.currency) ?? 0) + 1);
  summary.currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EUR';
  for (const r of reminders) {
    if (!r.money) continue;
    // Sums in another currency would be wrong; count those as unpriced.
    if (r.money.amount === null || r.money.currency !== summary.currency) {
      summary.unpriced += 1;
    } else if (r.money.direction === 'receive') {
      summary.receive += r.money.amount;
      summary.receiveCount += 1;
    } else {
      summary.pay += r.money.amount;
      summary.payCount += 1;
    }
  }
  return summary;
}

/** e.g. "1.250,50 €". */
export function formatMoney(amount: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(Number.isInteger(amount) ? 0 : 2).replace('.', ',')} ${currency === 'EUR' ? '€' : currency}`;
  }
}
