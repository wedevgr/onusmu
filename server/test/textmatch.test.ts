import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchText, normalizeText, queryStems } from '../src/lib/textmatch';

test('normalizeText drops accents and case', () => {
  assert.equal(normalizeText('Καφές ΕΙΝΑΛΑΝ'), 'καφες ειναλαν');
});

test('queryStems skips stop words and trims Greek endings', () => {
  assert.deepEqual(queryStems('Πού ήπια καφέ με τον Γιώργο;'), ['ηπια', 'καφε', 'γιωρ']);
});

test('a stem matches other forms of the word', () => {
  const m = matchText('Πήγαμε για καφεδάκι στο κέντρο', queryStems('καφές'));
  assert.equal(m.share, 1);
});

test('highlight ranges point at the original, accented text', () => {
  const text = 'Έχω αφήσει τα κλειδιά στον κλειδαρά.';
  const m = matchText(text, queryStems('κλειδιά'));
  assert.deepEqual(
    m.ranges.map(([a, b]) => text.slice(a, b)),
    ['κλειδιά', 'κλειδαρά'],
  );
});

test('only matches at the start of a word', () => {
  assert.equal(matchText('μπαταρία', ['ταρ']).share, 0);
});
