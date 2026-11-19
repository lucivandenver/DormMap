import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDormigoContext } from '../services/dormigoAiService.js';

test('Dormigo counts verified branches and their real rooms and slots without private payment details', () => {
  const room = { roomType: 'Bedspace', availableSlots: 3, rentalPrice: 1200, rentalBasis: 'bed' };
  const branch = {
    name: 'Bongabong Dorm', registrationStatus: 'registered', barangay: 'Labasan',
    roomsAvailable: 1, availableSlots: 3, roomInventory: [room], gcashNumber: 'private',
    latitude: 12.75, longitude: 121.49
  };
  const snapshot = buildDormigoContext([
    branch,
    { ...branch, name: 'Branch 2', roomsAvailable: 0, availableSlots: 0, roomInventory: [] },
    { ...branch, registrationStatus: 'unregistered' }
  ], [{ name: 'Labasan' }], [
    { name: 'MinSU', latitude: '12.751', longitude: '121.49' },
    { name: 'Far school', latitude: '13', longitude: '121.49' }
  ]);
  assert.equal(snapshot.totalHouses, 2);
  assert.equal(snapshot.totalRoomsAvailable, 1);
  assert.equal(snapshot.totalAvailableSlots, 3);
  assert.equal(snapshot.houses[1].roomsCount, 0);
  assert.equal(snapshot.houses[0].rooms[0].monthlyPrice, 1200);
  assert.equal(snapshot.houses[0].rooms[0].rentalBasis, 'bed');
  assert.deepEqual(snapshot.houses[0].nearbySchools, [{ name: 'MinSU', straightLineKm: 0.11 }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /gcashNumber|private/);
});
