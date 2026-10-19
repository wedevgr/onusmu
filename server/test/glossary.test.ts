import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptRevision, expandWithVariants, mentions, sameName, type Term } from '../src/lib/glossary';

const term = (name: string, variants: string[] = []): Term => ({
  id: name,
  term: name,
  kind: 'business',
  note: '',
  variants,
  mentions: 1,
  source: 'auto',
  hidden: false,
  lastSeenAt: new Date(0),
});

test('sameName accepts other cases of a name, not other names', () => {
  assert.ok(sameName('παταρας', 'παταρα'));
  assert.ok(sameName('γιωργος', 'γιωργο'));
  assert.ok(!sameName('μαρια', 'μαρινα'));
});

test('mentions needs the whole name, in any case form', () => {
  assert.ok(mentions('Πήγα το Auris στον Πατάρα', 'Πατάρας'));
  assert.ok(!mentions('αλλάξαμε μπαταρία στο Αβένσις', 'Μπατάρα'));
  assert.ok(mentions('Θα δω τον Καρατέκα στον Άγιο Αθανάσιο', 'Άγιος Αθανάσιος'));
});

test('searching a name also searches its misheard spellings', () => {
  const words = expandWithVariants(['Πατάρα'], [term('Πατάρας', ['Μπατάρα'])]);
  assert.ok(words.includes('Μπατάρα'));
});

test('a proofread may fix a name but not rewrite the note', () => {
  assert.ok(acceptRevision('Πήγα στο Μπατάρα για σέρβις', 'Πήγα στον Πατάρα για σέρβις'));
  assert.ok(!acceptRevision('Πήγα στο Μπατάρα για σέρβις', 'Επισκέφθηκα το συνεργείο για συντήρηση'));
});

test('a proofread may never translate', () => {
  assert.ok(!acceptRevision('Понеделник трябва да отида на работа', 'Δευτέρα πρέπει να πάω στη δουλειά'));
});
