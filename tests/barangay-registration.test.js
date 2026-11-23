import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { User, sequelize } from '../models/userModel.js';
import { registerUser } from '../controllers/authController.js';
import { requireBarangayOfficial } from '../middleware/barangayAuth.js';

test('password barangay registration creates a pending account and explains approval', async t => {
  let created;
  t.mock.method(sequelize, 'transaction', async callback => callback({}));
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User, 'create', async values => {
    created = { id: 7, ...values };
    return { id: 7, update: async changes => Object.assign(created, changes) };
  });
  t.mock.method(sequelize.models.ReviewFile, 'create', async values => assert.equal(values.scope, 'barangay-registration'));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async () => ({ messageId: 'local-test' }) }));
  const body = { accountType: 'barangay', fullName: 'Test Official', email: 'official@example.test', password: 'test-password-123', confirmPassword: 'test-password-123', acceptTerms: 'on', barangay: 'Labasan' };
  let redirect;
  const files = { validIdPicture: [{ originalname: 'official.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }] };
  let error;
  await registerUser({ body, files: {}, session: {} }, { render: (_, values) => { error = values.authError; } });
  assert.match(error, /government-issued ID/);
  assert.equal(created, undefined);
  await registerUser({ body, files, session: {} }, { redirect: value => { redirect = value; }, render: () => assert.fail('Registration should succeed') });
  assert.equal(created.applicationStatus, 'pending');
  assert.match(created.validIdPicture, /^\/documents\/[^/]+\/official\.pdf$/);
  assert.equal(redirect, '/login?pendingApproval=1');
});

test('barangay authorization fails closed if approval cannot be checked', async t => {
  t.mock.method(User, 'findByPk', async () => { throw new Error('test database unavailable'); });
  t.mock.method(console, 'error', () => {});
  let status;
  const res = { status: code => { status = code; return res; }, send: () => {} };
  await requireBarangayOfficial({ session: { userId: 1, accountType: 'barangay' }, path: '/api/overview' }, res, () => assert.fail('Cannot authorize on a DB error'));
  assert.equal(status, 503);
});
