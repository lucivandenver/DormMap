import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { BoardingHouse, OwnerRoom } from '../models/ownerModels.js';
import { TenantApplication } from '../models/tenantModels.js';
import { SavedDorm } from '../models/savedDormModel.js';

export const approvedOwnerWhere = {
  accountType: 'boarding_house_owner',
  applicationStatus: { [Op.in]: ['approved', 'approved_barangay'] },
  isSuspended: false,
  isArchived: false,
  publicMapUnregistered: false,
};

export function filterDormListings(listings, query = {}) {
  const search = String(query.search || '').trim().toLowerCase();
  const barangay = String(query.barangay || 'all');
  const maxBudget = query.maxBudget === undefined || query.maxBudget === '' ? null : Number(query.maxBudget);
  if (maxBudget !== null && (!Number.isFinite(maxBudget) || maxBudget < 0)) {
    const error = new Error('Maximum budget must be a non-negative number.');
    error.status = 400;
    throw error;
  }
  const filtered = listings.filter(item => {
    if (search && ![item.name, item.ownerName, item.address, item.barangay].some(value => String(value || '').toLowerCase().includes(search))) return false;
    if (barangay !== 'all' && item.barangay !== barangay) return false;
    if (query.savedOnly === 'true' && !item.isSaved) return false;
    if (query.availableOnly === 'true' && item.roomsAvailable < 1) return false;
    if (maxBudget !== null && (item.rentalPriceMin === null || item.rentalPriceMin > maxBudget)) return false;
    return true;
  });
  if (query.sort === 'price_asc') {
    filtered.sort((a, b) => (a.rentalPriceMin ?? Infinity) - (b.rentalPriceMin ?? Infinity) || a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
  return filtered;
}

function coordinate(value, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? number : null;
}

function price(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function listTenantDorms(tenantId, query = {}, { includeUnregistered = false } = {}) {
  const owners = await User.findAll({
    where: includeUnregistered ? { accountType: 'boarding_house_owner', isSuspended: false, isArchived: false, [Op.or]: [{ applicationStatus: { [Op.in]: ['approved','approved_barangay'] }, publicMapUnregistered: false }, { publicMapUnregistered: true, publicMapPublished: true }] } : approvedOwnerWhere,
    attributes: ['id', 'fullName', 'contactNumber', 'boardingHouseName', 'boardingHouseAddress',
      'boardingHousePicture', 'barangay', 'boardingHouseLatitude', 'boardingHouseLongitude',
      'rentalPriceMin', 'rentalPriceMax', 'amenities', 'houseRules', 'roomTypes', 'paymentMethods', 'galleryImages', 'createdAt', 'publicMapUnregistered'],
  });
  const ownerIds = owners.map(owner => owner.id);
  const [houses, rooms, applications, saved] = await Promise.all([
    BoardingHouse.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }),
    OwnerRoom.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }),
    tenantId ? TenantApplication.findAll({ where: { tenantId }, order: [['createdAt', 'DESC'], ['id', 'DESC']] }) : [],
    tenantId ? SavedDorm.findAll({ where: { tenantId } }) : [],
  ]);
  const savedKeys = new Set(saved.map(item => item.listingKey));
  const listings = [];
  for (const owner of owners) {
    const ownedHouses = houses.filter(house => house.ownerId === owner.id);
    if (!ownedHouses.length && !owner.boardingHouseName) continue;
    for (const house of ownedHouses.length ? ownedHouses : [null]) {
      if (owner.publicMapUnregistered && house && house.barangay !== owner.barangay) continue;
      const key = house ? `bh-${house.id}` : `owner-${owner.id}`;
      const name = house?.name || owner.boardingHouseName || `${owner.fullName}'s Boarding House`;
      const houseRooms = rooms.filter(room => room.ownerId === owner.id &&
        (!house || room.boardingHouseId === house.id || (!room.boardingHouseId && house.isPrimary)));
      const available = houseRooms.filter(room => room.status === 'available' && Number(room.availableSlots) > 0);
      const prices = (available.length ? available : houseRooms).map(room => price(room.rentalPrice)).filter(value => value !== null);
      const app = applications.find(item => item.ownerId === owner.id &&
        (house ? item.boardingHouseId === house.id || (!item.boardingHouseId && item.boardingHouseName === name) : item.boardingHouseName === name));
      listings.push({
        id: key,
        isPrimary: !house || house.isPrimary,
        registrationStatus: owner.publicMapUnregistered ? 'unregistered' : 'registered',
        createdAt: house?.createdAt || owner.createdAt,
        roomTypes: [...new Set(houseRooms.map(room => room.roomType))],
        legacyRoomTypes: owner.roomTypes,
        paymentMethods: owner.paymentMethods,
        legacyGalleryImages: (!house || house.isPrimary) ? owner.galleryImages : null,
        establishmentId: house?.id || null,
        ownerId: owner.id,
        ownerName: owner.fullName,
        ownerContact: owner.contactNumber,
        name,
        address: house?.address || owner.boardingHouseAddress || '',
        barangay: house?.barangay || owner.barangay || '',
        latitude: coordinate(house?.latitude ?? owner.boardingHouseLatitude, 90),
        longitude: coordinate(house?.longitude ?? owner.boardingHouseLongitude, 180),
        picture: house?.picture || (house?.isPrimary || !house ? owner.boardingHousePicture : '') || '',
        description: house?.description || '',
        amenities: house?.amenities || owner.amenities || '',
        houseRules: house?.houseRules || owner.houseRules || '',
        roomsAvailable: available.length,
        availableSlots: available.reduce((sum, room) => sum + Number(room.availableSlots), 0),
        rentalPriceMin: prices.length ? Math.min(...prices) : price(owner.rentalPriceMin),
        rentalPriceMax: prices.length ? Math.max(...prices) : price(owner.rentalPriceMax),
        availableRooms: available.map(room => ({ id: room.id, roomNumber: room.roomNumber, roomType: room.roomType, rentalPrice: room.rentalPrice })),
        application: app ? { id: app.id, status: app.status, requestedRoomType: app.requestedRoomType } : null,
        isSaved: savedKeys.has(key),
      });
    }
  }
  return filterDormListings(listings, query);
}
