import { branchNumbers, orderBranches } from './propertyBranchesService.js';
import { GALLERY_CATEGORIES } from './propertyPhotoService.js';
import { Op, fn, col } from 'sequelize';
import { User } from '../models/userModel.js';
import { BoardingHouse, OwnerRoom, OwnerTenant, OwnerGallery, BoardingHouseReview } from '../models/ownerModels.js';
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
    if (search && ![item.name, item.propertyName, item.ownerName, item.address, item.barangay].some(value => String(value || '').toLowerCase().includes(search))) return false;
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
    attributes: ['id', 'fullName', 'profilePicture', 'contactNumber', 'boardingHouseName', 'boardingHouseAddress',
      'boardingHousePicture', 'barangay', 'boardingHouseLatitude', 'boardingHouseLongitude',
      'rentalPriceMin', 'rentalPriceMax', 'rentPerRoom', 'rentPerHead', 'amenities', 'houseRules', 'roomTypes', 'paymentMethods', 'galleryImages', 'createdAt', 'publicMapUnregistered'],
  });
  const ownerIds = owners.map(owner => owner.id);
  const [houses, rooms, applications, saved, occupants, gallery] = await Promise.all([
    BoardingHouse.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }),
    OwnerRoom.findAll({ where: { ownerId: { [Op.in]: ownerIds } } }),
    tenantId ? TenantApplication.findAll({ where: { tenantId }, order: [['createdAt', 'DESC'], ['id', 'DESC']] }) : [],
    tenantId ? SavedDorm.findAll({ where: { tenantId } }) : [],
    OwnerTenant.findAll({ where: { ownerId: { [Op.in]: ownerIds }, status: 'active' }, attributes: ['ownerId','roomId','occupantCount','bedNumber'] }),
    OwnerGallery.findAll({ where: { ownerId: { [Op.in]: ownerIds } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
  ]);
  const reviews = houses.length ? await BoardingHouseReview.findAll({
    where: { boardingHouseId: { [Op.in]: houses.map(house => house.id) } },
    attributes: ['boardingHouseId', [fn('AVG', col('rating')), 'ratingAverage'], [fn('COUNT', col('id')), 'ratingCount']],
    group: ['boardingHouseId'], raw: true,
  }) : [];
  const ratingsByHouse = new Map(reviews.map(review => [Number(review.boardingHouseId), {
    ratingAverage: Math.round(Number(review.ratingAverage || 0) * 10) / 10,
    ratingCount: Number(review.ratingCount || 0),
  }]));
  const savedKeys = new Set(saved.map(item => item.listingKey));
  const listings = [];
  for (const owner of owners) {
    const ownedHouses = orderBranches(houses.filter(house => house.ownerId === owner.id));
    if (!ownedHouses.length && !owner.boardingHouseName) continue;
    const properties = ownedHouses.length ? ownedHouses : [null];
    const ownerPhotos = gallery.filter(photo => photo.ownerId === owner.id);
    let legacyImages = [];
    try { legacyImages = JSON.parse(owner.galleryImages || '[]'); } catch { /* Missing legacy photos. */ }
    const numbers = branchNumbers(ownedHouses);
    const visible = properties.map(house => ({ house, number: numbers.get(house?.id) || 1 })).filter(({ house }) =>
      (!house || house.approvalStatus === 'approved') &&
      (!owner.publicMapUnregistered || !house || house.barangay === owner.barangay)
    );
    const branchGalleries = visible.map(({ house, number }) => {
      const primary = !house || house.isPrimary;
      const photos = GALLERY_CATEGORIES.flatMap(category => {
        const slot = ownerPhotos.find(photo => photo.boardingHouseId === house?.id && Number(photo.sortOrder) === category.index)
          || (primary && ownerPhotos.find(photo => !photo.boardingHouseId && Number(photo.sortOrder) === category.index));
        const legacy = primary && Array.isArray(legacyImages) ? legacyImages[category.index - 1] : null;
        const cover = category.index === 1 ? house?.picture || (primary && owner.boardingHousePicture) : null;
        const url = slot?.imageUrl || legacy || cover;
        return typeof url === 'string' && url.trim() ? [{ url, label: category.label, outdoor: category.key === 'outdoor' }] : [];
      });
      return { branchNumber: number, photos };
    });
    for (const { house, number: branchNumber } of visible) {
      const isPrimary = !house || house.isPrimary;
      const picture = house?.picture || (isPrimary ? owner.boardingHousePicture : '') || '';
      const galleryImages = [...new Set([picture,
        ...(isPrimary && Array.isArray(legacyImages) ? legacyImages : []),
        ...ownerPhotos.filter(photo => photo.boardingHouseId === house?.id || (!photo.boardingHouseId && isPrimary)).map(photo => photo.imageUrl)
      ].filter(url => typeof url === 'string' && url.trim()))];
      const houseLatitude = coordinate(house?.latitude, 90);
      const houseLongitude = coordinate(house?.longitude, 180);
      const hasHousePin = houseLatitude !== null && houseLongitude !== null;
      const latitude = hasHousePin ? houseLatitude : isPrimary ? coordinate(owner.boardingHouseLatitude, 90) : null;
      const longitude = hasHousePin ? houseLongitude : isPrimary ? coordinate(owner.boardingHouseLongitude, 180) : null;
      const key = house ? `bh-${house.id}` : `owner-${owner.id}`;
      const name = house?.name || owner.boardingHouseName || `${owner.fullName}'s Boarding House`;
      const houseRooms = rooms.filter(room => room.ownerId === owner.id &&
        (!house || room.boardingHouseId === house.id || (!room.boardingHouseId && house.isPrimary)));
      const rating = ratingsByHouse.get(Number(house?.id)) || { ratingAverage: 0, ratingCount: 0 };
      const available = houseRooms.filter(room => room.status === 'available' && Number(room.availableSlots) > 0);
      const prices = (available.length ? available : houseRooms).map(room => price(room.rentalPrice)).filter(value => value !== null);
      const app = applications.find(item => item.ownerId === owner.id &&
        (house ? item.boardingHouseId === house.id || (!item.boardingHouseId && item.boardingHouseName === name) : item.boardingHouseName === name));
      const roomInventory = houseRooms.map(room => {
        const active = occupants.filter(tenant => tenant.ownerId === owner.id && tenant.roomId === room.id);
        return { id: room.id, roomNumber: room.roomNumber, floor: room.floor, roomType: room.roomType, rentalBasis: room.rentalBasis, rentalPrice: Number(room.rentalPrice), capacity: room.capacity, bedCount: room.bedCount, occupiedPeople: active.reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0), occupiedBeds: room.rentalBasis === 'bed' ? active.length : null, unavailableReported: room.reservedSlots, reservedForTenants: room.reservationSlots, availableSlots: room.status === 'available' ? Number(room.availableSlots) : 0, status: room.status, genderPref: room.genderPref, furnished: room.furnished, aircon: room.aircon };
      });
      const bases = [...new Set(roomInventory.map(room => room.rentalBasis))];
      listings.push({
        id: key,
        propertyName: owner.boardingHouseName || name,
        branchNumber,
        branchGalleries,
        propertyType: house?.propertyType || 'Boarding House',
        floorCount: house?.floorCount || null,
        roomInventory,
        pricingLabel: bases.length === 1 ? `per ${bases[0]} / month` : bases.length ? 'mixed price bases — see room rates' : 'monthly — confirm with owner',
        totalCapacity: roomInventory.reduce((sum, room) => sum + room.capacity, 0),
        occupiedPeople: roomInventory.reduce((sum, room) => sum + room.occupiedPeople, 0),
        availableBeds: roomInventory.filter(room => room.rentalBasis === 'bed').reduce((sum, room) => sum + room.availableSlots, 0),
        isPrimary,
        registrationStatus: owner.publicMapUnregistered ? 'unregistered' : 'registered',
        createdAt: house?.createdAt || owner.createdAt,
        roomTypes: [...new Set(houseRooms.map(room => room.roomType))],
        legacyRoomTypes: owner.roomTypes,
        paymentMethods: owner.paymentMethods,
        galleryImages,
        establishmentId: house?.id || null,
        ratingAverage: rating.ratingAverage,
        ratingCount: rating.ratingCount,
        ownerId: owner.id,
        ownerName: owner.fullName,
        ownerProfilePicture: owner.profilePicture || null,
        town: 'Bongabong',
        ownerContact: owner.contactNumber,
        name,
        address: house?.address || owner.boardingHouseAddress || '',
        barangay: house?.barangay || owner.barangay || '',
        latitude,
        longitude,
        picture,
        description: house?.description || '',
        amenities: house?.amenities || owner.amenities || '',
        houseRules: house?.houseRules || owner.houseRules || '',
        roomsAvailable: available.length,
        availableSlots: available.reduce((sum, room) => sum + Number(room.availableSlots), 0),
        rentPerRoom: price(house?.rentPerRoom) ?? price(owner.rentPerRoom),
        rentPerHead: price(house?.rentPerHead) ?? price(owner.rentPerHead),
        rentalPriceMin: prices.length ? Math.min(...prices) : price(owner.rentalPriceMin),
        rentalPriceMax: prices.length ? Math.max(...prices) : price(owner.rentalPriceMax),
        availableRooms: roomInventory.filter(room => room.availableSlots > 0),
        application: app ? { id: app.id, status: app.status, requestedRoomType: app.requestedRoomType, hasReservation: Boolean(app.reservationRoomId) } : null,
        isSaved: savedKeys.has(key),
      });
    }
  }
  return filterDormListings(listings, query);
}
