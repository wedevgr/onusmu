import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepGrounded } from '../src/lib/groundedQuestions';

const excerpts = [
  { label: 'Τρίτη 20 Οκτωβρίου 10:00', text: 'Αύριο πρέπει να πάω το Auris στο συνεργείο του Πατάρα.' },
  { label: 'Τρίτη 20 Οκτωβρίου 12:00', text: 'Η ΔΕΗ ήρθε 120 ευρώ, να την πληρώσω μέχρι την Παρασκευή.' },
];

const reply = (questions: unknown[]) => JSON.stringify({ questions });

test('keeps questions whose quote is in the recordings, ignoring accents and case', () => {
  const out = keepGrounded(
    reply([
      { q: 'Πότε πάω το Auris στο συνεργείο;', quote: 'να παω το auris στο συνεργειο' },
      { q: 'Πόσο ήρθε η ΔΕΗ;', quote: 'Η ΔΕΗ ήρθε 120 ευρώ' },
    ]),
    excerpts,
  );
  assert.deepEqual(out, ['Πότε πάω το Auris στο συνεργείο;', 'Πόσο ήρθε η ΔΕΗ;']);
});

test('drops questions about things not in the recordings', () => {
  const out = keepGrounded(
    reply([
      { q: 'Τι είπε ο γιατρός;', quote: 'ο γιατρός είπε να κάνω εξετάσεις' },
      { q: 'Πού πήγες διακοπές;', quote: '' },
      { q: 'Τι έφαγες;' },
    ]),
    excerpts,
  );
  assert.deepEqual(out, []);
});

test('drops quotes too short to prove anything, repeats and the question already asked', () => {
  const out = keepGrounded(
    reply([
      { q: 'Τι είναι το Auris;', quote: 'Auris' },
      { q: 'Πόσο ήρθε η ΔΕΗ;', quote: 'Η ΔΕΗ ήρθε 120 ευρώ' },
      { q: 'Πόσο ήρθε η ΔΕΗ;', quote: 'Η ΔΕΗ ήρθε 120 ευρώ' },
      { q: 'Πότε πληρώνω τη ΔΕΗ;', quote: 'να την πληρώσω μέχρι την Παρασκευή' },
    ]),
    excerpts,
    ['πότε πληρώνω τη ΔΕΗ;'],
  );
  assert.deepEqual(out, ['Πόσο ήρθε η ΔΕΗ;']);
});

test('a malformed reply suggests nothing', () => {
  assert.deepEqual(keepGrounded('nope', excerpts), []);
  assert.deepEqual(keepGrounded('{"questions":"x"}', excerpts), []);
});
