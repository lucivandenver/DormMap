import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/landing-search.js';
import { lookupPlace, storedPlace } from '../services/mapPlaceService.js';
const { filter, hasCoordinates } = globalThis.DormMapSearch;
const houses = [
  { boardingHouseName: "Ana's Dorm", barangay: 'Poblacion', latitude: 12.72, longitude: 121.47, rentalPriceMin: 1500, rentalPriceMax: 2500, roomTypes: ['Solo Room'] },
  { boardingHouseName: 'Far Dorm', barangay: 'Labasan', latitude: 12.85, longitude: 121.47, rentalPriceMin: 5000, rentalPriceMax: 6000, roomTypes: ['Shared Room'] },
  { boardingHouseName: 'Unknown', barangay: 'Poblacion', latitude: null, longitude: '', rentalPriceMin: null, rentalPriceMax: null, roomTypes: [] },
];
test('landing search combines actual rent ranges, barangay, type and nearby school distance', () => {
  assert.equal(filter(houses, { priceRange: '2000_3000' }).length, 1);
  assert.equal(filter(houses, { barangay: 'poblacion' }).length, 2);
  assert.equal(filter(houses, { place: { latitude: 12.72, longitude: 121.47 }, radius: 3 }).length, 1);
  assert.equal(filter(houses, { barangay: 'Labasan', priceRange: 'under_1000' }).length, 0);
  assert.equal(hasCoordinates(houses[2]), false);
});
test('database place coordinates reject blank, out-of-area and invalid points', () => {
  assert.equal(storedPlace({ latitude: '', longitude: '' }), null);
  assert.equal(storedPlace({ latitude: 0, longitude: 0 }), null);
  assert.equal(storedPlace({ latitude: 12.72, longitude: 121.47, name: 'School' }).name, 'School');
});
test('place lookup caches local OSM results and rejects wrong names and regions', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ features: [
    { properties: { name: 'Review School' }, geometry: { coordinates: [0, 0] } },
    { properties: { name: 'Wrong School' }, geometry: { coordinates: [121.47, 12.72] } },
    { properties: { name: 'Review School' }, geometry: { coordinates: [121.47, 12.72] } },
  ] }) }; };
  const first = await lookupPlace('Review School', 'institution', fetcher);
  const second = await lookupPlace('Review School', 'institution', fetcher);
  assert.equal(first.latitude, 12.72);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
});
