import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { sendPasswordResetLink, handleResetPassword } from '../controllers/authController.js';
import { User } from '../models/userModel.js';

function jsonResponse() {
  return {
    code: 200,
    set(fields) { this.headers = fields; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('password reset emails a public link, stores a digest, and consumes it only once', async t => {
  for (const [key, value] of Object.entries({
    GMAIL_OAUTH_CLIENT_ID: 'gmail-client-fixture',
    GMAIL_OAUTH_CLIENT_SECRET: 'gmail-secret-fixture',
    GMAIL_OAUTH_REFRESH_TOKEN: 'gmail-refresh-fixture',
    APP_BASE_URL: 'https://dormmap.example'
  })) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
  let email;
  let digest;
  let password;
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(request.body.get('grant_type'), 'refresh_token');
      assert.equal(request.body.get('refresh_token'), 'gmail-refresh-fixture');
      return Response.json({ access_token: 'access-token-fixture' });
    }
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/bplobongabongmunicipality%40gmail.com/messages/send');
    assert.equal(request.headers.Authorization, 'Bearer access-token-fixture');
    email = Buffer.from(JSON.parse(request.body).raw, 'base64url').toString('utf8');
    return Response.json({ id: 'email-fixture' });
  });
  t.mock.method(User, 'findOne', async ({ where }) => {
    if (where.resetPasswordToken) return digest === where.resetPasswordToken ? { id: 7 } : null;
    return { id: 7, email: 'tenant+registered@example.net' };
  });
  t.mock.method(User, 'update', async (values, { where }) => {
    if (where.resetPasswordToken && where.resetPasswordToken !== digest) return [0];
    digest = values.resetPasswordToken;
    if (values.password) password = values.password;
    return [1];
  });

  const request = body => ({ xhr: true, body });
  const sent = jsonResponse();
  await sendPasswordResetLink(request({ email: 'TENANT+registered@example.net' }), sent);
  assert.equal(sent.body.success, true);
  assert.match(email, /^From: .*<bplobongabongmunicipality@gmail\.com>/m);
  assert.match(email, /^To: tenant\+registered@example\.net\r?$/m);
  const decoded = email.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const link = new URL(decoded.match(/https:\/\/dormmap\.example\/reset-password\?token=[a-f0-9]{64}/)[0]);
  assert.equal(link.origin, 'https://dormmap.example');
  const token = link.searchParams.get('token');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(digest, createHash('sha256').update(token).digest('hex'));
  assert.doesNotMatch(JSON.stringify(sent.body), new RegExp(token));
  const newPassword = 'new-password-123';
  const payload = request({ token, password: newPassword, confirmPassword: newPassword });
  const results = [jsonResponse(), jsonResponse()];
  await Promise.all(results.map(response => handleResetPassword(payload, response)));
  assert.deepEqual(results.map(result => result.code).sort(), [200, 400]);
  assert.equal(results.find(result => result.code === 200).body.redirect, '/login?passwordUpdated=1');
  assert.equal(digest, null);
  assert.equal(await bcrypt.compare(newPassword, password), true);
});
