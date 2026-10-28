import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyPaymongoWebhookSignature, createPaymongoCheckoutSession } from '../services/paymongoService.js';

test('webhook verifies original bytes, rejects tampering, stale events and missing secrets', () => {
  const original = { secret: process.env.PAYMONGO_WEBHOOK_SECRET_KEY, key: process.env.PAYMONGO_SECRET_KEY };
  process.env.PAYMONGO_WEBHOOK_SECRET_KEY = 'whsk_test_fixture';
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_fixture';
  try {
    const rawBody = Buffer.from('{ "data": {"attributes": {"livemode": false}} }');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET_KEY).update(`${timestamp}.${rawBody}`).digest('hex');
    const req = { rawBody, body: JSON.parse(rawBody), headers: { 'paymongo-signature': `t=${timestamp},te=${signature},li=` } };
    assert.equal(verifyPaymongoWebhookSignature(req), true);
    assert.equal(verifyPaymongoWebhookSignature({ ...req, rawBody: Buffer.from(JSON.stringify(req.body)) }), false);
    assert.equal(verifyPaymongoWebhookSignature({ ...req, headers: { 'paymongo-signature': `t=${timestamp - 600},te=${signature}` } }), false);
    assert.equal(verifyPaymongoWebhookSignature({ ...req, headers: {} }), false);
    delete process.env.PAYMONGO_WEBHOOK_SECRET_KEY;
    assert.equal(verifyPaymongoWebhookSignature(req), false);
  } finally {
    for (const [envKey, value] of [['PAYMONGO_WEBHOOK_SECRET_KEY', original.secret], ['PAYMONGO_SECRET_KEY', original.key]]) {
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
  }
});

test('production cannot create simulated checkout with missing credentials', async () => {
  const original = { mode: process.env.NODE_ENV, key: process.env.PAYMONGO_SECRET_KEY };
  process.env.NODE_ENV = 'production';
  delete process.env.PAYMONGO_SECRET_KEY;
  try { await assert.rejects(createPaymongoCheckoutSession({ reference: 'test', amount: 100 }), /not configured/); }
  finally {
    if (original.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.mode;
    if (original.key === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = original.key;
  }
});
