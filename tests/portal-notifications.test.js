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
