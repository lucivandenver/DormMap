import { test } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../models/userModel.js';
import { resolveGoogleAccount } from '../services/googleAccountService.js';
const profile = { id: 'google-test-id', displayName: 'BPLO', emails: [{ value: 'ADMIN@example.test' }], _json: { email_verified: true } };
test('only a verified Google email explicitly configured by the operator can provision admin', async t => {
  t.mock.method(User, 'findOne', async () => null);
  let created;
  t.mock.method(User, 'create', async data => { created = data; return { id: 1, ...data }; });
  assert.equal((await resolveGoogleAccount(profile, 'login_only', {})).error, 'no_account');
  assert.equal(created, undefined);
  assert.equal((await resolveGoogleAccount({ ...profile, _json: { email_verified: false } }, 'login_only', { ADMIN_GOOGLE_EMAILS: 'admin@example.test' })).error, 'unverified_google_email');
  const result = await resolveGoogleAccount(profile, 'login_only', { ADMIN_GOOGLE_EMAILS: ' admin@example.test ' });
  assert.equal(result.user.accountType, 'super_admin');
  assert.equal(created.email, 'admin@example.test');
  assert.equal(created.applicationStatus, 'approved');
});
test('public OAuth role parameters cannot create an administrator', async t => {
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User, 'create', async () => assert.fail('Public signup must not create admin'));
  assert.equal((await resolveGoogleAccount(profile, 'super_admin', {})).error, 'invalid_registration_role');
});
test('Google preserves existing admin role and refuses suspended accounts', async t => {
  const user = { id: 8, accountType: 'super_admin', update: async () => {} };
  t.mock.method(User, 'findOne', async () => user);
  assert.equal((await resolveGoogleAccount(profile, 'login_only', {})).user.accountType, 'super_admin');
  user.isSuspended = true;
  assert.equal((await resolveGoogleAccount(profile, 'login_only', {})).error, 'account_unavailable');
});
test('the operator allowlist can correct an existing account role after verified Google sign-in', async t => {
  const user = { id: 9, accountType: 'tenant', update: async function(values) { Object.assign(this, values); } };
  t.mock.method(User, 'findOne', async () => user);
  const result = await resolveGoogleAccount(profile, 'login_only', { ADMIN_GOOGLE_EMAILS: 'admin@example.test' });
  assert.equal(result.user.accountType, 'super_admin');
});
