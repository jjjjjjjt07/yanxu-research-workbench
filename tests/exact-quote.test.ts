import test from 'node:test';
import assert from 'node:assert/strict';
import { exactQuote } from '../lib/exact-quote.ts';
void test('whitespace and PDF ligatures return literal original text', () => {
  const text = 'A signiﬁcant\n result on QM 9.';
  assert.equal(exactQuote(text, 'significant result on QM9'), 'signiﬁcant\n result on QM 9');
  assert.equal(exactQuote('α β😀test', 'αβ😀test'), 'α β😀test');
});
void test('reject changed punctuation, missing passages, tiny and ambiguous matches', () => {
  assert.equal(exactQuote('message pass-\ning', 'message passing'), null);
  assert.equal(exactQuote('measured 10.1', 'measured 101'), null);
  assert.equal(exactQuote('not demonstrated', 'demonstrated causation'), null);
  assert.equal(exactQuote('ab', 'ab'), null);
  assert.equal(exactQuote('a bc and ab c', 'abc'), null);
});
