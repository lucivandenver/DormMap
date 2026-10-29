import { Op } from 'sequelize';
import { listTenantDorms, approvedOwnerWhere } from './dormListingService.js';
import { User } from '../models/userModel.js';
import { OwnerTenant, OwnerGallery } from '../models/ownerModels.js';
import { Barangay, EducationalInstitution } from '../models/adminModels.js';
import { activeBarangayWhere } from './registrationPolicy.js';
import { broadcastEvent } from './websocketService.js';
import { BoardingHouse, OwnerRoom } from '../models/ownerModels.js';

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const list = JSON.parse(value); return Array.isArray(list) ? list : [String(value)]; }
  catch { return [String(value)]; }
}

export async function publicDormListings() {
  const listings = await listTenantDorms(null, {}, { includeUnregistered: true });
  const gallery = listings.length ? await OwnerGallery.findAll({ where: { ownerId: { [Op.in]: [...new Set(listings.map(item => item.ownerId))] } }, order: [['sortOrder', 'ASC']] }) : [];
  return listings.map(item => ({
    id: item.id, registrationStatus: item.registrationStatus, bhId: item.establishmentId, ownerId: item.ownerId,
    boardingHouseName: item.name, boardingHouseAddress: item.address, barangay: item.barangay,
    fullName: item.ownerName, contactNumber: item.ownerContact,
    boardingHousePicture: item.picture, latitude: item.latitude, longitude: item.longitude,
    roomsAvailable: item.roomsAvailable, availableSlots: item.availableSlots,
    rentalPriceMin: item.rentalPriceMin, rentalPriceMax: item.rentalPriceMax,
    roomTypes: item.roomTypes.length ? item.roomTypes : parseList(item.legacyRoomTypes),
    paymentMethods: parseList(item.paymentMethods), amenities: item.amenities, houseRules: item.houseRules,
    description: item.description, createdAt: item.createdAt,
    galleryImages: [...new Set([item.picture, ...parseList(item.legacyGalleryImages), ...gallery.filter(g => g.ownerId === item.ownerId && (g.boardingHouseId === item.establishmentId || (!g.boardingHouseId && item.isPrimary))).map(g => g.imageUrl)].filter(Boolean))],
  }));
}

export async function landingSnapshot() {
  const [listings, owners, institutions, officials] = await Promise.all([
    publicDormListings(), User.findAll({ where: approvedOwnerWhere, attributes: ['id'] }),
    EducationalInstitution.count({ where: { isActive: true } }),
    User.findAll({ where: activeBarangayWhere, attributes: ['barangay'] }),
  ]);
  const activeTenants = owners.length ? await OwnerTenant.count({ where: { ownerId: { [Op.in]: owners.map(owner => owner.id) }, status: 'active' } }) : 0;
  const now = new Date();
  // Calendar month in the Philippines, including the last eight hours of the prior UTC day.
  const ph = new Date(now.getTime() + 8 * 3600000);
  const start = Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), 1) - 8 * 3600000;
  return { listings, stats: {
    registeredHouses: listings.filter(item => item.registrationStatus === 'registered').length,
    newHousesThisMonth: listings.filter(item => item.registrationStatus === 'registered' && new Date(item.createdAt).getTime() >= start).length,
    activeTenants, institutions,
    barangays: new Set(officials.map(user => user.barangay).filter(Boolean)).size,
  }, updatedAt: now.toISOString() };
}

export function installLandingUpdates() {
  for (const Model of [User, BoardingHouse, OwnerRoom, OwnerTenant, OwnerGallery, Barangay, EducationalInstitution]) {
    for (const hook of ['afterCreate', 'afterUpdate', 'afterDestroy', 'afterBulkCreate', 'afterBulkUpdate', 'afterBulkDestroy']) {
      Model.addHook(hook, 'landing-public-refresh', (...args) => {
        const options = args.at(-1);
        const emit = () => broadcastEvent('landing_updated', {});
        if (options?.transaction) options.transaction.afterCommit(emit);
        else emit();
      });
    }
  }
}
