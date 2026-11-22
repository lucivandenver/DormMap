import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardingHouse, BoardingHouseReview, OwnerGallery, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { User } from '../models/userModel.js';
import { listTenantDorms } from '../services/dormListingService.js';
import { tenantBranchAssignments } from '../services/propertyBranchesService.js';

const main = { id: 10, ownerId: 5, name: 'Hill View', barangay: 'Labasan', isPrimary: true, approvalStatus: 'approved' };
const branch = { id: 12, ownerId: 5, name: 'Hill View — Branch 2', barangay: 'Orconuma', approvalStatus: 'approved' };
const pending = { id: 13, ownerId: 5, name: 'New branch', barangay: 'Orconuma', approvalStatus: 'pending' };
const owner = { id: 5, boardingHouseName: 'Hill View', fullName: 'Property owner', profilePicture: 'https://lh3.googleusercontent.com/owner-photo', barangay: 'Labasan' };

test('approved branches share the owner name and include five ordered photos per branch', async t => {
  t.mock.method(User, 'findAll', async () => [owner]);
  t.mock.method(BoardingHouse, 'findAll', async () => [branch, pending, main]);
  t.mock.method(OwnerRoom, 'findAll', async () => []);
  t.mock.method(OwnerTenant, 'findAll', async () => []);
  t.mock.method(BoardingHouseReview, 'findAll', async () => []);
  t.mock.method(OwnerGallery, 'findAll', async () =>
    [main, branch, pending].flatMap(house => Array.from({ length: 5 }, (_, index) => ({
      ownerId: owner.id, boardingHouseId: house.id, sortOrder: index + 1, imageUrl: `/uploads/${house.id}-${index + 1}.jpg`
    }))).reverse()
  );

  const listings = await listTenantDorms(null, { barangay: 'Orconuma' });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].propertyName, 'Hill View');
  assert.equal(listings[0].ownerProfilePicture, owner.profilePicture);
  assert.equal(listings[0].town, 'Bongabong');
  assert.equal(listings[0].branchNumber, 2);
  assert.deepEqual(listings[0].branchGalleries.map(gallery => gallery.photos.length), [5, 5]);
  assert.equal(listings[0].branchGalleries[1].photos[0].label, 'Outdoor Spaces');
  assert.equal(listings[0].branchGalleries[1].photos[0].url, '/uploads/12-1.jpg');
});

test('barangay tenant lists follow the room branch jurisdiction', async t => {
  t.mock.method(User, 'findAll', async () => [owner]);
  t.mock.method(BoardingHouse, 'findAll', async () => [branch, main]);
  t.mock.method(OwnerRoom, 'findAll', async () => [
    { id: 23, ownerId: owner.id, boardingHouseId: main.id },
    { id: 24, ownerId: owner.id, boardingHouseId: branch.id }
  ]);
  t.mock.method(OwnerTenant, 'findAll', async () => [23, 24].map(roomId => {
    const row = { ownerId: owner.id, roomId, fullName: `Tenant ${roomId}` };
    return { ...row, get: () => row };
  }));
  const local = await tenantBranchAssignments({ barangay: 'Orconuma' });
  assert.deepEqual(local.map(row => [row.fullName, row.selectedBoardingHouse, row.branchNumber]), [['Tenant 24', 'Hill View', 2]]);
  const primary = await tenantBranchAssignments({ barangay: 'Labasan' });
  assert.deepEqual(primary.map(row => row.branchNumber), [1]);
  const all = await tenantBranchAssignments({ ownerId: owner.id });
  assert.deepEqual(all.map(row => row.branchNumber), [1, 2]);
});
