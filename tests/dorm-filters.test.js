import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterDormListings } from '../services/dormListingService.js';

const listings = [
  { id: 'bh-1', name: 'Alpha', ownerName: 'Ana', address: 'Near campus', barangay: 'Poblacion', rentalPriceMin: 2500, roomsAvailable: 2, isSaved: true },
  { id: 'bh-2', name: 'Bravo', ownerName: 'Ben', address: 'Market road', barangay: 'Orconuma', rentalPriceMin: 1200, roomsAvailable: 0, isSaved: false },
  { id: 'bh-3', name: 'Charlie', ownerName: 'Cia', address: 'Near campus', barangay: 'Orconuma', rentalPriceMin: null, roomsAvailable: 1, isSaved: true },
];

test('search, budget, saved and vacancy filters combine without changing the catalog', () => {
  const result = filterDormListings(listings, { search: 'CAMPUS', maxBudget: '2500', availableOnly: 'true', savedOnly: 'true' });
  assert.deepEqual(result.map(item => item.id), ['bh-1']);
  assert.equal(listings.length, 3);
  assert.deepEqual(filterDormListings(listings, { barangay: 'Orconuma', availableOnly: 'true' }).map(item => item.id), ['bh-3']);
});

test('unknown prices sort last and never count as free rent', () => {
  assert.deepEqual(filterDormListings(listings, { sort: 'price_asc' }).map(item => item.id), ['bh-2', 'bh-1', 'bh-3']);
  assert.equal(filterDormListings(listings, { maxBudget: '0' }).length, 0);
});

test('invalid budgets produce a client error', () => {
  for (const maxBudget of ['free', '-1', 'Infinity']) {
    assert.throws(() => filterDormListings(listings, { maxBudget }), error => error.status === 400);
  }
});
