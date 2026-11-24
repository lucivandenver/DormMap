import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import signature from 'cookie-signature';

test('MySQL migration, tenant shortlist, permissions, restart and uploads', {
  skip: process.env.RUN_DB_TESTS !== 'true', timeout: 90000,
}, async t => {
  // Never run fixture mutations against a normal local/production database.
  assert.match(process.env.DB_NAME || '', /_test$/);
  assert.notEqual(process.env.NODE_ENV, 'production');
  const { sequelize } = await import('../../models/db.js');
  const { migrateSchema, closeDatabase } = await import('../../services/schemaService.js');
  const { User } = await import('../../models/userModel.js');
  const { BoardingHouse, OwnerRoom, OwnerTenant, OwnerGallery, OwnerInquiry } = await import('../../models/ownerModels.js');
  const { Barangay, EducationalInstitution, BarangayNotification } = await import('../../models/adminModels.js');
  const { TenantApplication } = await import('../../models/tenantModels.js');
  const { OwnerPayment } = await import('../../models/ownerModels.js');
  const { Payment, PaymentReceipt, PaymentWebhook, PaymentAuditLog } = await import('../../models/paymentModels.js');
  const { initiateRentPayment, handlePaymongoWebhookPayload } = await import('../../services/paymentService.js');
  const { saveRoom, saveTenant, offerApplication, confirmOffer } = await import('../../services/occupancyService.js');
  const { SavedDorm } = await import('../../models/savedDormModel.js');
  const { TenantDocument } = await import('../../models/tenantModels.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dormmap-integration-'));
  let server;
  let base;
  let ids = [];
  const uploadedFiles = [];
  const fixturePassword = `Test1-${crypto.randomUUID()}`;
  const sessionSecret = crypto.randomUUID();
  const mockPaymentKey = `sk_test_${crypto.randomBytes(16).toString('hex')}`;
  const mockWebhookSecret = crypto.randomUUID();
  async function start({ deniedUploads = false, freshUploads = false } = {}) {
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const preload = path.join(directory, 'deny-upload.mjs');
    if (deniedUploads) fs.writeFileSync(preload, `
      import fs from 'node:fs';
      const mkdir = fs.mkdirSync.bind(fs);
      fs.mkdirSync = (target, options) => {
        if (target === process.env.UPLOAD_DIR) {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        }
        return mkdir(target, options);
      };
    `);
    server = spawn(process.execPath, [...(deniedUploads ? ['--import', preload] : []), 'index.js'], {
      cwd: new URL('../../', import.meta.url),
      env: { ...process.env, NODE_ENV: 'development', PORT: String(port), UPLOAD_DIR: deniedUploads ? path.join(directory, 'denied-mount') : (freshUploads ? path.join(directory, 'fresh-uploads') : directory), UPLOAD_DIR_STRICT: 'false', SESSION_SECRET: sessionSecret, PAYMONGO_SECRET_KEY: mockPaymentKey, PAYMONGO_WEBHOOK_SECRET_KEY: mockWebhookSecret },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 20000);
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('XianFire running on port')) { clearTimeout(deadline); resolve(); }
      });
      server.stderr.on('data', data => { output += data; });
      server.once('exit', code => { clearTimeout(deadline); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    base = `http://127.0.0.1:${port}`;

    // The HTTP port opens before database/session initialization so Render can
    // detect it promptly. Wait for the readiness endpoint before assertions.
    const readyDeadline = Date.now() + 20000;
    while (Date.now() < readyDeadline) {
      if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}: ${output}`);
      try {
        const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200) return;
      } catch { /* Retry while the database and session store are starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server readiness timed out: ${output}`);
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const done = once(server, 'exit');
    server.kill('SIGTERM');
    await done;
  }
  const request = (url, cookie, options = {}) => fetch(base + url, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' });
  async function login(email) {
    const response = await request('/login', null, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password: fixturePassword }) });
    assert.equal(response.status, 302);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    await migrateSchema({ createDatabase: true });
    const suffix = Date.now();
    // A bcrypt 5 hash must remain usable after updating the runtime to bcrypt 6.
    const password = await bcrypt.hash(fixturePassword, 4);
    const users = await User.bulkCreate([
      { fullName: 'Review Tenant', email: `review-${suffix}@example.test`, password, accountType: 'tenant', emailVerified: true },
      { fullName: 'Second Tenant', email: `second-${suffix}@example.test`, password, accountType: 'tenant', emailVerified: true },
      { fullName: 'Review Owner', email: `owner-${suffix}@example.test`, password, accountType: 'boarding_house_owner', applicationStatus: 'approved', barangay: 'Poblacion', emailVerified: true },
      { fullName: 'Pending Owner', email: `pending-${suffix}@example.test`, password, accountType: 'boarding_house_owner', applicationStatus: 'pending', emailVerified: true },
    ]);
    ids = users.map(user => user.id);
    const [tenant, second, owner, pending] = users;
    const official = await User.create({ fullName: 'Pending Official', email: `official-${suffix}@example.test`, password, accountType: 'barangay', barangay: 'Review Barangay', applicationStatus: 'pending', emailVerified: true });
    const admin = await User.create({ fullName: 'Review BPLO', email: `admin-${suffix}@example.test`, password, accountType: 'super_admin', emailVerified: true });
    ids.push(official.id, admin.id);
    await Barangay.create({ name: `Review Barangay ${suffix}`, latitude: 12.72, longitude: 121.47 });
    await EducationalInstitution.create({ name: `Review School ${suffix}`, schoolType: 'University', latitude: 12.72, longitude: 121.47 });
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
    await t.test('admin SQL backup restores the tables and data into an empty MySQL database', async () => {
      const { createConnection, escapeId } = await import('mysql2/promise');
      const { databaseConfig } = await import('../../config/database.js');
      const { database, username, ...config } = databaseConfig();
      const connection = await createConnection({
        ...config, database, user: username, multipleStatements: true, dateStrings: true, jsonStrings: true,
        supportBigNumbers: true, bigNumberStrings: true,
      });
      const restoreName = escapeId(`dormmap_restore_${suffix}_test`);
      const endpoint = '/admin/api/maintenance/backup';
      const adminCookie = await login(admin.email);
      const readFixture = `SELECT id, parentId, note, createdDate, modifiedAt, lastSeen, metadata, bytes, flags,
        preciseDecimal, noteLength, hiddenNote FROM BackupFixture ORDER BY id`;
      try {
        assert.equal((await request(endpoint)).status, 403);
        assert.equal((await request(endpoint, cookie)).status, 403);
        assert.equal((await request(endpoint, await login(owner.email))).status, 403);
        assert.equal((await request(endpoint, adminCookie, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
        await admin.update({ isSuspended: true });
        try { assert.equal((await request(endpoint, adminCookie)).status, 403); }
        finally { await admin.update({ isSuspended: false }); }
        const dashboard = await request('/admin', adminCookie);
        assert.match(await dashboard.text(), /href="\/admin\/api\/maintenance\/backup" download>[\s\S]*?Export Database \(\.sql\)/);

        await connection.query(`
          SET SESSION time_zone = '+00:00';
          SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';
          CREATE TABLE BackupParent (id INT PRIMARY KEY AUTO_INCREMENT) ENGINE=InnoDB;
          CREATE TABLE BackupFixture (
            id BIGINT UNSIGNED PRIMARY KEY,
            parentId INT NULL,
            note TEXT COLLATE utf8mb4_0900_ai_ci COMMENT 'Preserve text COLLATE utf8mb4_0900_ai_ci',
            createdDate DATE,
            modifiedAt DATETIME(6),
            lastSeen TIMESTAMP(6) NULL,
            metadata JSON,
            bytes BLOB,
            flags BIT(8),
            preciseDecimal DECIMAL(30, 12),
            noteLength INT GENERATED ALWAYS AS (CHAR_LENGTH(note)) STORED,
            hiddenNote VARCHAR(100) INVISIBLE,
            FOREIGN KEY (parentId) REFERENCES BackupParent(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
          INSERT INTO BackupParent (id) VALUES (0);
        `);
        const note = "O'Brien's \"room\" 🏠\\window\n\0\x1a'); DROP TABLE Users; -- ";
        await connection.execute(
          `INSERT INTO BackupFixture
            (id, parentId, note, createdDate, modifiedAt, lastSeen, metadata, bytes, flags, preciseDecimal, hiddenNote)
             VALUES (?, 0, ?, '2024-02-29', '2024-02-29 23:08:19.123456', '2024-02-29 04:03:02.654321',
              ?, ?, b'10100101', ?, 'invisible'), (1, NULL, NULL, NULL, NULL, NULL, 'null', NULL, NULL, NULL, NULL)`,
          ['18446744073709551615', note, '{"precise":9007199254740993, "nested":["a",null]}',
            Buffer.from([0x00, 0xff, 0x27, 0x5c]), '123456789012345678.876543219876'],
        );
        const [sourceRows] = await connection.query(readFixture);
        const [sourceTables] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
        const response = await request(endpoint, adminCookie);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^application\/sql/);
        assert.match(response.headers.get('content-disposition'), /^attachment; filename="database_backup_\d{4}-\d{2}-\d{2}\.sql"$/);
        assert.match(response.headers.get('cache-control'), /no-store/);
        const sql = await response.text();
        assert.ok(sql.startsWith('SET FOREIGN_KEY_CHECKS=0;\n'));
        assert.ok(sql.trimEnd().endsWith('SET FOREIGN_KEY_CHECKS=1;'));
        const noteSchema = sql.split('\n').find(line => line.startsWith('  `note` text'));
        assert.match(noteSchema, /COLLATE utf8mb4_general_ci/);
        assert.match(noteSchema, /COMMENT 'Preserve text COLLATE utf8mb4_0900_ai_ci'/);
        assert.ok(sql.includes('DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci'));

        await connection.query(`CREATE DATABASE ${restoreName} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
        await connection.query(`USE ${restoreName}`);
        await connection.query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'; SET SESSION time_zone = '+08:00'");
        await connection.query(sql);
        const [[session]] = await connection.query('SELECT @@SESSION.foreign_key_checks AS checks, @@SESSION.sql_mode AS mode, @@SESSION.time_zone AS zone');
        assert.deepEqual(session, { checks: '1', mode: 'NO_BACKSLASH_ESCAPES', zone: '+08:00' });
        await connection.query("SET SESSION time_zone = '+00:00'");
        const [restoredRows] = await connection.query(readFixture);
        assert.deepEqual(restoredRows, sourceRows);
        const [restoredTables] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
        const names = tables => tables.map(table => Object.values(table)[0]).sort();
        assert.deepEqual(names(restoredTables), names(sourceTables));
        const [[restoredAdmin]] = await connection.execute('SELECT password FROM Users WHERE id = ?', [admin.id]);
        assert.equal(restoredAdmin.password, password);
        const [[restoredParent]] = await connection.query('SELECT id FROM BackupParent');
        assert.equal(restoredParent.id, 0);
      } finally {
        await connection.query(`DROP DATABASE IF EXISTS ${restoreName}`);
        await connection.query(`USE ${escapeId(database, true)}`);
        await connection.query('DROP TABLE IF EXISTS BackupFixture, BackupParent');
        await connection.end();
      }
    });
    await t.test('landing data uses real public inventory, resident records and valid map coordinates', async () => {
      const before = await (await request('/api/landing-data')).json();
      const item = before.listings.find(item => item.ownerId === owner.id);
      assert.equal(item.roomsAvailable, 1);
      assert.equal(item.latitude, null);
      assert.equal(item.rentalPriceMin, 1800);
      assert.equal(item.password, undefined);
      assert.equal(item.email, undefined);
      await OwnerTenant.create({ ownerId: owner.id, fullName: 'Active Resident', status: 'active' });
      await OwnerTenant.create({ ownerId: owner.id, fullName: 'Former Resident', status: 'moved_out' });
      const after = await (await request('/api/landing-data')).json();
      assert.equal(after.stats.activeTenants, before.stats.activeTenants + 1);
      assert.equal(after.stats.registeredHouses, after.listings.length);
      const place = await (await request('/api/map-place?' + new URLSearchParams({ kind: 'institution', name: `Review School ${suffix}` }))).json();
      assert.equal(place.latitude, 12.72);
      const page = await (await request('/')).text();
      assert.match(page, /<title>DormMap<\/title>/);
      assert.ok(!page.includes('data-target="128"'));
    });
    await t.test('BPLO review gates barangay pages/APIs and owner registration eligibility', async () => {
      const officialCookie = await login(official.email);
      const adminCookie = await login(admin.email);
      assert.equal((await request('/barangay-dashboard', officialCookie)).status, 403);
      assert.equal((await request('/barangay-dashboard/api/overview', officialCookie)).status, 403);
      const body = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) };
      assert.equal((await request(`/admin/api/barangay-accounts/${official.id}/review`, cookie, body)).status, 403);
      assert.equal((await request(`/admin/api/barangay-accounts/${official.id}/review`, adminCookie, body)).status, 200);
      assert.equal((await request('/barangay-dashboard', officialCookie)).status, 200);
      assert.ok((await (await request('/api/eligible-barangays')).json()).includes('Review Barangay'));
      const suspended = { ...body, body: JSON.stringify({ action: 'suspend', note: 'Review test' }) };
      assert.equal((await request(`/admin/api/barangay-accounts/${official.id}/review`, adminCookie, suspended)).status, 200);
      assert.equal((await request('/barangay-dashboard/api/overview', officialCookie)).status, 403);
      assert.ok(!(await (await request('/api/eligible-barangays')).json()).includes('Review Barangay'));
      const rejected = await request('/register', null, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ accountType: 'boarding_house_owner', fullName: 'Blocked Owner', email: `blocked-${suffix}@example.test`, password: fixturePassword, confirmPassword: fixturePassword, acceptTerms: 'on', boardingHouseAddress: 'Review Barangay' }) });
      assert.match(await rejected.text(), /does not have an approved, active official/);
      assert.equal(await User.count({ where: { email: `blocked-${suffix}@example.test` } }), 0);
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
    await t.test('an EACCES disk does not prevent boot, multipart upload or file download', async () => {
      await stop();
      await start({ deniedUploads: true });
      assert.equal((await request('/healthz')).status, 200);
      const form = new FormData();
      form.set('title', 'Fallback storage check');
      form.set('docType', 'other');
      form.set('document', new Blob(['fallback upload works'], { type: 'text/plain' }), 'fallback-check.txt');
      const response = await request('/tenant-dashboard/api/documents', cookie, { method: 'POST', body: form });
      assert.equal(response.status, 201, await response.clone().text());
      const data = await response.json();
      assert.match(data.document.fileUrl, /^\/documents\/[0-9a-f-]{36}\/fallback-check\.txt$/);
      const download = await request(data.document.fileUrl, cookie);
      assert.equal(download.status, 200);
      assert.equal(await download.text(), 'fallback upload works');
      assert.equal((await request(data.document.fileUrl)).status, 404);
      assert.equal((await request(data.document.fileUrl, await login(second.email))).status, 404);

      await stop();
      await start({ freshUploads: true });
      const persistedDownload = await request(data.document.fileUrl, cookie);
      assert.equal(persistedDownload.status, 200);
      assert.equal(await persistedDownload.text(), 'fallback upload works');
    });
    await t.test('room capacity, transfers, move-out, ownership and billing are connected', async () => {
      await owner.update({ barangay: 'Orconuma', boardingHouseName: house.name, mapPin: 'Lat 12.72, Lon 121.47', boardingHouseLatitude: '12.72', boardingHouseLongitude: '121.47' });
      const ownerCookie = await login(owner.email);
      const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const r = await request('/owner-dashboard/api/rooms', ownerCookie, post({ boardingHouseId: house.id, roomNumber: 'Shared', capacity: 2, availableSlots: 2, rentalPrice: 1800 }));
      assert.equal(r.status, 201, await r.clone().text()); const shared = (await r.json()).data;
      const residents = await Promise.all(['One','Two'].map(fullName => request('/owner-dashboard/api/tenants', ownerCookie, post({ roomId: shared.id, fullName, monthlyRent: 1800 }))));
      assert.ok(residents.every(response => response.status === 201));
      const resident = (await residents[0].json()).data;
      const full = await OwnerRoom.findByPk(shared.id); assert.equal(full.availableSlots, 0); assert.equal(full.status, 'occupied');
      assert.equal((await request('/owner-dashboard/api/tenants', ownerCookie, post({ roomId: shared.id, fullName: 'Overbooking', monthlyRent: 1800 }))).status, 409);
      const patch = body => ({ ...post(body), method: 'PATCH' });
      assert.equal((await request(`/owner-dashboard/api/rooms/${shared.id}`, ownerCookie, patch({ capacity: 1 }))).status, 422);
      const transferRoom = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Transfer', capacity: 1, rentalPrice: 1800 });
      assert.equal((await request(`/owner-dashboard/api/tenants/${resident.id}`, ownerCookie, patch({ roomId: transferRoom.id }))).status, 200);
      assert.equal((await OwnerRoom.findByPk(shared.id)).availableSlots, 1);
      assert.equal((await OwnerRoom.findByPk(transferRoom.id)).availableSlots, 0);
      assert.equal((await request(`/owner-dashboard/api/rooms/${shared.id}`, ownerCookie, { method: 'DELETE' })).status, 409);
      const billResponse = await request('/owner-dashboard/api/payments', ownerCookie, post({ tenantId: resident.id, amount: 1800, dueDate: '2026-11-01', month: '2026-11' }));
      assert.equal(billResponse.status, 201); const bill = (await billResponse.json()).data;
      assert.equal(Number((await OwnerTenant.findByPk(resident.id)).balance), 1800);
      for (let n=0;n<2;n++) assert.equal((await request(`/owner-dashboard/api/payments/${bill.id}/pay`, ownerCookie, patch({ method: 'Cash' }))).status, 200);
      assert.equal(Number((await OwnerTenant.findByPk(resident.id)).balance), 0);
      const adminCookie = await login(admin.email);
      const overview = await (await request('/admin/api/overview', adminCookie)).json();
      assert.ok(overview.cards.occupiedRooms >= 1); assert.ok(overview.cards.occupancy > 0);
      assert.equal((await request(`/owner-dashboard/api/tenants/${resident.id}`, ownerCookie, patch({ status: 'moved_out' }))).status, 200);
      assert.equal((await OwnerRoom.findByPk(transferRoom.id)).availableSlots, 1);
      await assert.rejects(saveRoom(pending.id, null, { boardingHouseId: house.id, roomNumber: 'Foreign', capacity: 1, rentalPrice: 1000 }), /does not belong/);
    });
    await t.test('owner, barangay and BPLO module endpoints load connected records without server errors', async () => {
      const ownerCookie = await login(owner.email), adminCookie = await login(admin.email);
      await official.reload();
      await official.update({ barangay: 'Orconuma', applicationStatus: 'approved', isSuspended: false });
      const officialCookie = await login(official.email);
      for (const path of ['overview','profile','boarding-houses','rooms','tenants','payments','inquiries','messages','notifications','gallery','reports','activity-logs','permit','announcements','settings']) {
        const response = await request('/owner-dashboard/api/' + path, ownerCookie);
        assert.ok(response.status < 500, `Owner ${path}: ${await response.clone().text()}`);
      }
      for (const path of ['overview','applications','houses','permits','permit-alerts','map-houses','messages','notifications','audit-logs','tenants','reports','profile','data-requests','submissions','permit-renewals']) {
        const response = await request('/barangay-dashboard/api/' + path, officialCookie);
        assert.ok(response.status < 500, `Barangay ${path}: ${await response.clone().text()}`);
      }
      for (const path of ['overview','owners','barangay-accounts','barangays','institutions','permits','submissions','data-requests','permit-renewals','audit-logs','settings']) {
        const response = await request('/admin/api/' + path, adminCookie);
        assert.ok(response.status < 500, `BPLO ${path}: ${await response.clone().text()}`);
      }
    });
    await t.test('room offers consume a slot only on tenant confirmation and cannot overbook', async testCase => {
      const offeredRoom = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Offered', capacity: 1, rentalPrice: 0 });
      const originalHouse = { address: house.address, declaredRooms: house.declaredRooms };
      const originalContact = owner.contactNumber;
      testCase.after(async () => {
        await house.update(originalHouse);
        await owner.update({ contactNumber: originalContact });
      });
      await house.update({ address: house.barangay, declaredRooms: 1 });
      await owner.update({ contactNumber: null });
      const app = await TenantApplication.create({ tenantId: second.id, ownerId: owner.id, boardingHouseId: house.id, boardingHouseName: house.name });
      const offer = { applicationId: app.id, roomId: offeredRoom.id, monthlyRent: 1500 };
      await owner.update({ paymentMethods: '["GCash"]' });
      await assert.rejects(offerApplication(owner.id, second.id, offer), /Upload your GCash QR code/);
      await owner.update({ paymentMethods: '["Cash","GCash"]' });
      await assert.rejects(offerApplication(owner.id, second.id, offer), /Upload your GCash QR code/);
      await owner.update({ paymentMethods: '["Cash"]' });
      await assert.rejects(offerApplication(owner.id, second.id, { ...offer, monthlyRent: 0 }), /monthly total greater than zero/);
      const datedOffer = await offerApplication(owner.id, second.id, { ...offer, moveInDate: '2027-01-22' });
      assert.equal(Number(datedOffer.monthlyRent), 1500);
      assert.equal(datedOffer.moveInDate, '2027-01-22');
      assert.equal((await OwnerRoom.findByPk(offeredRoom.id)).availableSlots, 1);
      assert.equal(await OwnerTenant.count({ where: { tenantUserId: second.id } }), 0);
      await confirmOffer(second.id, app.id); await confirmOffer(second.id, app.id);
      assert.equal(await OwnerTenant.count({ where: { tenantUserId: second.id } }), 1);
      assert.equal((await OwnerTenant.findOne({ where: { tenantUserId: second.id } })).moveInDate, '2027-01-22');
      assert.equal((await OwnerRoom.findByPk(offeredRoom.id)).availableSlots, 0);
    });
    await t.test('unregistered map publication is explicitly scoped and excluded from rental applications', async () => {
      const adminCookie = await login(admin.email);
      const patch = action => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      assert.equal((await request(`/admin/api/owners/${owner.id}/map-status`, cookie, patch('unregistered'))).status, 403);
      assert.equal((await request(`/admin/api/owners/${owner.id}/map-status`, adminCookie, patch('unregistered'))).status, 200);
      let listings = await (await request('/api/boarding-houses')).json(); assert.ok(!listings.some(item => item.ownerId === owner.id));
      const officialCookie = await login(official.email);
      assert.equal((await request(`/barangay-dashboard/api/houses/${pending.id}/map-status`, officialCookie, patch('unregistered'))).status, 404);
      assert.equal((await request(`/barangay-dashboard/api/houses/${owner.id}/map-status`, officialCookie, patch('publish'))).status, 200);
      listings = await (await request('/api/boarding-houses')).json();
      assert.ok(listings.some(item => item.ownerId === owner.id && item.registrationStatus === 'unregistered'));
      const browsed = await (await request('/tenant-dashboard/api/browse-boarding-houses', cookie)).json(); assert.ok(!browsed.boardingHouses.some(item => item.ownerId === owner.id));
      assert.equal((await request(`/admin/api/owners/${owner.id}/map-status`, adminCookie, patch('registered'))).status, 200);
    });
    await t.test('concurrent inquiries create one application per tenant and owner', async () => {
      const applicant = await User.create({
        fullName: 'Duplicate Inquiry Test', email: `duplicate-${suffix}@example.test`, password,
        accountType: 'tenant', emailVerified: true
      });
      ids.push(applicant.id);
      const applicantCookie = await login(applicant.email);
      const ownerCookie = await login(owner.email);
      const values = { ownerId: owner.id, boardingHouseName: house.name, establishmentId: house.id };
      const responses = await Promise.all(Array.from({ length: 3 }, () => request('/tenant-dashboard/api/applications', applicantCookie, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
      })));
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409, 409]);
      const where = { ownerId: owner.id, tenantId: applicant.id, status: 'pending_owner' };
      assert.equal(await TenantApplication.count({ where }), 1);
      const duplicate = await TenantApplication.create({ ...where, boardingHouseName: house.name });
      const applications = await request('/owner-dashboard/api/pending-applications', ownerCookie);
      assert.equal(applications.status, 200);
      assert.equal((await applications.json()).data.filter(app => app.userId === applicant.id).length, 1);
      assert.equal((await duplicate.reload()).status, 'duplicate_closed');
    });
    await t.test('direct GCash and cash submissions preserve review dates and reduce balance once', async () => {
      const ownerCookie = await login(owner.email);
      const tenantCookie = await login(second.email);
      const unrelatedCookie = await login(tenant.email);
      const rental = await OwnerTenant.findOne({ where: { tenantUserId: second.id } });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=', 'base64');
      const setup = new FormData();
      setup.set('configureRentPayments', 'on');
      setup.append('paymentMethods', 'Cash');
      setup.append('paymentMethods', 'GCash');
      setup.append('paymentMethods', 'QR Ph');
      setup.set('qrPhCode', new Blob([png], { type: 'image/png' }), 'qrph.png');
      setup.set('gcashQrCode', new Blob([png], { type: 'image/png' }), 'qr.png');
      const saved = await request('/owner-dashboard/api/my-profile', ownerCookie, { method: 'PATCH', body: setup });
      assert.equal(saved.status, 200, await saved.clone().text());
      const history = await (await request('/tenant-dashboard/api/payments', tenantCookie)).json();
      assert.deepEqual(history.paymentOptions.methods, ['Cash', 'GCash', 'QR Ph']);
      const qr = history.paymentOptions.gcashQrCode;
      const qrPh = history.paymentOptions.qrCodes['QR Ph'];
      assert.notEqual(qrPh, qr);
      assert.equal((await request(qrPh, tenantCookie)).status, 200);
      assert.equal((await request(qrPh, unrelatedCookie)).status, 404);
      assert.equal((await request(qr, tenantCookie)).status, 200);
      assert.equal((await request(qr, unrelatedCookie)).status, 404);
      const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const initialBalance = Number(rental.balance);
      const invoice = await request('/owner-dashboard/api/payments', ownerCookie, json('POST', {
        tenantId: rental.id, amount: 250, dueDate: '2099-01-10'
      }));
      assert.equal(invoice.status, 201, await invoice.clone().text());
      const { data: bill } = await invoice.json();
      const oldCheckout = await Payment.create({
        tenantId: second.id, ownerId: owner.id, ownerTenantId: rental.id, tenantPaymentId: bill.id,
        billingMonth: bill.month, billingYear: 2099, internalReference: `OLD-${suffix}`,
        amount: 250, baseAmount: 250, status: 'PENDING'
      });
      const pay = `/tenant-dashboard/api/payments/${bill.id}/submit`;
      const fields = new FormData();
      fields.set('method', 'GCash');
      fields.set('reference', '0123456789012');
      fields.set('paidDate', history.today);
      fields.set('notes', 'Rent paid in advance.');
      fields.set('proof', new Blob([png], { type: 'image/png' }), 'proof.png');
      assert.equal((await request(pay, unrelatedCookie, { method: 'POST', body: fields })).status, 404);
      for (const invalid of ['123456789012', '12345678901234', 'A123456789012']) {
        fields.set('reference', invalid);
        const rejected = await request(pay, tenantCookie, { method: 'POST', body: fields });
        assert.equal(rejected.status, 422);
        assert.match((await rejected.json()).error, /13-digit GCash/);
      }
      fields.set('reference', '0123456789012');
      const payment = await request(pay, tenantCookie, { method: 'POST', body: fields });
      assert.equal(payment.status, 200, await payment.clone().text());
      const submitted = await payment.json();
      const { data: submission } = submitted;
      assert.match(submitted.message, /submitted successfully/);
      assert.equal(submission.status, 'pending');
      assert.equal(submission.reviewStatus, 'submitted');
      assert.equal(submission.submissionNotes, 'Rent paid in advance.');
      assert.equal(submission.submittedPaidDate, history.today);
      assert.equal(submission.submittedReference, '0123456789012');
      assert.equal((await request(submission.paymentProofUrl, ownerCookie)).status, 200);
      assert.equal((await request(submission.paymentProofUrl, unrelatedCookie)).status, 404);
      assert.equal((await request(pay, tenantCookie, { method: 'POST', body: fields })).status, 409);
      const confirm = `/owner-dashboard/api/payments/${bill.id}/pay`;
      const received = json('PATCH', { method: 'GCash', reference: submission.submittedReference,
        confirmedDate: history.today, submissionId: submission.submissionId });
      assert.equal((await request(confirm, ownerCookie, received)).status, 409);
      await oldCheckout.update({ status: 'EXPIRED' });
      assert.equal((await request(confirm, ownerCookie, received)).status, 200);
      assert.equal((await request(confirm, ownerCookie, received)).status, 200);
      assert.equal(Number((await rental.reload()).balance), initialBalance);
      const confirmed = await OwnerPayment.findByPk(bill.id);
      assert.equal(confirmed.reviewStatus, 'confirmed');
      assert.equal(confirmed.reviewDate, history.today);
      assert.equal(await BarangayNotification.count({ where: { userId: second.id, type: 'payment_confirmed' } }), 1);
      const cashInvoice = await request('/owner-dashboard/api/payments', ownerCookie, json('POST', {
        roomId: rental.roomId, amount: 100, dueDate: '2099-02-10'
      }));
      assert.equal(cashInvoice.status, 201, await cashInvoice.clone().text());
      const cashBill = (await cashInvoice.json()).data.find(item => item.tenantId === rental.id);
      const cash = new FormData();
      cash.set('method', 'Cash');
      cash.set('paidDate', history.today);
      assert.equal((await request(`/tenant-dashboard/api/payments/${cashBill.id}/submit`, tenantCookie, { method: 'POST', body: cash })).status, 200);
      const cashSubmission = await OwnerPayment.findByPk(cashBill.id);
      const declineUrl = `/owner-dashboard/api/payments/${cashBill.id}/submission`;
      assert.equal((await request(declineUrl, ownerCookie, json('DELETE', {
        submissionId: cashSubmission.submissionId, confirmedDate: history.today
      }))).status, 422);
      const decision = json('DELETE', { submissionId: cashSubmission.submissionId,
        confirmedDate: history.today, notes: 'Please verify the amount with the owner.' });
      assert.equal((await request(declineUrl, ownerCookie, decision)).status, 200);
      assert.equal((await request(declineUrl, ownerCookie, decision)).status, 200);
      assert.equal(await BarangayNotification.count({ where: { userId: second.id, type: 'payment_declined' } }), 1);
      const declinedHistory = await (await request('/tenant-dashboard/api/payments', tenantCookie)).json();
      const declined = declinedHistory.payments.find(item => item.id === cashBill.id);
      assert.equal(declined.reviewStatus, 'declined');
      assert.equal(declined.reviewNotes, 'Please verify the amount with the owner.');
      assert.equal((await request(`/tenant-dashboard/api/payments/${cashBill.id}/submit`, tenantCookie, { method: 'POST', body: cash })).status, 200);
      assert.equal((await request(declineUrl, ownerCookie, decision)).status, 409);
      const resubmission = await OwnerPayment.findByPk(cashBill.id);
      assert.equal((await request(`/owner-dashboard/api/payments/${cashBill.id}/pay`, ownerCookie,
        json('PATCH', { method: 'Cash', confirmedDate: history.today, submissionId: resubmission.submissionId }))).status, 200);
      assert.equal((await request('/api/payments/qrph/create', tenantCookie, json('POST', {}))).status, 410);
    });
    await t.test('QR Ph checkout binds the correct tenant bill; duplicate webhooks reconcile once', async () => {
      const linked = await OwnerTenant.findOne({ where: { tenantUserId: second.id, ownerId: owner.id } });
      const other = await OwnerTenant.create({ ownerId: owner.id, fullName: 'Different payer', balance: 900 });
      const bill = await OwnerPayment.create({ ownerId: owner.id, tenantId: linked.id, roomId: linked.roomId, amount: 1500, penalty: 50, month: '2026-12', dueDate: '2026-12-01' });
      await linked.update({ balance: 1550 });
      const foreignBill = await OwnerPayment.create({ ownerId: owner.id, tenantId: other.id, amount: 900, dueDate: '2026-12-01', month: '2026-12' });
      await assert.rejects(initiateRentPayment({ user: second, tenantPaymentId: foreignBill.id, billingMonth: '2026-12' }), /does not belong/);
      const originalKey = process.env.PAYMONGO_SECRET_KEY; process.env.PAYMONGO_SECRET_KEY = mockPaymentKey;
      let checkouts = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (options.method === 'GET') {
          assert.match(String(url), new RegExp(`checkout_sessions/cs_contract_${suffix}$`));
          return { ok: true, json: async () => ({ data: { id: `cs_contract_${suffix}`, attributes: { status: 'active' } } }) };
        }
        assert.match(String(url), /checkout_sessions$/);
        const body = JSON.parse(options.body);
        assert.equal(body.data.attributes.line_items[0].amount, 155000);
        assert.deepEqual(body.data.attributes.payment_method_types, ['qrph']);
        checkouts++;
        return { ok: true, json: async () => ({ data: { id: `cs_contract_${suffix}`, attributes: { checkout_url: 'https://checkout.paymongo.com/test-contract', reference_number: body.data.attributes.reference_number } } }) };
      };
      let checkout;
      try {
        [checkout] = await Promise.all([initiateRentPayment({ user: second, tenantPaymentId: bill.id, billingMonth: '2026-12' }), initiateRentPayment({ user: second, tenantPaymentId: bill.id, billingMonth: '2026-12' })]);
      } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = originalKey; }
      assert.equal(checkouts, 1);
      const payload = { data: { id: `evt_contract_${suffix}`, attributes: { type: 'checkout_session.payment.paid', livemode: false, data: { id: `cs_contract_${suffix}`, attributes: { reference_number: checkout.payment.internalReference, payments: [{ id: `pay_contract_${suffix}`, attributes: { status: 'paid', amount: 155000, currency: 'PHP' } }] } } } } };
      const wrong = structuredClone(payload); wrong.data.attributes.data.attributes.payments[0].attributes.amount = 1;
      await assert.rejects(handlePaymongoWebhookPayload(wrong), /amount/);
      const raw = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now()/1000));
      const signature = crypto.createHmac('sha256', mockWebhookSecret).update(`${timestamp}.${raw}`).digest('hex');
      const signedResponse = await request('/api/payments/paymongo/webhook', null, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': `t=${timestamp},te=${signature}` }, body: raw });
      assert.equal(signedResponse.status, 200, await signedResponse.clone().text());
      await Promise.all([handlePaymongoWebhookPayload(payload), handlePaymongoWebhookPayload(payload)]);
      assert.equal((await Payment.findByPk(checkout.payment.id)).status, 'SUCCEEDED');
      assert.equal(Number((await OwnerTenant.findByPk(linked.id)).balance), 0);
      assert.equal(Number((await OwnerTenant.findByPk(other.id)).balance), 900);
      assert.equal((await OwnerPayment.findByPk(bill.id)).status, 'paid');
      assert.equal((await OwnerPayment.findByPk(bill.id)).method, 'QR Ph');
      assert.equal(await PaymentReceipt.count({ where: { paymentId: checkout.payment.id } }), 1);
      const ownerCookie = await login(owner.email);
      const collections = await request('/api/payments/owner/list', ownerCookie);
      assert.equal(collections.status, 200);
      assert.ok((await collections.json()).payments.some(item => item.id === checkout.payment.id && item.status === 'SUCCEEDED'));
      const secondCookie = await login(second.email);
      assert.equal((await request(`/api/payments/${checkout.payment.id}/status`, secondCookie)).status, 200);
      assert.equal((await request(`/api/payments/${checkout.payment.id}/status`, cookie)).status, 403);
      assert.equal((await request(`/api/payments/status/by-ref?ref=${checkout.payment.internalReference}`, cookie)).status, 403);
      assert.equal((await request(`/api/payments/${checkout.payment.id}/receipt/download`, secondCookie)).status, 200);
    });
    await t.test('staged owner signup for 12 branches and gallery replacements survive a clean upload directory', async () => {
      const form = new FormData();
      const data = { accountType:'boarding_house_owner', fullName:'Registered Room Owner', email:`layout-${suffix}@example.test`, password:fixturePassword,confirmPassword:fixturePassword,acceptTerms:'on',boardingHouseName:'Layout Main',boardingHouseAddress:'Orconuma',streetAddress:'Purok 2, Main Street',declaredBranches:'12',contactNumber:'09171234567',paymentMethods:'Cash',mapPin:'Lat 12.668945, Lon 121.491777',boardingHouseLatitude:'12.668945',boardingHouseLongitude:'121.491777',propertyType:'Mixed',floorCount:'2',roomsPerFloor:'[1,1]' };
      Object.assign(data, {
        branchFloors2: '3', branchRooms2: '6', branch2_boardingHouseAddress: 'Labasan',
        branch2_streetAddress: 'Centro', branch2_boardingHouseLatitude: '12.774815',
        branch2_boardingHouseLongitude: '121.470195'
      });
      for (let number = 3; number <= 12; number++) {
        const prefix = `branch${number}_`;
        data[`branchFloors${number}`] = '1';
        data[prefix + 'roomsPerFloor'] = '[1]';
        data[prefix + 'boardingHouseAddress'] = 'Labasan';
        data[prefix + 'streetAddress'] = `Centro ${number}`;
        data[prefix + 'boardingHouseLatitude'] = '12.774815';
        data[prefix + 'boardingHouseLongitude'] = '121.470195';
      }
      for (const [key, value] of Object.entries(data)) form.set(key, value);
      form.append('paymentMethods', 'GCash');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=', 'base64');
      const picture = new Blob([png], { type: 'image/png' });
      const fields = ['validIdPicture', 'businessPermit', 'barangayClearance', 'branch2_galleryExtra3'];
      const gallery = ['galleryOutdoor', 'galleryLivingArea', 'galleryBedroom', 'galleryDining', 'galleryBathroom'];
      for (let number = 1; number <= 12; number++) {
        fields.push(...gallery.map(field => number === 1 ? field : `branch${number}_${field}`));
      }
      const draftResponse = await request('/owner-registration/uploads', null, { method: 'POST' });
      assert.equal(draftResponse.status, 201);
      const draftCookie = draftResponse.headers.get('set-cookie').split(';')[0];
      const { id } = await draftResponse.json();
      const headers = { Accept: 'application/json' };
      const upload = field => {
        const body = new FormData();
        body.set('file', picture, field + '.png');
        return { method: 'POST', headers, body };
      };
      const wrongSession = await request(`/owner-registration/uploads/${id}/${fields[0]}`, null, upload(fields[0]));
      assert.equal(wrongSession.status, 410);
      const manifest = [];
      for (let i = 0; i < fields.length; i += 3) {
        await Promise.all(fields.slice(i, i + 3).map(async field => {
          const response = await request(`/owner-registration/uploads/${id}/${field}`, draftCookie, upload(field));
          assert.equal(response.status, 200, await response.clone().text());
          manifest.push([field, (await response.json()).extension]);
        }));
      }
      form.set('registrationDraft', id);
      form.set('registrationFiles', JSON.stringify(manifest));
      form.delete('acceptTerms');
      const register = () => request('/register', draftCookie, { method: 'POST', headers, body: form });
      const missingTerms = await register();
      assert.equal(missingTerms.status, 422);
      assert.match((await missingTerms.json()).error, /accept the Terms/);
      form.set('acceptTerms', 'on');
      const response = await register();
      assert.equal(response.status, 201, await response.clone().text());
      const retry = await register();
      assert.equal(retry.status, 201);
      assert.deepEqual(await retry.json(), await response.json());
      const created=await User.findOne({where:{email:data.email}});assert.ok(created);ids.push(created.id);
      assert.deepEqual(JSON.parse(created.paymentMethods), ['Cash', 'GCash']);
      assert.equal(created.gcashQrCode, null);
      assert.equal(created.contactNumber, data.contactNumber);
      for(const value of [created.profilePicture,created.boardingHousePicture,created.validIdPicture,created.businessPermit,created.barangayClearance,created.rentalPermit,...JSON.parse(created.galleryImages || '[]'),...Object.values(JSON.parse(created.supportingDocuments || '{}'))]) if(typeof value==='string'&&value.startsWith('/uploads/'))uploadedFiles.push(new URL('../../public'+value,import.meta.url));
      const primary=await BoardingHouse.findOne({where:{ownerId:created.id,isPrimary:true}});assert.equal(primary.floorCount,2);assert.equal(primary.address,'Purok 2, Main Street');assert.deepEqual(primary.registrationSubmission.branches[0].roomsPerFloor,[1,1]);
      const rooms=await OwnerRoom.findAll({where:{ownerId:created.id},order:[['roomNumber','ASC']]});assert.equal(rooms.length,0);assert.equal(primary.declaredRooms,2);assert.equal(primary.declaredBranches,12);assert.equal(created.roomsAvailable,0);assert.equal(created.applicationStatus,'pending');

      const originalPhotos = JSON.parse(created.galleryImages);
      assert.equal(originalPhotos.length, 10);
      assert.ok(originalPhotos.slice(5).every(url => !url));
      assert.equal(primary.picture, originalPhotos[0]);
      const branch = await BoardingHouse.findOne({ where: { ownerId: created.id, name: 'Layout Main Branch 2' } });
      assert.equal(await BoardingHouse.count({ where: { ownerId: created.id } }), 12);
      assert.equal(branch.barangay, 'Labasan');
      assert.equal(branch.address, 'Centro');
      assert.equal(Number(branch.latitude), 12.774815);
      assert.notEqual(branch.picture, primary.picture);
      const publicListings = async () => (await (await request('/api/boarding-houses')).json()).filter(item => item.ownerId === created.id);
      assert.equal((await publicListings()).length, 0);

      const mainOfficialCookie = await login(official.email);
      const primaryApps = await request('/barangay-dashboard/api/applications', mainOfficialCookie);
      const application = (await primaryApps.json()).data.find(item => item.id === created.id);
      assert.equal(application.branches[0].address, data.streetAddress);
      assert.equal(application.branches[1].address, data.branch2_streetAddress);
      assert.equal(application.branches[1].galleryImages[0], branch.picture);
      const branchExtra = application.branches[1].galleryImages[7];
      assert.match(branchExtra, /^\/uploads\/property-/);
      assert.equal((await request(branchExtra)).status, 200);
      assert.equal(application.branches[1].longitude, 121.470195);
      const branchOfficial = await User.create({
        fullName: 'Branch location official', email: `branch-location-${suffix}@example.test`, password,
        accountType: 'barangay', barangay: 'Labasan', applicationStatus: 'approved', emailVerified: true
      });
      ids.push(branchOfficial.id);
      const branchOfficialCookie = await login(branchOfficial.email);
      const inspectBranches = async () => (await (await request('/barangay-dashboard/api/branches', branchOfficialCookie)).json());
      assert.ok(!(await inspectBranches()).groups.some(group => group.id === created.id));
      const approve = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) };
      const applicationPath = `/barangay-dashboard/api/applications/${created.id}/review`;
      assert.equal((await request(applicationPath, branchOfficialCookie, approve)).status, 404);
      assert.equal((await request(applicationPath, mainOfficialCookie, approve)).status, 200);
      assert.ok((await publicListings()).some(item => item.id === `bh-${branch.id}` &&
        item.boardingHousePicture === branch.picture && item.galleryImages.includes(branchExtra) &&
        item.boardingHouseAddress === data.branch2_streetAddress && item.contactNumber === data.contactNumber));
      const local = await inspectBranches();
      assert.ok(local.groups.find(group => group.id === created.id).branches.some(item => item.id === branch.id));
      assert.ok(!local.data.some(item => item.id === branch.id));
      const map = await request('/barangay-dashboard/api/map-houses', branchOfficialCookie);
      assert.ok((await map.json()).data.some(item => item.id === `bh-${branch.id}` && item.boardingHouseAddress === data.branch2_streetAddress));
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`, branchOfficialCookie, approve)).status, 403);
      const ownerCookie = await login(created.email);
      const profile = await request('/owner-dashboard/api/profile', ownerCookie);
      assert.equal(profile.status, 200);
      const ownerProfile = (await profile.json()).data;
      assert.equal(ownerProfile.contactNumber, data.contactNumber);
      assert.equal(ownerProfile.boardingHouseAddress, data.streetAddress);
      const adminMap = await request('/admin/api/map-data', await login(admin.email));
      assert.equal(adminMap.status, 200);
      const mappedOwner = (await adminMap.json()).data.owners.find(item => item.id === created.id);
      assert.equal(mappedOwner.boardingHouseAddress, data.streetAddress);
      assert.ok(mappedOwner.branches.some(item => item.address === data.branch2_streetAddress && item.barangay === 'Labasan'));
      const renamed = await request('/owner-dashboard/api/profile', ownerCookie, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardingHouseName: '  Updated Boarding House  ' })
      });
      assert.equal(renamed.status, 200);
      assert.equal((await primary.reload()).name, 'Updated Boarding House');
      assert.ok((await publicListings()).every(item => item.propertyName === 'Updated Boarding House'));
      const galleryUrl = `/owner-dashboard/api/gallery?boardingHouseId=${primary.id}`;
      const getGalleryPhotos = async (url = galleryUrl) => {
        const gallery = await request(url, ownerCookie);
        assert.equal(gallery.status, 200);
        return (await gallery.json()).slots.map(slot => slot.imageUrl || '');
      };
      const checkPublicCover = async expected => {
        const response = await request('/api/landing-data');
        assert.equal(response.status, 200);
        const listing = (await response.json()).listings.find(item => item.bhId === primary.id);
        assert.equal(listing.boardingHousePicture, expected);
        assert.equal(listing.galleryImages[0], expected);
      };
      const checkPhoto = async url => {
        assert.match(url, /^\/uploads\/property-[a-f0-9-]+\.png$/);
        const image = await request(url);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/png');
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
      };

      assert.deepEqual(await getGalleryPhotos(), originalPhotos);
      await checkPublicCover(originalPhotos[0]);
      const replacements = new FormData();
      replacements.set('boardingHouseId', primary.id);
      replacements.set('galleryOutdoor', new Blob([png], { type: 'image/png' }), 'replacement.png');
      const invalidReplacement = new FormData();
      for (const [key, value] of replacements) invalidReplacement.set(key, value);
      invalidReplacement.set('galleryBedroom', new Blob(['not an image'], { type: 'image/png' }), 'invalid.png');
      assert.equal((await request('/owner-dashboard/api/gallery/five-slots', ownerCookie, { method: 'POST', body: invalidReplacement })).status, 422);
      assert.deepEqual(await getGalleryPhotos(), originalPhotos);
      const replacement = await request('/owner-dashboard/api/gallery/five-slots', ownerCookie, { method: 'POST', body: replacements });
      assert.equal(replacement.status, 200, await replacement.clone().text());
      const updatedPhotos = await getGalleryPhotos();
      assert.notEqual(updatedPhotos[0], originalPhotos[0]);
      assert.deepEqual(updatedPhotos.slice(1), originalPhotos.slice(1));
      await checkPublicCover(updatedPhotos[0]);

      const branchGalleryUrl = `/owner-dashboard/api/gallery?boardingHouseId=${branch.id}`;
      const originalBranchPhotos = await getGalleryPhotos(branchGalleryUrl);
      const branchReplacements = new FormData();
      branchReplacements.set('boardingHouseId', branch.id);
      const fullGallery = [...gallery, ...Array.from({ length: 5 }, (_, i) => `galleryExtra${i + 1}`)];
      for (const field of fullGallery) branchReplacements.set(field, new Blob([png], { type: 'image/png' }), `${field}.png`);
      const branchResponse = await request('/owner-dashboard/api/gallery/five-slots', ownerCookie, { method: 'POST', body: branchReplacements });
      assert.equal(branchResponse.status, 200, await branchResponse.clone().text());
      assert.equal((await branchResponse.json()).boardingHouseId, branch.id);
      const updatedBranchPhotos = await getGalleryPhotos(branchGalleryUrl);
      assert.equal(updatedBranchPhotos.filter(Boolean).length, fullGallery.length);
      assert.notEqual(updatedBranchPhotos[0], originalBranchPhotos[0]);
      assert.equal((await branch.reload()).picture, updatedBranchPhotos[0]);
      assert.deepEqual(await getGalleryPhotos(), updatedPhotos);
      const oversize = new FormData();
      oversize.set('boardingHouseId', branch.id);
      oversize.set('galleryOutdoor', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
      const oversized = await request('/owner-dashboard/api/gallery/five-slots', ownerCookie, { method: 'POST', body: oversize });
      assert.equal(oversized.status, 422);
      assert.match((await oversized.json()).error, /Outdoor Spaces must be 5 MB or smaller/);
      assert.deepEqual(await getGalleryPhotos(branchGalleryUrl), updatedBranchPhotos);

      await stop();
      await start({ freshUploads: true });
      assert.deepEqual(await getGalleryPhotos(), updatedPhotos);
      await checkPublicCover(updatedPhotos[0]);
      for (const url of updatedPhotos.filter(Boolean)) await checkPhoto(url);
      await checkPhoto(originalPhotos[0]); // The submitted application keeps its original photo.
      assert.deepEqual(await getGalleryPhotos(branchGalleryUrl), updatedBranchPhotos);
      await checkPhoto(updatedBranchPhotos[0]);

    });
    await t.test('bed numbers, reported occupancy and whole-room household leases stay consistent', async () => {
      await house.update({ floorCount:4 });
      const beds=await saveRoom(owner.id,null,{boardingHouseId:house.id,roomNumber:'401',floor:'4th Floor',roomType:'Bedspace',capacity:6,bedCount:6,rentalBasis:'bed',availableSlots:4,rentalPrice:1200});
      const one=await saveTenant(owner.id,null,{fullName:'Bed Resident One',roomId:beds.id,monthlyRent:1200});
      const two=await saveTenant(owner.id,null,{fullName:'Bed Resident Two',roomId:beds.id,monthlyRent:1200,useReservedSlot:true});
      assert.notEqual(one.bedNumber,two.bedNumber);assert.equal((await OwnerRoom.findByPk(beds.id)).availableSlots,3);
      await assert.rejects(saveTenant(owner.id,null,{fullName:'Duplicate Bed',roomId:beds.id,bedNumber:one.bedNumber,monthlyRent:1200}),/bed number/);
      await saveTenant(owner.id,one.id,{status:'moved_out'});assert.equal((await OwnerRoom.findByPk(beds.id)).availableSlots,4);
      const family=await saveRoom(owner.id,null,{boardingHouseId:house.id,roomNumber:'402',floor:'4th Floor',roomType:'Family Room',capacity:4,bedCount:2,rentalBasis:'room',rentalPrice:6000});
      const household=await saveTenant(owner.id,null,{fullName:'Household Lead',roomId:family.id,occupantCount:3,monthlyRent:6000});
      assert.equal((await OwnerRoom.findByPk(family.id)).availableSlots,0);
      await assert.rejects(saveTenant(owner.id,null,{fullName:'Another Household',roomId:family.id,monthlyRent:6000}),/available capacity/);
      const listings=await(await request('/api/boarding-houses')).json();const item=listings.find(item=>item.bhId===house.id);const info=item.roomInventory.find(room=>room.id===beds.id);
      assert.equal(info.occupiedBeds,1);assert.equal(info.unavailableReported,1);assert.equal(info.availableSlots,4);assert.equal(info.floor,'4th Floor');assert.ok(!JSON.stringify(item).includes('Bed Resident'));
      await saveTenant(owner.id,household.id,{status:'moved_out'});assert.equal((await OwnerRoom.findByPk(family.id)).availableSlots,4);
    });
    await t.test('branch profiles, tenants, and bills follow the selected boarding house', async () => {
      const local=await User.create({fullName:'Labasan Official',email:`labasan-${suffix}@example.test`,password,accountType:'barangay',applicationStatus:'approved',barangay:'Labasan',emailVerified:true});ids.push(local.id);
      const ownerCookie=await login(owner.email), originalOfficialCookie=await login(official.email),localCookie=await login(local.email);
      const response=await request('/owner-dashboard/api/boarding-houses',ownerCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Second Barangay Branch',barangay:'Labasan',address:'Labasan main road',latitude:12.773,longitude:121.475,floorCount:4,propertyType:'Bedspace Residence'})});assert.equal(response.status,201,await response.clone().text());
      const branch=(await response.json()).data;assert.equal(branch.ownerId,owner.id);assert.equal(branch.approvalStatus,'pending');
      assert.equal(branch.name, house.name + ' Branch 2');
      const post={method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})};
      const adminCookie = await login(admin.email);
      const readBranches = async (cookie = localCookie) => {
        const result = await request('/barangay-dashboard/api/branches', cookie);
        assert.equal(result.status, 200);
        return result.json();
      };
      assert.equal((await request('/admin/api/branches', adminCookie)).status, 404);
      assert.equal((await request(`/admin/api/branches/${branch.id}/review`, adminCookie, post)).status, 404);
      assert.equal((await request('/barangay-dashboard/api/branches', adminCookie)).status, 403);
      const pendingBranches = await readBranches();
      assert.ok(pendingBranches.data.some(item => item.id === branch.id));
      assert.ok(!pendingBranches.groups.some(group => group.branches.some(item => item.id === branch.id)));
      const { BarangayNotification } = await import('../../models/adminModels.js');
      assert.equal(await BarangayNotification.count({ where: { userId: admin.id, type: 'branch', body: `${branch.name} in Labasan is awaiting listing review.` } }), 0);
      await BarangayNotification.create({ userId: admin.id, title: 'Legacy branch notification', body: 'Branch notice', type: 'branch' });
      const adminNotifications = await (await request('/api/portal/notifications', adminCookie)).json();
      assert.ok(!adminNotifications.items.some(item => item.type === 'branch'));
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`,originalOfficialCookie,post)).status,404);
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`,localCookie,post)).status,422);
      const branchRoom = await saveRoom(owner.id,null,{boardingHouseId:branch.id,roomNumber:'401',floor:'4th Floor',roomType:'Bedspace',capacity:4,bedCount:4,rentalBasis:'bed',rentalPrice:1600});
      const readLanding = async () => (await (await request('/api/landing-data')).json()).listings;
      assert.ok(!(await readLanding()).some(item => item.bhId === branch.id));
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`, localCookie, post)).status, 200);

      const approvedBranches = await readBranches();
      assert.ok(!approvedBranches.data.some(item => item.id === branch.id));
      const ownerGroup = approvedBranches.groups.find(group => group.id === owner.id);
      assert.equal(ownerGroup.boardingHouseName, (await owner.reload()).boardingHouseName);
      assert.ok(ownerGroup.branches.some(item => item.id === branch.id && item.approvalStatus === 'approved'));
      const outsideJurisdiction = await readBranches(originalOfficialCookie);
      assert.ok(!outsideJurisdiction.groups.some(group => group.branches.some(item => item.id === branch.id)));

      const landing = await readLanding();
      const branchListing = landing.find(item => item.bhId === branch.id);
      assert.equal(branchListing.boardingHouseName, branch.name);
      assert.equal(branchListing.barangay, 'Labasan');
      assert.equal(branchListing.ownerId, owner.id);
      assert.deepEqual([branchListing.latitude, branchListing.longitude], [12.773, 121.475]);
      assert.equal(branchListing.registrationStatus, 'registered');

      const branchTenant = await saveTenant(owner.id, null, { fullName: 'Branch resident A', roomId: branchRoom.id });
      const otherTenant = await saveTenant(owner.id, null, { fullName: 'Branch resident B', roomId: branchRoom.id });
      const loadBranch = async (endpoint, id) => (await (await request(
        `/owner-dashboard/api/${endpoint}?boardingHouseId=${id}`, ownerCookie
      )).json()).data;
      assert.deepEqual(new Set((await loadBranch('tenants', branch.id)).map(tenant => tenant.id)), new Set([branchTenant.id, otherTenant.id]));
      assert.ok(!(await loadBranch('tenants', house.id)).some(tenant => tenant.id === branchTenant.id));
      const bill = (boardingHouseId, target) => request('/owner-dashboard/api/payments', ownerCookie, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardingHouseId, ...target, amount: '100.01', dueDate: '2027-03-10', month: target.roomId ? '2027-03' : '2027-02' })
      });
      assert.equal((await bill(house.id, { tenantId: branchTenant.id })).status, 422);
      assert.equal((await bill(branch.id, { tenantId: branchTenant.id })).status, 201);
      assert.equal((await bill(branch.id, { roomId: branchRoom.id })).status, 201);
      const bills = await loadBranch('payments', branch.id);
      assert.ok(bills.every(item => item.boardingHouseId === branch.id && item.roomNumber === '401'));
      assert.deepEqual(bills.filter(item => item.month === '2027-03').map(item => item.amount).sort(), ['50.00', '50.01']);
      assert.ok(!(await loadBranch('payments', house.id)).some(item => item.tenantId === branchTenant.id));
      const primaryRoom = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Transfer Room', capacity: 1 });
      await saveTenant(owner.id, branchTenant.id, { roomId: primaryRoom.id });
      assert.ok((await loadBranch('tenants', house.id)).some(item => item.id === branchTenant.id));
      assert.ok((await loadBranch('payments', branch.id)).some(item => item.tenantId === branchTenant.id));

      const moved = await request(`/owner-dashboard/api/boarding-houses/${branch.id}`, ownerCookie, {
        ...post,
        body: JSON.stringify({ latitude: 12.774, longitude: 121.476, amenities: '["Wi-Fi"]', rentPerHead: 1600, rentPerRoom: 4900 }),
      });
      assert.equal(moved.status, 200);
      assert.equal((await moved.json()).data.amenities, '["Wi-Fi"]');
      assert.notEqual((await house.reload()).amenities, '["Wi-Fi"]');
      const listings = await (await request('/api/boarding-houses')).json();
      const movedBranch = listings.find(item => item.bhId === branch.id);
      assert.deepEqual([movedBranch.latitude, movedBranch.longitude], [12.774, 121.476]);
      const primaryPin = item => [item.latitude, item.longitude];
      assert.deepEqual(primaryPin(listings.find(item => item.bhId === house.id)), primaryPin(landing.find(item => item.bhId === house.id)));

      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`, localCookie, {
        ...post,
        body: JSON.stringify({ action: 'suspend', note: 'Temporary inspection' }),
      })).status, 200);
      const remaining = await readLanding();
      assert.ok(!remaining.some(item => item.bhId === branch.id));
      assert.ok(remaining.some(item => item.bhId === house.id));
    });
    await t.test('tenant registrations store an available room preference for owner review without assigning it', async () => {
      const googleTenant = await User.create({
        fullName: 'Google registration tenant', email: `oauth-tenant-${suffix}@example.test`, password,
        accountType: 'tenant', emailVerified: true
      });
      ids.push(googleTenant.id);
      const { sessionStore } = await import('../../config/session.js');
      const sid = crypto.randomUUID();
      await sessionStore.set(sid, { cookie: { maxAge: 60_000 }, pendingTenantUserId: googleTenant.id });
      const googleCookie = 'dormmap.sid=' + encodeURIComponent('s:' + signature.sign(sid, sessionSecret));
      const name = `Same-name branch ${suffix}`;
      const branch = await BoardingHouse.create({ ownerId: owner.id, name, barangay: 'Orconuma', approvalStatus: 'approved' });
      const sameNameBranch = await BoardingHouse.create({ ownerId: owner.id, name, barangay: 'Labasan', approvalStatus: 'approved' });
      const [preferred, occupied, otherBranchRoom, alternative] = await OwnerRoom.bulkCreate([
        { ownerId: owner.id, boardingHouseId: branch.id, roomNumber: 'B201', floor: '2nd Floor', roomType: 'Solo Room' },
        { ownerId: owner.id, boardingHouseId: branch.id, roomNumber: 'B204', status: 'occupied', availableSlots: 0 },
        { ownerId: owner.id, boardingHouseId: sameNameBranch.id, roomNumber: 'C103' },
        { ownerId: owner.id, boardingHouseId: branch.id, roomNumber: 'B202' }
      ]);
      const page = await (await request('/complete-tenant-profile', googleCookie)).text();
      assert.match(page, /Complete Your Tenant Profile/);
      assert.doesNotMatch(page, /<select[^>]*name="selectedBoardingHouse"/);
      const body = new FormData();
      body.set('selectedBoardingHouse', `bh-${branch.id}`);
      body.set('contactNumber', '09171234567');
      body.set('gender', 'prefer_not_to_say');
      body.set('acceptTerms', 'on');
      const submit = () => request('/complete-tenant-profile', googleCookie, {
        method: 'POST', headers: { Accept: 'application/json' }, body
      });
      const invalidGender = await submit();
      assert.equal(invalidGender.status, 422);
      assert.match((await invalidGender.json()).error, /choose male or female/i);
      body.set('gender', 'female');
      const missingId = await submit();
      assert.equal(missingId.status, 422);
      assert.match((await missingId.json()).error, /upload your student/i);
      body.set('validIdPicture', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'id.pdf');
      for (const room of [occupied, otherBranchRoom]) {
        body.set('requestedRoomId', room.id);
        const invalidRoom = await submit();
        assert.equal(invalidRoom.status, 422);
        assert.match((await invalidRoom.json()).error, /no longer available at this boarding house/i);
      }
      body.set('requestedRoomId', preferred.id);
      const approved = await submit();
      assert.equal(approved.status, 200, await approved.clone().text());
      assert.equal((await approved.json()).redirect, '/tenant-dashboard');

      const signup = new FormData();
      const email = `password-tenant-${suffix}@example.test`;
      for (const [field, value] of Object.entries({ accountType: 'tenant', email, fullName: 'Password registration tenant',
        password: fixturePassword, confirmPassword: fixturePassword, acceptTerms: 'on', gender: 'male',
        selectedBoardingHouse: `bh-${branch.id}`, requestedRoomId: String(preferred.id) })) signup.set(field, value);
      const signedUp = await request('/register', null, { method: 'POST', body: signup });
      assert.equal(signedUp.status, 302, await signedUp.clone().text());
      assert.equal(signedUp.headers.get('location'), '/login?registered=1');
      const passwordTenant = await User.findOne({ where: { email } });
      assert.ok(passwordTenant);
      ids.push(passwordTenant.id);
      assert.equal(passwordTenant.gender, 'male');

      const ownerCookie = await login(owner.email);
      const ownerReview = await request(`/owner-dashboard/api/pending-applications?boardingHouseId=${branch.id}`, ownerCookie);
      assert.equal(ownerReview.status, 200, await ownerReview.clone().text());
      const applications = (await ownerReview.json()).data;
      for (const tenant of [await googleTenant.reload(), passwordTenant]) {
        const review = applications.find(item => item.userId === tenant.id);
        assert.ok(review);
        assert.equal(review.boardingHouseId, branch.id);
        assert.equal(review.preferredRoomLabel, 'Room B201 · 2nd Floor · Solo Room');
        assert.equal(review.roomId, null);
        assert.equal(tenant.selectedBoardingHouse, branch.name);
      }
      assert.equal((await preferred.reload()).availableSlots, 1);
      const googleApplication = applications.find(item => item.userId === googleTenant.id);
      await offerApplication(owner.id, googleTenant.id, { applicationId: googleApplication.id, roomId: alternative.id, monthlyRent: 1200 });
      const offered = await TenantApplication.findByPk(googleApplication.id);
      assert.equal(offered.roomId, alternative.id);
      assert.equal(offered.preferredRoomLabel, 'Room B201 · 2nd Floor · Solo Room');
      const tenantCookie = await login(googleTenant.email);
      const overview = await request('/tenant-dashboard/api/overview', tenantCookie);
      assert.equal((await overview.json()).isPending, true);
      assert.equal((await googleTenant.reload()).applicationStatus, 'pending_owner');
      const result = await request(`/tenant-dashboard/api/applications/${offered.id}/confirm`, tenantCookie, { method: 'POST' });
      assert.equal(result.status, 200, await result.clone().text());
      assert.equal((await offered.reload()).status, 'confirmed');
      assert.equal(Number((await alternative.reload()).availableSlots), 0);
    });

    await t.test('tenants can complete email and Google registration without choosing a property', async () => {
      const googleTenant = await User.create({
        fullName: 'Undecided Google tenant', email: `google-undecided-${suffix}@example.test`,
        password, accountType: 'tenant', emailVerified: true, oauthProvider: 'google'
      });
      ids.push(googleTenant.id);
      const { sessionStore } = await import('../../config/session.js');
      const sid = crypto.randomUUID();
      await sessionStore.set(sid, { cookie: { maxAge: 60_000 }, pendingTenantUserId: googleTenant.id });
      const googleCookie = 'dormmap.sid=' + encodeURIComponent('s:' + signature.sign(sid, sessionSecret));
      const body = new FormData();
      body.set('contactNumber', '09171234567');
      body.set('gender', 'female');
      body.set('acceptTerms', 'on');
      body.set('validIdPicture', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'id.pdf');
      const completed = await request('/complete-tenant-profile', googleCookie, {
        method: 'POST', headers: { Accept: 'application/json' }, body
      });
      assert.equal(completed.status, 200, await completed.clone().text());
      assert.equal((await completed.json()).redirect, '/tenant-dashboard');

      const email = `email-undecided-${suffix}@example.test`;
      const signup = new FormData();
      for (const [field, value] of Object.entries({
        fullName: 'Undecided email tenant', email, accountType: 'tenant',
        password: fixturePassword, confirmPassword: fixturePassword, gender: 'male', acceptTerms: 'on'
      })) signup.set(field, value);
      const signedUp = await request('/register', null, { method: 'POST', body: signup });
      assert.equal(signedUp.status, 302, await signedUp.clone().text());
      assert.equal(signedUp.headers.get('location'), '/login?registered=1');
      const emailTenant = await User.findOne({ where: { email } });
      ids.push(emailTenant.id);
      for (const tenant of [await googleTenant.reload(), emailTenant]) {
        assert.equal(tenant.selectedBoardingHouse, null);
        assert.equal(tenant.applicationStatus, 'approved');
        assert.equal(await TenantApplication.count({ where: { tenantId: tenant.id } }), 0);
      }
    });

    await t.test('named messaging, private notification reads and authenticated SSE updates', async () => {
      const { OwnerMessage, OwnerNotification } = await import('../../models/ownerModels.js');
      const { BarangayNotification } = await import('../../models/adminModels.js');
      assert.equal((await request('/api/portal/notifications')).status,401);
      assert.equal((await request('/api/portal/events')).status,401);
      const ownerCookie=await login(owner.email),secondCookie=await login(second.email);
      await OwnerMessage.create({ownerId:owner.id,senderId:second.id,recipientId:owner.id,message:'Hello from tenant'});
      const inbox=await(await request('/owner-dashboard/api/messages',ownerCookie)).json();
      const named=inbox.data.find(row=>row.senderId===second.id);assert.equal(named.senderName,second.fullName);assert.equal(named.peerName,second.fullName);
      const foreign=await OwnerNotification.create({ownerId:owner.id,title:'Private owner notice',body:'Owner only',type:'application'});
      await request('/api/portal/notifications/read',secondCookie,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:foreign.id})});
      await foreign.reload();assert.equal(foreign.isRead,false);
      const legacyNotice=await BarangayNotification.create({userId:owner.id,title:'Barangay review note',body:'Please update the permit copy',type:'application_update'});
      const combined=await(await request('/api/portal/notifications',ownerCookie)).json();assert.ok(combined.items.some(item=>item.id===legacyNotice.id&&item.source==='barangay'&&item.url==='/owner-dashboard#my-profile'));
      await request('/api/portal/notifications/read',ownerCookie,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:legacyNotice.id,source:'barangay'})});await legacyNotice.reload();assert.equal(legacyNotice.isRead,true);await foreign.reload();assert.equal(foreign.isRead,false);
      await legacyNotice.destroy();

      const abort=new AbortController();const response=await request('/api/portal/events',secondCookie,{signal:abort.signal});assert.match(response.headers.get('content-type'),/event-stream/);
      const reader=response.body.getReader();await reader.read();
      const result=await request('/owner-dashboard/api/messages',ownerCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientId:second.id,message:'Your room update is ready'})});assert.equal(result.status,201);
      let streamText='';const decoder=new TextDecoder();const timeout=setTimeout(()=>abort.abort(),5000);
      try{while(!streamText.includes('portal_update')){const chunk=await reader.read();assert.equal(chunk.done,false);streamText+=decoder.decode(chunk.value);}}finally{clearTimeout(timeout);abort.abort();await reader.cancel().catch(()=>{});}
      assert.ok(!streamText.includes('Your room update')); // invalidation only, no message payload
      const notices=await(await request('/api/portal/notifications',secondCookie)).json();const notice=notices.items.find(item=>item.body==='Your room update is ready');assert.ok(notice);assert.equal(notice.url,'/tenant-dashboard#messaging');assert.ok(notices.unread>0);
      await request('/api/portal/notifications/read',secondCookie,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:notice.id})});
      assert.equal((await BarangayNotification.findByPk(notice.id)).isRead,true);
      const blocked=await request('/owner-dashboard/api/messages',ownerCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientId:second.id,message:'',isRead:true})});assert.equal(blocked.status,422);
      const { MaintenanceRequest } = await import('../../models/tenantModels.js');
      const repair=await MaintenanceRequest.create({tenantId:second.id,ownerId:owner.id,title:'Leaking tap',description:'Kitchen tap needs repair'});
      const repairList=await(await request('/owner-dashboard/api/maintenance',ownerCookie)).json();assert.equal(repairList.data.find(item=>item.id===repair.id).tenantName,second.fullName);
      assert.equal((await request(`/owner-dashboard/api/maintenance/${repair.id}`,secondCookie,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'resolved',ownerResponse:'Fixed today'})})).status,403);
      assert.equal((await request(`/owner-dashboard/api/maintenance/${repair.id}`,ownerCookie,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'resolved',ownerResponse:'Fixed today'})})).status,200);
      const repairNotices=await(await request('/api/portal/notifications',secondCookie)).json();assert.ok(repairNotices.items.some(item=>item.type==='maintenance'&&item.url==='/tenant-dashboard#maintenance'));
      await repair.destroy();
      await OwnerMessage.destroy({where:{ownerId:owner.id}});await OwnerNotification.destroy({where:{ownerId:owner.id}});await BarangayNotification.destroy({where:{userId:second.id}});
    });
    await t.test('first confirmed offer closes competing offers and former stays remain in history', async () => {
      const applicant = await User.create({ fullName: 'Returning Tenant', email: `returning-${suffix}@example.test`, password, accountType: 'tenant', emailVerified: true });
      ids.push(applicant.id);
      const houseName = 'Alternate Boarding House';
      const otherOwner = await User.create({
        fullName: 'Alternate Owner', email: `alternate-${suffix}@example.test`, password,
        accountType: 'boarding_house_owner', applicationStatus: 'approved', emailVerified: true,
        boardingHouseName: houseName, barangay: 'Labasan', mapPin: 'Lat 12.773, Lon 121.475'
      });
      ids.push(otherOwner.id);
      const otherHouse = await BoardingHouse.create({ ownerId: otherOwner.id, name: houseName, approvalStatus: 'approved', floorCount: 1, barangay: 'Labasan' });
      const roomA = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Lifecycle A', capacity: 1, rentalPrice: 800 });
      const roomB = await saveRoom(otherOwner.id, null, { boardingHouseId: otherHouse.id, roomNumber: 'Lifecycle B', capacity: 1, rentalPrice: 800 });
      await owner.update({ paymentMethods: '["Cash"]' });
      const make = (id, property) => TenantApplication.create({ tenantId: applicant.id, ownerId: id, boardingHouseId: property.id, boardingHouseName: property.name });
      const first = await make(owner.id, house);
      const secondOffer = await make(otherOwner.id, otherHouse);
      await Promise.all([
        offerApplication(owner.id, applicant.id, { applicationId: first.id, roomId: roomA.id }),
        offerApplication(otherOwner.id, applicant.id, { applicationId: secondOffer.id, roomId: roomB.id })
      ]);
      const results = await Promise.allSettled([confirmOffer(applicant.id, first.id), confirmOffer(applicant.id, secondOffer.id)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const winner = results.find(result => result.status === 'fulfilled').value;
      const other = winner.id === first.id ? secondOffer : first;
      const openRoom = winner.id === first.id ? roomB : roomA;
      assert.equal((await other.reload()).status, 'another_offer_accepted');
      const former = await OwnerTenant.findOne({ where: { tenantUserId: applicant.id, status: 'active' } });
      assert.equal(former.ownerId, winner.ownerId);
      const activeBill = await OwnerPayment.create({ ownerId: winner.ownerId, tenantId: former.id, roomId: former.roomId, month: '2026-12', amount: 800, status: 'paid', dueDate: '2026-12-01' });
      const newApp = await make(other.ownerId, other.id === first.id ? house : otherHouse);
      await assert.rejects(offerApplication(other.ownerId, applicant.id, { applicationId: newApp.id, roomId: openRoom.id }), /active tenancy/);
      const applicantCookie = await login(applicant.email);
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
      const moveOut = await request('/tenant-dashboard/api/stays/move-out', applicantCookie, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: today }) });
      assert.equal(moveOut.status, 200, await moveOut.clone().text());
      assert.equal((await former.reload()).moveOutRequestedDate, today);
      await saveTenant(winner.ownerId, former.id, { status: 'moved_out', moveOutDate: today });
      await offerApplication(other.ownerId, applicant.id, { applicationId: newApp.id, roomId: openRoom.id });
      await confirmOffer(applicant.id, newApp.id);
      const history = await (await request('/tenant-dashboard/api/stays', applicantCookie)).json();
      assert.deepEqual(history.stays.map(stay => stay.status), ['active', 'moved_out']);
      assert.equal(history.stays[1].moveOutDate, today);
      const payments = await (await request('/tenant-dashboard/api/payments', applicantCookie)).json();
      assert.ok(payments.payments.some(payment => payment.id === activeBill.id && !payment.currentStay));
      const losingOwnerCookie = await login(winner.ownerId === owner.id ? otherOwner.email : owner.email);
      const pendingResponse = await request('/owner-dashboard/api/pending-applications', losingOwnerCookie);
      assert.equal(pendingResponse.status, 200, await pendingResponse.clone().text());
      const pendingList = await pendingResponse.json();
      assert.ok(!pendingList.data.some(application => application.id === other.id));
    });
    await t.test('owner batches enforce availability and ownership and preserve archived records', async () => {
      const ownerCookie = await login(owner.email);
      const api = '/owner-dashboard/api';
      const batch = (path, data, auth = ownerCookie) => request(api + path, auth, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      await owner.update({ paymentMethods: '["Cash"]' });
      const applicants = await User.bulkCreate(['A', 'B', 'C'].map(letter => ({
        fullName: `Bulk applicant ${letter}`, email: `bulk-${letter.toLowerCase()}-${suffix}@example.test`,
        accountType: 'tenant', password, emailVerified: true
      })));
      ids.push(...applicants.map(user => user.id));
      const [first, secondApp, third] = await TenantApplication.bulkCreate(applicants.map(user => ({
        tenantId: user.id, ownerId: owner.id, boardingHouseId: house.id, boardingHouseName: house.name
      })));
      const foreign = await TenantApplication.create({ tenantId: applicants[0].id, ownerId: pending.id, boardingHouseName: 'Other property' });
      const singleRoom = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Bulk A', rentalPrice: 1000 });
      const otherRoom = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Bulk B', rentalPrice: 1200 });
      const offers = [first, secondApp, third, foreign].map((app, index) => ({
        applicationId: app.id, roomId: index === 2 ? otherRoom.id : singleRoom.id
      }));
      assert.equal((await batch('/pending-applications/bulk-offer', { offers: [offers[0], offers[0]] })).status, 422);
      assert.equal((await batch('/pending-applications/bulk-offer', { offers }, cookie)).status, 403);
      const offered = await batch('/pending-applications/bulk-offer', { offers });
      assert.equal(offered.status, 200, await offered.clone().text());
      const { results: offerResults } = await offered.json();
      assert.deepEqual(offerResults.map(result => result.success), [true, false, true, false]);
      assert.match(offerResults[1].error, /outstanding offers/);
      assert.equal((await singleRoom.reload()).availableSlots, 1);
      const retry = await (await batch('/pending-applications/bulk-offer', { offers: offers.slice(0, 2) })).json();
      assert.deepEqual(retry.results.map(result => result.success), [false, false]);
      assert.equal(await BarangayNotification.count({ where: { userId: applicants[0].id, type: 'application_offered' } }), 1);

      const stayCookie = await login(applicants[0].email);
      const archivedAppCookie = await login(applicants[2].email);
      assert.equal((await request(`/tenant-dashboard/api/applications/${first.id}/confirm`, stayCookie, { method: 'POST' })).status, 200);
      assert.equal((await singleRoom.reload()).availableSlots, 0);
      const applicationArchive = await (await batch('/pending-applications/bulk-archive', { ids: [secondApp.id, third.id, first.id, foreign.id] })).json();
      assert.deepEqual(applicationArchive.results.map(result => result.success), [true, true, false, false]);
      assert.equal((await request(`/tenant-dashboard/api/applications/${third.id}/confirm`, archivedAppCookie, { method: 'POST' })).status, 409);
      const archivedApps = await (await request(`${api}/pending-applications?archived=true&boardingHouseId=${house.id}`, ownerCookie)).json();
      assert.deepEqual(new Set(archivedApps.data.map(app => app.id)), new Set([secondApp.id, third.id]));

      const stay = await OwnerTenant.findOne({ where: { tenantUserId: applicants[0].id } });
      const activeArchive = await (await batch('/tenants/bulk-archive', { ids: [stay.id] })).json();
      assert.match(activeArchive.results[0].error, /record move-out/i);
      await saveTenant(owner.id, stay.id, { status: 'moved_out' });
      const oldPayment = await OwnerPayment.create({ ownerId: owner.id, tenantId: stay.id, roomId: singleRoom.id, amount: 1000, dueDate: '2026-01-15', status: 'paid' });
      const anotherFormer = await OwnerTenant.create({ ownerId: owner.id, roomId: singleRoom.id, fullName: 'Another former tenant', status: 'moved_out' });
      const foreignFormer = await OwnerTenant.create({ ownerId: pending.id, fullName: 'Other owner’s former tenant', status: 'moved_out' });
      const tenantArchive = await (await batch('/tenants/bulk-archive', { ids: [stay.id, anotherFormer.id, foreignFormer.id] })).json();
      assert.deepEqual(tenantArchive.results.map(result => result.success), [true, true, false]);
      const ownerArchived = await (await request(`${api}/tenants?archived=true&boardingHouseId=${house.id}`, ownerCookie)).json();
      assert.deepEqual(new Set(ownerArchived.data.map(item => item.id)), new Set([stay.id, anotherFormer.id]));
      const ownerCurrent = await (await request(`${api}/tenants`, ownerCookie)).json();
      assert.ok(!ownerCurrent.data.some(item => item.id === stay.id));
      const history = await (await request('/tenant-dashboard/api/stays', stayCookie)).json();
      assert.ok(history.stays.some(item => item.id === stay.id && item.status === 'moved_out'));
      assert.equal((await oldPayment.reload()).status, 'paid');

      const inquiries = await OwnerInquiry.bulkCreate([owner.id, owner.id, pending.id].map(ownerId => ({ ownerId, clientName: 'Inquiry fixture', message: 'Question about rent' })));
      const inquiryArchive = await (await batch('/inquiries/bulk-archive', { ids: inquiries.map(item => item.id) })).json();
      assert.deepEqual(inquiryArchive.results.map(result => result.success), [true, true, false]);
      const archivedInquiries = await (await request(`${api}/inquiries?archived=true`, ownerCookie)).json();
      assert.ok(inquiries.slice(0, 2).every(inquiry => archivedInquiries.data.some(item => item.id === inquiry.id)));
      assert.equal((await inquiries[2].reload()).isArchived, false);
    });
    await t.test('reservations quote real rates, hold a slot only after payment review, and turn holds into stays', async () => {
      const { storeReviewFile } = await import('../../services/reviewFileService.js');
      const propertyOwner = await User.create({ fullName: 'Reservation Owner', email: `reservation-owner-${suffix}@example.test`, password,
        accountType: 'boarding_house_owner', applicationStatus: 'approved', barangay: 'Orconuma', boardingHouseName: 'Reservation House', mapPin: 'Lat 12.77, Lon 121.47',
        paymentMethods: '["Cash","GCash","QR Ph"]' });
      ids.push(propertyOwner.id);
      const qr = { originalname: 'qr.jpg', buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' };
      const qrUrl = await storeReviewFile(qr, propertyOwner.id, 'payment-qr');
      await propertyOwner.update({ gcashQrCode: qrUrl, qrPhCode: qrUrl });
      const property = await BoardingHouse.create({ ownerId: propertyOwner.id, name: 'Reservation House', barangay: 'Orconuma', isPrimary: true });
      const bedspace = await saveRoom(propertyOwner.id, null, { boardingHouseId: property.id, roomNumber: 'B-14', roomType: 'Bedspace', capacity: 2, rentalPrice: 4000 });
      const otherRoom = await saveRoom(propertyOwner.id, null, { boardingHouseId: property.id, roomNumber: 'Whole 4', rentalBasis: 'room', capacity: 1, rentalPrice: 6000 });
      const ownerCookie = await login(propertyOwner.email);
      const quoteUrl = `/api/boarding-houses/bh-${property.id}/reservation?roomId=${bedspace.id}`;
      const quote = await (await request(quoteUrl)).json();
      assert.deepEqual([quote.fee, quote.monthlyRent, quote.rentalBasis], [400, 4000, 'bed']);
      assert.deepEqual(quote.methods, ['Cash', 'GCash', 'QR Ph']);
      assert.equal((await request(quote.qrCodes.GCash)).headers.get('content-type'), 'image/jpeg');
      assert.equal((await request(qrUrl)).status, 404);

      const signup = new FormData();
      const email = `reservation-signup-${suffix}@example.test`;
      for (const [field, value] of Object.entries({ accountType: 'tenant', fullName: 'Reservation Applicant', email, password: fixturePassword,
        confirmPassword: fixturePassword, acceptTerms: 'on', selectedBoardingHouse: `bh-${property.id}`, requestedRoomId: String(bedspace.id),
        reserveRoom: 'on', reservationFee: '400', reservationPaidAmount: '375.25', reservationMethod: 'GCash', reservationReference: '0123456789012' })) signup.set(field, value);
      signup.set('reservationProof', new Blob([qr.buffer], { type: qr.mimetype }), 'payment.jpg');
      const signupResult = await request('/register', null, { method: 'POST', body: signup });
      assert.equal(signupResult.status, 302, await signupResult.clone().text());
      const applicant = await User.findOne({ where: { email } });
      ids.push(applicant.id);
      const app = await TenantApplication.findOne({ where: { tenantId: applicant.id, ownerId: propertyOwner.id } });
      assert.equal(app.reservationReference, '0123456789012');
      assert.equal(Number(app.reservationSubmittedAmount), 375.25);
      assert.equal(Number(app.reservationFee), 400);
      const pending = (await (await request('/owner-dashboard/api/pending-applications', ownerCookie)).json()).data;
      const review = pending.find(item => item.id === app.id).reservation;
      assert.equal(Number(review.submittedAmount), 375.25);
      assert.equal((await request(review.proofUrl, ownerCookie)).status, 200);
      assert.equal((await request(review.proofUrl, await login(owner.email))).status, 404);
      assert.equal((await request(review.proofUrl)).status, 404);
      assert.equal(app.status, 'pending_owner');
      assert.equal((await bedspace.reload()).availableSlots, 2);
      const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reviewUrl = `/owner-dashboard/api/pending-applications/${app.id}/approve-reservation`;
      assert.equal((await request(reviewUrl, ownerCookie, post({ paymentChecked: false }))).status, 422);
      assert.equal((await request(`/owner-dashboard/api/pending-applications/${app.tenantId}/accept`, ownerCookie, post({ applicationId: app.id, roomId: bedspace.id }))).status, 409);
      assert.equal((await request(reviewUrl, ownerCookie, post({ paymentChecked: true, amountPaid: '0' }))).status, 422);
      const approved = await request(reviewUrl, ownerCookie, post({ paymentChecked: true, amountPaid: '380.75' }));
      assert.equal(approved.status, 200, await approved.clone().text());
      assert.equal((await request(reviewUrl, ownerCookie, post({ paymentChecked: true, amountPaid: '25' }))).status, 200);
      assert.equal(Number((await app.reload()).reservationAmountPaid), 380.75);
      assert.equal((await bedspace.reload()).reservationSlots, 1);
      assert.equal(bedspace.availableSlots, 1);
      const listing = (await (await request('/api/boarding-houses')).json()).find(item => item.id === `bh-${property.id}`);
      assert.equal(listing.roomInventory.find(item => item.id === bedspace.id).reservedForTenants, 1);
      assert.ok(!JSON.stringify(listing).includes('0123456789012'));
      const applicantCookie = await login(applicant.email);
      assert.equal((await request(`/tenant-dashboard/api/applications/${app.id}/confirm`, applicantCookie, { method: 'POST' })).status, 200);
      assert.equal((await bedspace.reload()).reservationSlots, 0);
      assert.equal(bedspace.availableSlots, 1);

      const stay = await OwnerTenant.findOne({ where: { tenantUserId: applicant.id, status: 'active' } });
      const billResponse = await request('/owner-dashboard/api/payments', ownerCookie,
        post({ tenantId: stay.id, boardingHouseId: property.id, amount: '1000', dueDate: '2026-01-15', month: '2026-01' }));
      assert.equal(billResponse.status, 201, await billResponse.clone().text());
      const { data: bill } = await billResponse.json();
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
      const payment = new FormData();
      for (const [name, value] of Object.entries({ method: 'QR Ph', reference: 'RENT31PH', paidDate: today, amountPaid: '900.50', notes: 'Rent transfer' })) payment.set(name, value);
      payment.set('proof', new Blob([qr.buffer], { type: qr.mimetype }), 'rent.jpg');
      const submitted = await request(`/tenant-dashboard/api/payments/${bill.id}/submit`, applicantCookie, { method: 'POST', body: payment });
      assert.equal(submitted.status, 200, await submitted.clone().text());
      const ownerBills = (await (await request('/owner-dashboard/api/payments', ownerCookie)).json()).data;
      const reportedBill = ownerBills.find(item => item.id === bill.id);
      assert.equal(Number(reportedBill.submittedAmount), 900.5);
      assert.equal(reportedBill.totalAmount, 1000);
      assert.equal((await request(reportedBill.paymentProofUrl, ownerCookie)).status, 200);

      const confirm = (amountPaid) => request(`/owner-dashboard/api/payments/${bill.id}/pay`, ownerCookie, {
        ...post({ confirmedDate: today, amountPaid, submissionId: reportedBill.submissionId }), method: 'PATCH',
      });
      assert.equal((await confirm('9.001')).status, 422);
      assert.equal((await confirm('875.25')).status, 200);
      assert.equal((await confirm('500')).status, 200);
      const history = await (await request('/tenant-dashboard/api/payments', applicantCookie)).json();
      const received = history.payments.find(item => item.id === bill.id);
      assert.equal(Number(received.amount), 1000);
      assert.equal(Number(received.amountPaid), 875.25);
      assert.equal(history.totalPaid, 875.25);
      assert.equal(Number((await stay.reload()).balance), 0);
      const incomes = await (await request('/owner-dashboard/api/reports?type=income', ownerCookie)).json();
      assert.deepEqual(incomes.data, [{ month: today.slice(0, 7), total: 1256 }]);
      const overview = await (await request('/owner-dashboard/api/overview', ownerCookie)).json();
      assert.equal(overview.cards.monthlyIncome, 1256);

      const inquiryUser = await User.create({ fullName: 'Inquiry Reservation', email: `inq-reservation-${suffix}@example.test`, password, accountType: 'tenant' });
      ids.push(inquiryUser.id);
      const inquirer = await login(inquiryUser.email);
      const baseInquiry = { ownerId: propertyOwner.id, boardingHouseName: property.name, establishmentId: property.id,
        requestedRoomId: otherRoom.id, reserveRoom: true, reservationFee: '600', reservationMethod: 'QR Ph', reservationReference: 'QR35A' };
      assert.equal((await request('/tenant-dashboard/api/applications', inquirer, post({ ...baseInquiry, requestedRoomId: bedspace.id, reservationFee: '999' }))).status, 409);
      const multipart = fields => {
        const body = new FormData();
        for (const [name, value] of Object.entries(fields)) body.set(name, value);
        body.set('reservationProof', new Blob([qr.buffer], { type: qr.mimetype }), 'proof.jpg');
        return { method: 'POST', body };
      };
      const inquiryResponse = await request('/tenant-dashboard/api/applications', inquirer,
        multipart({ ...baseInquiry, reserveRoom: 'on', reservationPaidAmount: '600.50' }));
      assert.equal(inquiryResponse.status, 201, await inquiryResponse.clone().text());
      const { application: inquiry } = await inquiryResponse.json();
      assert.match(inquiry.preferredRoomLabel, /Whole 4/);
      assert.equal(Number(inquiry.reservationSubmittedAmount), 600.5);
      assert.equal((await request(inquiry.reservationProofUrl, inquirer)).status, 200);
      assert.equal((await request(`/owner-dashboard/api/pending-applications/${inquiry.id}/approve-reservation`, ownerCookie, post({ paymentChecked: true }))).status, 200);
      assert.equal((await otherRoom.reload()).availableSlots, 0);
      assert.equal((await request(`/tenant-dashboard/api/applications/${inquiry.id}/cancel`, inquirer, { method: 'POST' })).status, 200);
      assert.equal((await otherRoom.reload()).availableSlots, 1);

      const walkInEmail = `walk-in-${suffix}@example.test`;
      const walkIn = await request('/owner-dashboard/api/walk-in-accounts', ownerCookie, post({ fullName: 'Walk-in Tenant', email: walkInEmail,
        roomId: otherRoom.id, mode: 'assign', temporaryPassword: 'Temporary-pass-1' }));
      assert.equal(walkIn.status, 201, await walkIn.clone().text());
      const { data: walkInAccount } = await walkIn.json();
      ids.push(walkInAccount.userId);
      const temporaryPasswordUrl = `/owner-dashboard/api/walk-in-accounts/${walkInAccount.userId}/password`;
      const edit = (auth, temporaryPassword) => request(temporaryPasswordUrl, auth, { ...post({ temporaryPassword }), method: 'PATCH' });
      assert.equal((await edit(await login(owner.email), 'Unauthorized-pass')).status, 409);
      assert.equal((await edit(ownerCookie, 'Temporary-pass-2')).status, 200);
      const credentials = (email, password) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }) });
      const temporaryLogin = await request('/login', null, credentials(walkInEmail, 'Temporary-pass-2'));
      assert.equal(temporaryLogin.headers.get('location'), '/claim-walk-in');
      const claimSession = temporaryLogin.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/claim-walk-in', claimSession)).status, 200);
      const claimed = await request('/claim-walk-in', claimSession, { ...credentials('', 'Private-tenant-pass'), body: new URLSearchParams({ password: 'Private-tenant-pass', confirmPassword: 'Private-tenant-pass' }) });
      assert.equal(claimed.headers.get('location'), '/tenant-dashboard');
      assert.equal((await edit(ownerCookie, 'Unauthorized-after-claim')).status, 409);
      assert.equal((await request('/login', null, credentials(walkInEmail, 'Private-tenant-pass'))).headers.get('location'), '/tenant-dashboard');
      assert.equal((await OwnerTenant.findByPk(walkInAccount.stayId)).tenantUserId, walkInAccount.userId);

      const walkInReserve = await request('/owner-dashboard/api/walk-in-accounts', ownerCookie, multipart({ fullName: 'Walk-in Reservation', email: `walk-reserve-${suffix}@example.test`,
        roomId: bedspace.id, mode: 'reserve', temporaryPassword: 'Temporary-pass-3', reservationFee: '400', reservationPaidAmount: '399.75', reservationMethod: 'Cash' }));
      assert.equal(walkInReserve.status, 201, await walkInReserve.clone().text());
      const { data: walkReservation } = await walkInReserve.json();
      ids.push(walkReservation.userId);
      const walkApplication = await TenantApplication.findByPk(walkReservation.applicationId);
      assert.equal(walkApplication.status, 'pending_owner');
      assert.equal(Number(walkApplication.reservationSubmittedAmount), 399.75);
      assert.equal((await request(walkApplication.reservationProofUrl, ownerCookie)).status, 200);
      assert.equal(await OwnerTenant.count({ where: { tenantUserId: walkReservation.userId } }), 0);
      assert.equal((await bedspace.reload()).availableSlots, 1);

      const googleTenant = await User.create({ fullName: 'Google Reservation Tenant', email: `google-reservation-${suffix}@example.test`,
        password, accountType: 'tenant', emailVerified: true, oauthProvider: 'google' });
      ids.push(googleTenant.id);
      const { sessionStore } = await import('../../config/session.js');
      const sid = crypto.randomUUID();
      await sessionStore.set(sid, { cookie: { maxAge: 60_000 }, pendingTenantUserId: googleTenant.id });
      const googleCookie = 'dormmap.sid=' + encodeURIComponent('s:' + signature.sign(sid, sessionSecret));
      const googleBody = new FormData();
      for (const [field, value] of Object.entries({ contactNumber: '09171234567', gender: 'female', acceptTerms: 'on',
        selectedBoardingHouse: `bh-${property.id}`, requestedRoomId: String(bedspace.id), reserveRoom: 'on', reservationFee: '400',
        reservationMethod: 'Cash', reservationPaidAmount: '405' })) googleBody.set(field, value);
      googleBody.set('validIdPicture', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'id.pdf');
      const googleSignup = await request('/complete-tenant-profile', googleCookie, { method: 'POST', headers: { Accept: 'application/json' }, body: googleBody });
      assert.equal(googleSignup.status, 200, await googleSignup.clone().text());
      const googleApp = await TenantApplication.findOne({ where: { tenantId: googleTenant.id, ownerId: propertyOwner.id } });
      assert.equal(Number(googleApp.reservationSubmittedAmount), 405);
      const competingApprovals = await Promise.all([googleApp.id, walkReservation.applicationId].map(id =>
        request(`/owner-dashboard/api/pending-applications/${id}/approve-reservation`, ownerCookie, post({ paymentChecked: true }))));
      assert.deepEqual(competingApprovals.map(response => response.status).sort(), [200, 409]);
      assert.equal((await bedspace.reload()).availableSlots, 0);
      assert.equal(bedspace.reservationSlots, 1);
    });
    await request(`/tenant-dashboard/api/saved-dorms/${key}`, cookie, { method: 'DELETE' });
    assert.equal(await SavedDorm.count({ where: { tenantId: tenant.id } }), 0);
    assert.ok(room.id);
  } finally {
    await stop();
    if (ids.length) {
      const { Op } = await import('sequelize');
      await SavedDorm.destroy({ where: { tenantId: { [Op.in]: ids } } });
      await TenantDocument.destroy({ where: { tenantId: { [Op.in]: ids } } });
      const paymentIds = (await Payment.findAll({ where: { ownerId: { [Op.in]: ids } }, attributes: ['id'] })).map(item => item.id);
      await PaymentReceipt.destroy({ where: { paymentId: { [Op.in]: paymentIds } } });
      await PaymentWebhook.destroy({ where: { paymentId: { [Op.in]: paymentIds } } });
      await PaymentAuditLog.destroy({ where: { paymentId: { [Op.in]: paymentIds } } });
      await Payment.destroy({ where: { id: { [Op.in]: paymentIds } } });
      await OwnerPayment.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await OwnerInquiry.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await TenantApplication.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await OwnerTenant.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await Barangay.destroy({ where: { name: { [Op.like]: 'Review Barangay %' } } });
      await EducationalInstitution.destroy({ where: { name: { [Op.like]: 'Review School %' } } });
      await OwnerRoom.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await OwnerGallery.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await BoardingHouse.destroy({ where: { ownerId: { [Op.in]: ids } } });
      await User.destroy({ where: { id: { [Op.in]: ids } } });
    }
    await closeDatabase();
    for (const file of uploadedFiles) fs.rmSync(file, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
