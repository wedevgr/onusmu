import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRepeat, nextOccurrence, parseRepeat, perMonth, upcoming, type Repeat } from '../src/lib/recurrence';

const TZ = 'Europe/Athens';
const local = (d: Date | null): string | null =>
  d
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(d)
    : null;
// Tuesday 20 October 2026, 10:00 in Athens.
const NOW = new Date('2026-10-20T07:00:00Z');

test('every Monday at 09:00: the next Monday', () => {
  const rule: Repeat = { freq: 'weekly', interval: 1, days: [1], time: '09:00', start: '2026-10-19' };
  assert.equal(local(nextOccurrence(rule, NOW, TZ)), '2026-10-26 09:00');
});

test('later today counts; earlier today does not', () => {
  const rule: Repeat = { freq: 'daily', interval: 1, time: '18:30', start: '2026-10-20' };
  assert.equal(local(nextOccurrence(rule, NOW, TZ)), '2026-10-20 18:30');
  const morning: Repeat = { ...rule, time: '08:00' };
  assert.equal(local(nextOccurrence(morning, NOW, TZ)), '2026-10-21 08:00');
});

test('weekdays only skip the weekend', () => {
  const rule: Repeat = { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5], time: '07:00', start: '2026-10-20' };
  const friday = new Date('2026-10-23T08:00:00Z');
  assert.equal(local(nextOccurrence(rule, friday, TZ)), '2026-10-26 07:00');
});

test('every two weeks keeps to its own weeks', () => {
  const rule: Repeat = { freq: 'weekly', interval: 2, days: [6], time: '10:00', start: '2026-10-24' };
  assert.deepEqual(upcoming(rule, NOW, TZ, 3).map(local), ['2026-10-24 10:00', '2026-11-07 10:00', '2026-11-21 10:00']);
});

test('the 31st falls on the last day of shorter months', () => {
  const rule: Repeat = { freq: 'monthly', interval: 1, monthDay: 31, time: '09:00', start: '2026-10-31' };
  assert.deepEqual(upcoming(rule, NOW, TZ, 3).map(local), ['2026-10-31 09:00', '2026-11-30 09:00', '2026-12-31 09:00']);
});

test('the clock time stays the same across the daylight-saving change', () => {
  // Greece moves the clocks back on Sunday 25 October 2026.
  const rule: Repeat = { freq: 'daily', interval: 1, time: '09:00', start: '2026-10-24' };
  assert.deepEqual(upcoming(rule, new Date('2026-10-24T00:00:00Z'), TZ, 3).map(local), [
    '2026-10-24 09:00',
    '2026-10-25 09:00',
    '2026-10-26 09:00',
  ]);
});

test('a rule with an end date stops', () => {
  const rule: Repeat = { freq: 'weekly', interval: 1, days: [2], time: '09:00', start: '2026-10-20', until: '2026-11-03' };
  assert.deepEqual(upcoming(rule, NOW, TZ, 5).map(local), ['2026-10-27 09:00', '2026-11-03 09:00']);
  assert.equal(nextOccurrence(rule, new Date('2026-11-04T00:00:00Z'), TZ), null);
});

test('model output is turned into a safe rule', () => {
  assert.deepEqual(parseRepeat({ freq: 'weekly', days: ['MO', 'mon', 'XX'], time: '9:00' }, '2026-10-20'), {
    freq: 'weekly',
    interval: 1,
    days: [1],
    time: '09:00',
    start: '2026-10-20',
  });
  assert.equal(parseRepeat({ freq: 'hourly' }, '2026-10-20'), null);
  assert.equal(parseRepeat(null, '2026-10-20'), null);
  assert.deepEqual(parseRepeat({ freq: 'monthly', monthDay: 15, time: '10:00' }, '2026-10-20'), {
    freq: 'monthly',
    interval: 1,
    monthDay: 15,
    time: '10:00',
    start: '2026-10-20',
  });
});

test('Greek descriptions', () => {
  const start = '2026-10-19';
  assert.equal(describeRepeat({ freq: 'weekly', interval: 1, days: [1], time: '09:00', start }), 'Κάθε Δευτέρα 09:00');
  assert.equal(
    describeRepeat({ freq: 'weekly', interval: 1, days: [5, 1, 2, 3, 4], time: '07:00', start }),
    'Δευτέρα–Παρασκευή 07:00',
  );
  assert.equal(describeRepeat({ freq: 'daily', interval: 1, time: '08:00', start }), 'Κάθε μέρα 08:00');
  assert.equal(describeRepeat({ freq: 'monthly', interval: 1, monthDay: 15, time: '09:00', start }), 'Κάθε 15 του μήνα');
  assert.equal(
    describeRepeat({ freq: 'weekly', interval: 2, days: [6], time: '10:00', start, until: '2026-12-31' }),
    'Κάθε 2 εβδομάδες (Σάββατο) 10:00, έως 31/12',
  );
});

test('recurring payments as a monthly amount', () => {
  assert.equal(perMonth({ freq: 'monthly', interval: 1, time: '09:00', start: '2026-10-01' }), 1);
  assert.equal(perMonth({ freq: 'monthly', interval: 2, time: '09:00', start: '2026-10-01' }), 0.5);
  assert.equal(perMonth({ freq: 'yearly', interval: 1, time: '09:00', start: '2026-10-01' }).toFixed(4), (1 / 12).toFixed(4));
});
