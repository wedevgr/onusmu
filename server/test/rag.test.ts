import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, type Passage } from '../src/lib/rag';

const passage = (id: string): Passage => ({
  sessionId: 's',
  anchorChunkId: id,
  startedAt: new Date(0),
  endedAt: new Date(0),
  text: id,
  score: 1,
});

test('source markers become citations and leave the text', () => {
  const { text, used } = extractCitations('Πλήρωσες 70 € [2]. Και 50 € [1, 2].', [passage('a'), passage('b')], null);
  assert.equal(text, 'Πλήρωσες 70 €. Και 50 €.');
  assert.deepEqual(
    used.map((u) => u.chunkId),
    ['b', 'a'],
  );
});

test('ledger markers point at the recording of the record; unknown ones are dropped', () => {
  const ledger = {
    text: '',
    sources: [{ chunkId: 'c', sessionId: 's', startedAt: new Date(0), endedAt: new Date(0) }],
  };
  const { text, used } = extractCitations('Σύνολο 172,10 € [F1][F9].', [], ledger);
  assert.equal(text, 'Σύνολο 172,10 €.');
  assert.deepEqual(
    used.map((u) => u.chunkId),
    ['c'],
  );
});
