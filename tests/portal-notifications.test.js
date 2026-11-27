import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget } from '../services/portalActivityService.js';
test('notification destinations are role-specific local panels, never supplied URLs',()=>{
 assert.equal(notificationTarget('tenant','message','#messages'),'/tenant-dashboard#messaging');
 assert.equal(notificationTarget('boarding_house_owner','branch_review'),'/owner-dashboard#profile');
 assert.equal(notificationTarget('super_admin','registration'),'/admin#owners');
 assert.equal(notificationTarget('barangay','branch'),'/barangay-dashboard#houses');
 assert.equal(notificationTarget('tenant','message','https://evil.test'),'/tenant-dashboard#messaging');
 assert.equal(notificationTarget('super_admin','barangay_registration'),'/admin#barangays');
 assert.equal(notificationTarget('barangay','data_request'),'/barangay-dashboard#data_requests');
 assert.equal(notificationTarget('boarding_house_owner','application_update'),'/owner-dashboard#my-profile');
 assert.equal(notificationTarget('tenant','info','#<script>'),'/tenant-dashboard#notifications');
});

test('each portal bell renders a single live unread badge', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../public/js/portal-updates.js', import.meta.url), 'utf8');
  for (const [route, template] of [
    ['/admin', 'adminDashboard'],
    ['/owner-dashboard', 'ownerDashboard'],
    ['/barangay-dashboard', 'barangayDashboard'],
    ['/tenant-dashboard', 'tenantDashboard']
  ]) {
    const html = readFileSync(new URL(`../views/${template}.xian`, import.meta.url), 'utf8');
    const button = html.match(/<button[^>]*id="(?:quickNotifBtn|notifBtn)"[\s\S]*?<\/button>/);
    assert.doesNotMatch(button?.[0] || '', /notifBadge|portal-unread/);
    const node = () => ({
      children: [], append(child) { this.children.push(child); },
      removeAttribute() {}, setAttribute() {}, addEventListener() {},
      querySelector: () => node(), querySelectorAll: () => [],
      classList: { toggle() {} }
    });
    const header = node();
    const bell = button ? node() : null;
    const body = node();
    const fetch = async () => ({ ok: true, json: async () => ({ unread: 1, items: [] }) });
    const context = {
      window: { fetch, addEventListener() {} },
      document: {
        body, querySelector: selector => selector === 'header' ? header : bell,
        getElementById: () => null, createElement: node, addEventListener() {}, querySelectorAll: () => []
      },
      location: { pathname: route },
      EventSource: class { addEventListener() {} },
      fetch, setInterval() {}, setTimeout() {}, clearTimeout() {}
    };
    runInNewContext(source, context);
    runInNewContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(body.children.length, 1);
    const badges = (bell || header.children[0]).children;
    assert.equal(badges.length, 1);
    assert.equal(badges[0].textContent, '1');
    assert.equal(badges[0].hidden, false);
  }
});

test('all portal profile menus use the compact card and admin has one activity bell with a mobile drawer backdrop', async () => {
  const { readFileSync } = await import('node:fs');
  const portals = ['adminDashboard', 'ownerDashboard', 'barangayDashboard', 'tenantDashboard'];
  for (const portal of portals) {
    const html = readFileSync(new URL(`../views/${portal}.xian`, import.meta.url), 'utf8');
    assert.match(html, /w-\[min\(14rem,calc\(100vw-1rem\)\)\]/, `${portal} profile dropdown should match the compact tenant card`);
    assert.match(html, /fa-user-pen[^>]*><\/i>\s*Profile/, `${portal} profile action should include its icon`);
    assert.match(html, /fa-gear[^>]*><\/i>\s*Settings/, `${portal} settings action should include its icon`);
    assert.match(html, /fa-right-from-bracket[^>]*><\/i>\s*Sign Out/, `${portal} sign out action should include its red icon`);
  }
  const admin = readFileSync(new URL('../views/adminDashboard.xian', import.meta.url), 'utf8');
  assert.equal((admin.match(/id="notifBtn"/g) || []).length, 1, 'admin should render one activity bell that portal-updates can bind');
  assert.match(admin, /id="mobileOverlay"[^>]*hidden[^>]*lg:hidden/, 'admin mobile navigation should include a dismissible backdrop');
  assert.match(admin, /setAdminSidebarOpen\(document\.getElementById\('sidebar'\)\.classList\.contains\('-translate-x-full'\)\)/, 'admin menu button should open and close the mobile drawer');
});

test('portal headers are non-link branding and notification dropdown keeps a scrollable unread list', async () => {
  const { readFileSync } = await import('node:fs');
  for (const portal of ['adminDashboard', 'ownerDashboard', 'barangayDashboard', 'tenantDashboard']) {
    const html = readFileSync(new URL(`../views/${portal}.xian`, import.meta.url), 'utf8');
    const header = html.slice(0, html.indexOf('</header>'));
    assert.doesNotMatch(header, /<a\s+href="\/"/, `${portal} brand should not link to the homepage`);
    assert.match(header, /role="img" aria-label="DormMap .* Portal"/, `${portal} should expose its non-clickable brand label`);
  }
  const admin = readFileSync(new URL('../views/adminDashboard.xian', import.meta.url), 'utf8');
  assert.match(admin, /#adminApp header #menuToggle \{ display: inline-flex !important/, 'admin hamburger must remain visible on mobile');
  const updates = readFileSync(new URL('../public/js/portal-updates.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/css/portal-updates.css', import.meta.url), 'utf8');
  assert.match(updates, /renderItems\(notificationItems,data\.items\.filter\(item=>!item\.isRead\)\)/, 'the dropdown should only list unread notices');
  assert.match(updates, /setUnread\(0\);renderItems\(notificationItems,\[\]\)/, 'mark all read should clear the dropdown and unread badge');
  assert.match(styles, /\.portal-notification-panel\{[^}]*overflow:hidden/, 'notification card dimensions should stay capped');
  assert.match(styles, /\.portal-notification-panel \[data-notification-items\]\{[^}]*overflow-y:auto/, 'long notification lists should scroll inside the card');
});
