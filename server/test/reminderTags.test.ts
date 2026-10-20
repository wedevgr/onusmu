import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClassification } from '../src/lib/reminderTags';

test('reads tags and money for each asked id', () => {
  const raw = JSON.stringify({
    items: [
      { id: 'a', tags: ['money', 'car'], amount: 120, currency: 'EUR', direction: 'pay' },
      { id: 'b', tags: ['family'], amount: null, currency: null, direction: null },
    ],
  });
  const metas = parseClassification(raw, ['a', 'b']);
  assert.deepEqual(metas.get('a'), { tags: ['money', 'car'], money: { amount: 120, currency: 'EUR', direction: 'pay' } });
  assert.deepEqual(metas.get('b'), { tags: ['family'], money: null });
});

test('drops unknown tags, duplicates, extra tags and ids not asked for', () => {
  const raw = JSON.stringify({
    items: [
      { id: 'a', tags: ['home', 'party', 'home', 'work', 'car'] },
      { id: 'zzz', tags: ['work'] },
    ],
  });
  const metas = parseClassification(raw, ['a']);
  assert.deepEqual(metas.get('a'), { tags: ['home', 'work'], money: null });
  assert.equal(metas.has('zzz'), false);
});

test('money without amount or direction still counts as money to pay', () => {
  const raw = JSON.stringify({ items: [{ id: 'a', tags: ['money'], amount: 'πολλά', currency: 'euro' }] });
  assert.deepEqual(parseClassification(raw, ['a']).get('a')?.money, { amount: null, currency: 'EUR', direction: 'pay' });
});

test('amounts only on money reminders, rounded to cents', () => {
  const raw = JSON.stringify({
    items: [
      { id: 'a', tags: ['shopping'], amount: 30, direction: 'pay' },
      { id: 'b', tags: ['money'], amount: 77.544, direction: 'receive' },
    ],
  });
  const metas = parseClassification(raw, ['a', 'b']);
  assert.equal(metas.get('a')?.money, null);
  assert.deepEqual(metas.get('b')?.money, { amount: 77.54, currency: 'EUR', direction: 'receive' });
});

test('a malformed reply tags nothing', () => {
  assert.equal(parseClassification('not json', ['a']).size, 0);
  assert.equal(parseClassification('{"items":"x"}', ['a']).size, 0);
});
