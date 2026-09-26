import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestSession, readGuestSession } from '../lib/guest-session.ts';
void test('independent visitor identities; tampering, wrong signing key and expiry fail', async () => {
  const secret = 'a'.repeat(48);
  const a = await createGuestSession(secret), b = await createGuestSession(secret);
  assert.notEqual(await readGuestSession(a, secret), await readGuestSession(b,secret));
  assert.match((await readGuestSession(a, secret))!, /^guest:/);
  assert.equal(await readGuestSession(a.replace(/.$/, a.endsWith('0')?'1':'0'),secret),null);
  assert.equal(await readGuestSession(a,'b'.repeat(48)),null);
  assert.equal(await readGuestSession(a.replace(/\.\d{10}\./,'.1000000000.'),secret),null);
});
