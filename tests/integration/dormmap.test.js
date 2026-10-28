import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';

test('MySQL migration, tenant shortlist, permissions, restart and uploads', {
  skip: process.env.RUN_DB_TESTS !== 'true', timeout: 90000,
}, async t => {
  // Never run fixture mutations against a normal local/production database.
  assert.match(process.env.DB_NAME || '', /_test$/);
  assert.notEqual(process.env.NODE_ENV, 'production');
  const { sequelize } = await import('../../models/db.js');
  const { migrateSchema, closeDatabase } = await import('../../services/schemaService.js');
  const { User } = await import('../../models/userModel.js');
  const { BoardingHouse, OwnerRoom } = await import('../../models/ownerModels.js');
  const { SavedDorm } = await import('../../models/savedDormModel.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dormmap-integration-'));
  let server;
  let base;
  let ids = [];
  async function start() {
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, ['index.js'], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, NODE_ENV: 'development', PORT: String(port), UPLOAD_DIR: directory, SESSION_SECRET: 'integration-session-secret-keep-between-restarts' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let output = '';
      const deadline = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 20000);
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('XianFire running on port')) { clearTimeout(deadline); resolve(); }
      });
      server.stderr.on('data', data => { output += data; });
      server.once('exit', code => { clearTimeout(deadline); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    base = `http://127.0.0.1:${port}`;
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const done = once(server, 'exit');
    server.kill('SIGTERM');
    await done;
  }
  const request = (url, cookie, options = {}) => fetch(base + url, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' });
  async function login(email) {
    const response = await request('/login', null, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password: 'test-password-123' }) });
    assert.equal(response.status, 302);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    await migrateSchema({ createDatabase: true });
    const suffix = Date.now();
    const password = await bcrypt.hash('test-password-123', 4);
    const users = await User.bulkCreate([
      { fullName: 'Review Tenant', email: `review-${suffix}@example.test`, password, accountType: 'tenant', emailVerified: true },
      { fullName: 'Second Tenant', email: `second-${suffix}@example.test`, password, accountType: 'tenant', emailVerified: true },
      { fullName: 'Review Owner', email: `owner-${suffix}@example.test`, password, accountType: 'boarding_house_owner', applicationStatus: 'approved', barangay: 'Poblacion', emailVerified: true },
      { fullName: 'Pending Owner', email: `pending-${suffix}@example.test`, password, accountType: 'boarding_house_owner', applicationStatus: 'pending', emailVerified: true },
    ]);
    ids = users.map(user => user.id);
    const [tenant, second, owner, pending] = users;
    const house = await BoardingHouse.create({ ownerId: owner.id, name: `Review Dorm ${suffix}`, barangay: 'Orconuma', isPrimary: true });
    const room = await OwnerRoom.create({ ownerId: owner.id, boardingHouseId: null, roomNumber: 'R1', rentalPrice: 1800, status: 'available', availableSlots: 1 });
    await OwnerRoom.create({ ownerId: owner.id, boardingHouseId: house.id, roomNumber: 'FULL', rentalPrice: 900, status: 'available', availableSlots: 0 });

    await t.test('additive migration keeps records and unknown columns', async () => {
      const qi = sequelize.getQueryInterface();
      const { DataTypes } = await import('sequelize');
      const columns = await qi.describeTable('Users');
      if (!columns.reviewLegacyColumn) await qi.addColumn('Users', 'reviewLegacyColumn', { type: DataTypes.STRING, allowNull: true });
      await sequelize.query('UPDATE Users SET reviewLegacyColumn = ? WHERE id = ?', { replacements: ['preserve me', tenant.id] });
      await qi.removeColumn('Users', 'profilePicture');
      await migrateSchema();
      await migrateSchema();
      const [[row]] = await sequelize.query('SELECT name, reviewLegacyColumn FROM Users WHERE id = ?', { replacements: [tenant.id] });
      assert.equal(row.name, tenant.fullName);
      assert.equal(row.reviewLegacyColumn, 'preserve me');
      assert.ok((await qi.describeTable('Users')).profilePicture);
    });
    await start();
    const cookie = await login(tenant.email);
    await t.test('health, login and template render work', async () => {
      assert.equal((await request('/healthz')).status, 200);
      const response = await request('/tenant-dashboard', cookie);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /browseCompareButton/);
    });
    const key = `bh-${house.id}`;
    await t.test('browse respects approvals, establishment barangay and vacancy', async () => {
      const response = await request('/tenant-dashboard/api/browse-boarding-houses?barangay=Orconuma&maxBudget=2000&availableOnly=true', cookie);
      assert.equal(response.status, 200);
      const data = await response.json();
      const item = data.boardingHouses.find(item => item.id === key);
      assert.ok(item);
      assert.equal(item.roomsAvailable, 1);
      assert.equal(item.rentalPriceMin, 1800);
      assert.equal(item.latitude, null);
      assert.ok(!data.boardingHouses.some(item => item.ownerId === pending.id));
      assert.equal((await request('/tenant-dashboard/api/browse-boarding-houses?maxBudget=bad', cookie)).status, 400);
    });
    await t.test('saved dorms are idempotent and isolated per tenant', async () => {
      assert.equal((await request(`/tenant-dashboard/api/saved-dorms/${key}`, null, { method: 'PUT' })).status, 401);
      const ownerCookie = await login(owner.email);
      assert.equal((await request(`/tenant-dashboard/api/saved-dorms/${key}`, ownerCookie, { method: 'PUT' })).status, 403);
      assert.equal((await request('/tenant-dashboard/api/saved-dorms/bad-key', cookie, { method: 'PUT' })).status, 400);
      for (let n = 0; n < 2; n++) assert.equal((await request(`/tenant-dashboard/api/saved-dorms/${key}`, cookie, { method: 'PUT' })).status, 200);
      assert.equal(await SavedDorm.count({ where: { tenantId: tenant.id, listingKey: key } }), 1);
      const secondCookie = await login(second.email);
      await request(`/tenant-dashboard/api/saved-dorms/${key}`, secondCookie, { method: 'DELETE' });
      assert.equal(await SavedDorm.count({ where: { tenantId: tenant.id, listingKey: key } }), 1);
      const data = await (await request('/tenant-dashboard/api/browse-boarding-houses?savedOnly=true', cookie)).json();
      assert.equal(data.boardingHouses.length, 1);
      assert.equal(data.boardingHouses[0].isSaved, true);
    });
    await t.test('login session, saved choices and upload files survive a server restart', async () => {
      fs.writeFileSync(path.join(directory, 'review-persistent.txt'), 'persistent upload');
      await stop();
      await start();
      const response = await request('/tenant-dashboard/api/browse-boarding-houses?savedOnly=true', cookie);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).boardingHouses[0].id, key);
      assert.equal(await (await request('/uploads/review-persistent.txt')).text(), 'persistent upload');
      assert.equal((await request('/api/payments/seed-demo')).status, 404);
    });
    await request(`/tenant-dashboard/api/saved-dorms/${key}`, cookie, { method: 'DELETE' });
    assert.equal(await SavedDorm.count({ where: { tenantId: tenant.id } }), 0);
    assert.ok(room.id);
  } finally {
    await stop();
    if (ids.length) {
      const { Op } = await import('sequelize');
      await SavedDorm.destroy({ where: { tenantId: { [Op.in]: ids } } });
      await OwnerRoom.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await BoardingHouse.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await User.destroy({ where: { id: { [Op.in]: ids } } });
    }
    await closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
