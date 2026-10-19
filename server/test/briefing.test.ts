import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeBriefings, type BriefingFact } from '../src/lib/briefing';

const TZ = 'Europe/Athens';
// Intl puts a no-break space before the euro sign; compare as plain spaces.
const plain = (s: string): string => s.replace(/\u00a0/g, ' ');
// Tuesday 20 October 2026, 07:00 in Athens.
const NOW = new Date('2026-10-20T04:00:00Z');

const debt = (text: string, amount: number, due: string): BriefingFact => ({
  kind: 'debt',
  occurredAt: new Date('2026-10-16T08:00:00Z'),
  dueAt: new Date(due),
  data: { text, amount, currency: 'EUR', who: null, paidBy: null, item: null, value: null, unit: null },
});

test('a payment shows from three days before, then "αύριο" and "σήμερα"', () => {
  const b = composeBriefings([], [debt('Χρυσή κάρτα Εθνικής', 1170, '2026-10-23T06:00:00Z')], TZ, 4, NOW);
  assert.deepEqual(
    b.map((x) => [x.date, plain(x.body)]),
    [
      ['2026-10-20', 'Πληρωμή Παρασκευή 23/10: Χρυσή κάρτα Εθνικής 1.170,00 €'],
      ['2026-10-21', 'Πληρωμή Παρασκευή 23/10: Χρυσή κάρτα Εθνικής 1.170,00 €'],
      ['2026-10-22', 'Πληρωμή αύριο: Χρυσή κάρτα Εθνικής 1.170,00 €'],
      ['2026-10-23', 'Πληρωμή σήμερα: Χρυσή κάρτα Εθνικής 1.170,00 €'],
    ],
  );
});

test('a task about the same payment is not listed twice', () => {
  const b = composeBriefings(
    [{ text: 'Βάλε 1170 ευρώ στη χρυσή κάρτα', dueAt: null, status: 'suggested' }],
    [debt('Χρυσή κάρτα Εθνικής', 1170, '2026-10-23T06:00:00Z')],
    TZ,
    1,
    NOW,
  );
  assert.ok(!b[0]!.body.includes('Βάλε 1170'));
});

test('the amount is not repeated when the description has it', () => {
  const b = composeBriefings([], [debt('Χρωστάω 77,54€ στην κάρτα', 77.54, '2026-10-20T06:00:00Z')], TZ, 1, NOW);
  assert.equal(b[0]!.body, 'Πληρωμή σήμερα: Χρωστάω 77,54€ στην κάρτα');
});

test('timed tasks show their local time', () => {
  const b = composeBriefings(
    [{ text: 'Συνάντηση με Καρατέκα', dueAt: new Date('2026-10-21T15:30:00Z'), status: 'pending' }],
    [],
    TZ,
    4,
    NOW,
  );
  assert.equal(b.find((x) => x.date === '2026-10-21')?.body.split('\n')[0], '18:30 Συνάντηση με Καρατέκα');
});

test('a day with nothing to say sends nothing', () => {
  assert.deepEqual(composeBriefings([], [], TZ, 4, NOW), []);
});

test('money owed for two weeks is nudged, per person', () => {
  const owed = (amount: number, at: string): BriefingFact => ({
    kind: 'receivable',
    occurredAt: new Date(at),
    dueAt: null,
    data: { text: 'Στρόγγυλο', amount, currency: 'EUR', who: 'Ανθή', paidBy: null, item: null, value: null, unit: null },
  });
  const facts = [owed(20, '2026-10-15T12:00:00Z'), owed(20, '2026-10-15T12:05:00Z')];
  assert.equal(composeBriefings([], facts, TZ, 1, NOW).length, 0);
  const later = composeBriefings([], facts, TZ, 1, new Date('2026-11-02T04:00:00Z'));
  assert.equal(plain(later[0]!.body), 'Σου χρωστάει Ανθή: 40,00 € εδώ και 17 μέρες');
});

test('a repeating task shows on each day it happens, not before its next due date', () => {
  // Every day at 08:00; today's is done, so the next one is tomorrow.
  const daily = {
    text: 'Πάρε το φάρμακο',
    dueAt: new Date('2026-10-21T05:00:00Z'),
    status: 'pending' as const,
    repeat: { freq: 'daily' as const, interval: 1, time: '08:00', start: '2026-10-19' },
  };
  const b = composeBriefings([daily], [], TZ, 3, NOW);
  assert.deepEqual(
    b.map((x) => [x.date, x.body]),
    [
      ['2026-10-21', '08:00 Πάρε το φάρμακο ↻'],
      ['2026-10-22', '08:00 Πάρε το φάρμακο ↻'],
    ],
  );
});

test('a weekly task only shows on its weekday', () => {
  const monday = {
    text: 'Βγάλε τα σκουπίδια',
    dueAt: new Date('2026-10-26T06:00:00Z'),
    status: 'pending' as const,
    repeat: { freq: 'weekly' as const, interval: 1, days: [1], time: '09:00', start: '2026-10-19' },
  };
  const b = composeBriefings([monday], [], TZ, 7, NOW);
  assert.deepEqual(
    b.map((x) => x.date),
    ['2026-10-26'],
  );
});

test('a repeating bill nobody marked paid moves on after a few days', () => {
  const rent: BriefingFact = {
    kind: 'debt',
    occurredAt: new Date('2026-09-01T08:00:00Z'),
    // Due on 1 October and never marked paid.
    dueAt: new Date('2026-10-01T06:00:00Z'),
    repeat: { freq: 'monthly', interval: 1, monthDay: 1, time: '09:00', start: '2026-09-01' },
    data: { text: 'Ενοίκιο', amount: 450, currency: 'EUR', who: null, paidBy: null, item: null, value: null, unit: null },
  };
  // On 20/10 the October rent is long past the grace days, and 1/11 is beyond the lookahead.
  assert.equal(composeBriefings([], [rent], TZ, 1, NOW).length, 0);
  const b = composeBriefings([], [rent], TZ, 1, new Date('2026-10-30T05:00:00Z'));
  assert.equal(plain(b[0]!.body), 'Πληρωμή Κυριακή 1/11: Ενοίκιο 450,00 €');
});
