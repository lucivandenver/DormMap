export const ROOM_TYPES = ['Bedspace','Solo Room','Shared Room','Studio','Family Room','Apartment Room'];
export const PROPERTY_TYPES = ['Boarding House','Dormitory','Apartment','Bedspace Residence','Family Rental','Mixed'];
export const floorLabel = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[n % 10] || 'th')} Floor`;
export function floorNumber(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+Floor)?$/i);
  return match ? Number(match[1]) : NaN;
}
const error = message => { throw Object.assign(new Error(message), { status: 422 }); };
export function parseRoomPlan(raw, floorCount = 1) {
  const floors = Number(floorCount);
  if (!Number.isInteger(floors) || floors < 1 || floors > 50) error('Set the number of floors between 1 and 50.');
  let rooms;
  try { rooms = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { error('The room layout could not be read. Please review your rooms.'); }
  if (!Array.isArray(rooms) || !rooms.length || rooms.length > 100) error('Add between 1 and 100 actual rooms.');
  const seen = new Set();
  return rooms.map((row, index) => {
    if (!row || typeof row !== 'object') error('Invalid room entry.');
    const roomNumber = String(row.roomNumber || '').trim();
    const floor = floorNumber(row.floor);
    if (!roomNumber || roomNumber.length > 40 || !Number.isInteger(floor) || floor < 1 || floor > floors) error(`Room ${index+1}: enter a room number and a valid floor.`);
    const key = `${floor}:${roomNumber.toLowerCase()}`;
    if (seen.has(key)) error(`Room ${roomNumber} is duplicated on ${floorLabel(floor)}.`);
    seen.add(key);
    const roomType = row.roomType || 'Solo Room';
    if (!ROOM_TYPES.includes(roomType)) error(`Room ${roomNumber}: choose a supported room type.`);
    const rentalBasis = row.rentalBasis || (roomType === 'Bedspace' ? 'bed' : 'room');
    if (!['bed','person','room'].includes(rentalBasis) || (roomType === 'Bedspace' && rentalBasis !== 'bed')) error(`Room ${roomNumber}: bedspace rent must be per bed.`);
    const capacity = Number(row.capacity), bedCount = Number(row.bedCount || capacity), unavailable = Number(row.unavailable || 0), rentalPrice = Number(row.rentalPrice);
    if (![capacity,bedCount,unavailable].every(Number.isInteger) || capacity < 1 || capacity > 100 || bedCount < 1 || bedCount > 100 || unavailable < 0 || unavailable > capacity) error(`Room ${roomNumber}: check capacity, beds and unavailable slots.`);
    if (rentalBasis === 'bed' && capacity !== bedCount) error(`Room ${roomNumber}: each bedspace has one occupant, so beds and capacity must match.`);
    if (roomType === 'Solo Room' && capacity !== 1) error(`Room ${roomNumber}: a solo room has capacity 1.`);
    if (!Number.isFinite(rentalPrice) || rentalPrice <= 0 || rentalPrice > 99999999.99 || Math.abs(rentalPrice*100-Math.round(rentalPrice*100)) > 0.00001) error(`Room ${roomNumber}: enter a positive monthly price with at most two decimals.`);
    const availableSlots = rentalBasis === 'room' && unavailable > 0 ? 0 : capacity-unavailable;
    return { roomNumber, floor: floorLabel(floor), roomType, rentalBasis, capacity, bedCount, rentalPrice, reservedSlots: unavailable, availableSlots, status: availableSlots === 0 ? 'occupied' : 'available' };
  });
}
export function propertyMetadata(body) {
  const propertyType = body.propertyType || 'Boarding House';
  const floorCount = Number(body.floorCount || 1);
  if (!PROPERTY_TYPES.includes(propertyType)) error('Choose a supported property type.');
  if (!Number.isInteger(floorCount) || floorCount < 1 || floorCount > 50) error('Set the number of floors between 1 and 50.');
  return { propertyType, floorCount, amenities: String(body.amenities || '').trim().slice(0,5000), houseRules: String(body.houseRules || '').trim().slice(0,5000), description: String(body.description || '').trim().slice(0,5000), address: String(body.streetAddress || '').trim().slice(0,2000) };
}
