import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, parseUnderstanding, sharesSubject, worthUnderstanding } from '../src/lib/understand';

test('amounts in Greek and plain formats', () => {
  assert.equal(num('77,54'), 77.54);
  assert.equal(num('1.170,50'), 1170.5);
  assert.equal(num('77.54'), 77.54);
  assert.equal(num('1170 €'), 1170);
  assert.equal(num(70), 70);
  assert.equal(num('πολλά'), null);
});

test('a done command closes only the task it names', () => {
  const said = 'Έχω πληρώσει την ΕΙΝΑΛΑΝ, διέγραψέ το σαν εκκρεμότητα.';
  assert.ok(sharesSubject('Πλήρωσε την Ειναλάν', said));
  assert.ok(!sharesSubject('Πλήρωσε το ρεύμα', said));
  assert.ok(!sharesSubject('Βάλε 1170 ευρώ στη χρυσή κάρτα', 'Αλλάξαμε μπαταρία στο Αβένσις 50 ευρώ'));
  assert.ok(sharesSubject('Βάλε 1170 ευρώ στη χρυσή κάρτα', 'Έβαλα τα 1170 στην κάρτα'));
});

test('notes about nothing skip the model call', () => {
  assert.ok(!worthUnderstanding('Ωραίος καιρός σήμερα, πήγαμε βόλτα στη θάλασσα.'));
  assert.ok(worthUnderstanding('Πλήρωσα 20 ευρώ βενζίνη'));
  assert.ok(worthUnderstanding('Διέγραψέ το'));
});

test('model output is validated', () => {
  const raw = JSON.stringify({
    reminders: [{ text: 'Πλήρωσε το ρεύμα', due: null, explicit: true }, { text: '' }],
    done: [1, 1, 7, 'x'],
    settled: [],
    facts: [
      { kind: 'expense', text: 'Σέρβις Auris', amount: '70', category: 'αυτοκίνητο', paidBy: 'me' },
      { kind: 'expense', text: 'Χωρίς ποσό', amount: null },
      { kind: 'measure', text: 'Χιλιόμετρα', value: 283250, unit: 'km' },
      { kind: 'gift', text: 'Άγνωστο είδος', amount: 5 },
      { kind: 'income', text: 'Πώληση', amount: 105, category: 'κάτι άλλο' },
    ],
  });
  const p = parseUnderstanding(raw, 2, 0);
  assert.equal(p.reminders.length, 1);
  assert.deepEqual(p.done, [1]);
  assert.deepEqual(
    p.facts.map((f) => [f.kind, f.amount ?? f.value, f.category]),
    [
      ['expense', 70, 'αυτοκίνητο'],
      ['measure', 283250, null],
      ['income', 105, 'άλλο'],
    ],
  );
});

test('repeating tasks and stop requests reach the model', () => {
  assert.ok(worthUnderstanding('Κάθε Δευτέρα να βγάζω τα σκουπίδια.'));
  assert.ok(worthUnderstanding('Τις καθημερινές στις 7 να πηγαίνω τη Θεοδόρα σχολείο.'));
  assert.ok(worthUnderstanding('Σταμάτα να μου θυμίζεις τα σκουπίδια.'));
});
