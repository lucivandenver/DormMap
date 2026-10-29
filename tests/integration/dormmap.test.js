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

test('MySQL migration, tenant shortlist, permissions, restart and uploads', {
  skip: process.env.RUN_DB_TESTS !== 'true', timeout: 90000,
}, async t => {
  // Never run fixture mutations against a normal local/production database.
  assert.match(process.env.DB_NAME || '', /_test$/);
  assert.notEqual(process.env.NODE_ENV, 'production');
  const { sequelize } = await import('../../models/db.js');
  const { migrateSchema, closeDatabase } = await import('../../services/schemaService.js');
  const { User } = await import('../../models/userModel.js');
  const { BoardingHouse, OwnerRoom, OwnerTenant, OwnerGallery } = await import('../../models/ownerModels.js');
  const { Barangay, EducationalInstitution } = await import('../../models/adminModels.js');
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
  async function start({ deniedUploads = false } = {}) {
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
      env: { ...process.env, NODE_ENV: 'development', PORT: String(port), UPLOAD_DIR: deniedUploads ? path.join(directory, 'denied-mount') : directory, UPLOAD_DIR_STRICT: 'false', SESSION_SECRET: 'integration-session-secret-keep-between-restarts', PAYMONGO_SECRET_KEY: 'sk_test_integration_webhook', PAYMONGO_WEBHOOK_SECRET_KEY: 'integration-only-webhook-secret' },
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
    // A bcrypt 5 hash must remain usable after updating the runtime to bcrypt 6.
    const password = '$2b$04$l.BV6KSMb9VAGyiF9pJpV.CWCrM5qEs2tNQ0ysFRyG4wS.5wObq0i';
    assert.equal(await bcrypt.compare('test-password-123', password), true);
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
      const rejected = await request('/register', null, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ accountType: 'boarding_house_owner', fullName: 'Blocked Owner', email: `blocked-${suffix}@example.test`, password: 'test-password-123', confirmPassword: 'test-password-123', acceptTerms: 'on', boardingHouseAddress: 'Review Barangay' }) });
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
      assert.match(data.document.fileUrl, /^\/uploads\/tenant-/);
      uploadedFiles.push(new URL('../../public' + data.document.fileUrl, import.meta.url));
      assert.equal(await (await request(data.document.fileUrl)).text(), 'fallback upload works');
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
    await t.test('room offers consume a slot only on tenant confirmation and cannot overbook', async () => {
      const offeredRoom = await saveRoom(owner.id, null, { boardingHouseId: house.id, roomNumber: 'Offered', capacity: 1, rentalPrice: 1500 });
      const app = await TenantApplication.create({ tenantId: second.id, ownerId: owner.id, boardingHouseId: house.id, boardingHouseName: house.name });
      await offerApplication(owner.id, second.id, { applicationId: app.id, roomId: offeredRoom.id, monthlyRent: 1500 });
      assert.equal((await OwnerRoom.findByPk(offeredRoom.id)).availableSlots, 1);
      assert.equal(await OwnerTenant.count({ where: { tenantUserId: second.id } }), 0);
      await confirmOffer(second.id, app.id); await confirmOffer(second.id, app.id);
      assert.equal(await OwnerTenant.count({ where: { tenantUserId: second.id } }), 1);
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
    await t.test('GCash checkout binds the correct tenant bill; duplicate webhooks reconcile once', async () => {
      const linked = await OwnerTenant.findOne({ where: { tenantUserId: second.id, ownerId: owner.id } });
      const other = await OwnerTenant.create({ ownerId: owner.id, fullName: 'Different payer', balance: 900 });
      const bill = await OwnerPayment.create({ ownerId: owner.id, tenantId: linked.id, roomId: linked.roomId, amount: 1500, penalty: 50, month: '2026-12', dueDate: '2026-12-01' });
      await linked.update({ balance: 1550 });
      const foreignBill = await OwnerPayment.create({ ownerId: owner.id, tenantId: other.id, amount: 900, dueDate: '2026-12-01', month: '2026-12' });
      await assert.rejects(initiateRentPayment({ user: second, tenantPaymentId: foreignBill.id, billingMonth: '2026-12' }), /does not belong/);
      const originalKey = process.env.PAYMONGO_SECRET_KEY; process.env.PAYMONGO_SECRET_KEY = 'sk_test_integration_contract';
      let checkouts = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        assert.match(String(url), /checkout_sessions$/); const body = JSON.parse(options.body); assert.equal(body.data.attributes.line_items[0].amount, 155000); checkouts++;
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
      const signature = crypto.createHmac('sha256', 'integration-only-webhook-secret').update(`${timestamp}.${raw}`).digest('hex');
      const signedResponse = await request('/api/payments/paymongo/webhook', null, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': `t=${timestamp},te=${signature}` }, body: raw });
      assert.equal(signedResponse.status, 200, await signedResponse.clone().text());
      await Promise.all([handlePaymongoWebhookPayload(payload), handlePaymongoWebhookPayload(payload)]);
      assert.equal((await Payment.findByPk(checkout.payment.id)).status, 'SUCCEEDED');
      assert.equal(Number((await OwnerTenant.findByPk(linked.id)).balance), 0);
      assert.equal(Number((await OwnerTenant.findByPk(other.id)).balance), 900);
      assert.equal((await OwnerPayment.findByPk(bill.id)).status, 'paid');
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
    await t.test('owner signup atomically creates a property and detailed floor/bed inventory', async () => {
      const form = new FormData();
      const data = { accountType:'boarding_house_owner', fullName:'Registered Room Owner', email:`layout-${suffix}@example.test`, password:'test-password-123',confirmPassword:'test-password-123',acceptTerms:'on',boardingHouseName:'Layout Main',boardingHouseAddress:'Orconuma',streetAddress:'Purok 2, Main Street',roomsAvailable:'1',contactNumber:'09171234567',mapPin:'Lat 12.668945, Lon 121.491777',boardingHouseLatitude:'12.668945',boardingHouseLongitude:'121.491777',propertyType:'Mixed',floorCount:'2',roomPlan:JSON.stringify([{roomNumber:'101',floor:1,roomType:'Bedspace',capacity:6,bedCount:6,rentalBasis:'bed',unavailable:2,rentalPrice:1500},{roomNumber:'201',floor:2,roomType:'Family Room',capacity:4,bedCount:2,rentalBasis:'room',unavailable:0,rentalPrice:6000}]) };
      for (const [key,value] of Object.entries(data)) form.set(key,value);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=','base64');
      for (const name of ['profilePicture','galleryOutdoor','galleryLivingArea','galleryBedroom','galleryDining','galleryBathroom','validIdPicture','businessPermit','barangayClearance','proofOfOwnership','rentalPermit']) form.set(name,new Blob([png],{type:'image/png'}),name+'.png');
      const response=await request('/register',null,{method:'POST',body:form});assert.equal(response.status,302,await response.clone().text());
      const created=await User.findOne({where:{email:data.email}});assert.ok(created);ids.push(created.id);
      for(const value of [created.profilePicture,created.boardingHousePicture,created.validIdPicture,created.businessPermit,created.barangayClearance,created.rentalPermit,...JSON.parse(created.galleryImages || '[]'),...Object.values(JSON.parse(created.supportingDocuments || '{}'))]) if(typeof value==='string'&&value.startsWith('/uploads/'))uploadedFiles.push(new URL('../../public'+value,import.meta.url));
      const primary=await BoardingHouse.findOne({where:{ownerId:created.id,isPrimary:true}});assert.equal(primary.floorCount,2);assert.equal(primary.address,'Purok 2, Main Street');
      const rooms=await OwnerRoom.findAll({where:{ownerId:created.id},order:[['roomNumber','ASC']]});assert.equal(rooms.length,2);assert.equal(rooms[0].availableSlots,4);assert.equal(rooms[1].bedCount,2);assert.equal(rooms[1].rentalBasis,'room');assert.equal(created.roomsAvailable,2);assert.equal(created.applicationStatus,'pending');
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
    await t.test('another barangay can approve its own branch without another owner account', async () => {
      const local=await User.create({fullName:'Labasan Official',email:`labasan-${suffix}@example.test`,password,accountType:'barangay',applicationStatus:'approved',barangay:'Labasan',emailVerified:true});ids.push(local.id);
      const ownerCookie=await login(owner.email), originalOfficialCookie=await login(official.email),localCookie=await login(local.email);
      const response=await request('/owner-dashboard/api/boarding-houses',ownerCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Second Barangay Branch',barangay:'Labasan',address:'Labasan main road',latitude:12.773,longitude:121.475,floorCount:4,propertyType:'Bedspace Residence'})});assert.equal(response.status,201,await response.clone().text());
      const branch=(await response.json()).data;assert.equal(branch.ownerId,owner.id);assert.equal(branch.approvalStatus,'pending');
      const post={method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})};
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`,originalOfficialCookie,post)).status,404);
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`,localCookie,post)).status,422);
      await saveRoom(owner.id,null,{boardingHouseId:branch.id,roomNumber:'401',floor:'4th Floor',roomType:'Bedspace',capacity:4,bedCount:4,rentalBasis:'bed',rentalPrice:1600});
      let listings=await(await request('/api/boarding-houses')).json();assert.ok(!listings.some(item=>item.bhId===branch.id));
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`,localCookie,post)).status,200);
      listings=await(await request('/api/boarding-houses')).json();assert.ok(listings.some(item=>item.bhId===branch.id&&item.barangay==='Labasan'&&item.ownerId===owner.id));
      assert.equal((await request(`/barangay-dashboard/api/branches/${branch.id}/review`,localCookie,{...post,body:JSON.stringify({action:'suspend',note:'Temporary inspection'})})).status,200);
      listings=await(await request('/api/boarding-houses')).json();assert.ok(!listings.some(item=>item.bhId===branch.id));
      assert.ok(listings.some(item=>item.bhId===house.id));
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
