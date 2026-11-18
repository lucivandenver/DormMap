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
      fetch, setInterval() {}
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
