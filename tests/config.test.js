import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { databaseConfig } from '../config/database.js';
import { sessionOptions, sessionStore } from '../config/session.js';
import { prepareUploads } from '../config/storage.js';

after(() => sessionStore.stopExpiringSessions());

test('local MySQL defaults and custom Aiven port', () => {
  assert.equal(databaseConfig({}).port, 3306);
  assert.equal(databaseConfig({ DB_PORT: '24873' }).port, 24873);
  assert.throws(() => databaseConfig({ DB_PORT: 'invalid' }), /DB_PORT/);
});

test('Aiven SSL requires a CA and verifies the server certificate', () => {
  assert.throws(() => databaseConfig({ DB_SSL: 'true' }), /CA certificate/);
  const config = databaseConfig({ DB_SSL: 'true', DB_SSL_CA: 'line1\\nline2' });
  assert.equal(config.ssl.ca, 'line1\nline2');
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.verifyIdentity, true);
  assert.equal(config.ssl.minVersion, 'TLSv1.2');
  assert.throws(() => databaseConfig({ NODE_ENV: 'production' }), /DB_NAME/);
  assert.throws(() => databaseConfig({ NODE_ENV: 'production', DB_NAME: 'defaultdb', DB_USER: 'avnadmin', DB_PASSWORD: 'example', DB_HOST: 'example.invalid' }), /DB_SSL/);
});

test('production cookies require a durable secret and HTTPS', () => {
  assert.throws(() => sessionOptions({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  const options = sessionOptions({ NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(64) });
  assert.equal(options.cookie.secure, true);
  assert.equal(options.cookie.httpOnly, true);
  assert.equal(options.cookie.sameSite, 'lax');
  assert.equal(sessionOptions({}).cookie.secure, false);
});

test('moving uploads onto a disk preserves newer files on repeated starts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dormmap-storage-'));
  const source = path.join(directory, 'source');
  const target = path.join(directory, 'disk');
  try {
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'old.jpg'), 'original');
    prepareUploads(target, source);
    assert.equal(fs.readFileSync(path.join(target, 'old.jpg'), 'utf8'), 'original');
    fs.writeFileSync(path.join(target, 'old.jpg'), 'newer disk copy');
    fs.writeFileSync(path.join(target, 'new.jpg'), 'new upload');
    prepareUploads(target, source);
    assert.equal(fs.readFileSync(path.join(target, 'old.jpg'), 'utf8'), 'newer disk copy');
    assert.equal(fs.readFileSync(path.join(target, 'new.jpg'), 'utf8'), 'new upload');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
