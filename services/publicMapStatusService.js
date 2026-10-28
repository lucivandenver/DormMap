import { User } from '../models/userModel.js';
import { BoardingHouse } from '../models/ownerModels.js';
import { fail } from './occupancyService.js';
export async function setPublicMapStatus(owner, action) {
  if (!['unregistered','registered','publish','hide'].includes(action)) fail('Invalid map status action.');
  if (action === 'registered' && !['approved','approved_barangay'].includes(owner.applicationStatus)) fail('Approve this establishment before marking it registered.');
  if (action === 'publish') {
    if (!owner.publicMapUnregistered && !['approved','approved_barangay'].includes(owner.applicationStatus)) fail('Mark an unapproved establishment as unregistered before publishing.');
    const houses = await BoardingHouse.findAll({ where: { ownerId: owner.id, barangay: owner.barangay } });
    const points = [...houses.map(h => [h.latitude,h.longitude]), [owner.boardingHouseLatitude,owner.boardingHouseLongitude]];
    if (!points.some(([lat,lng]) => lat !== null && lng !== null && lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= 12.48 && Number(lat) <= 12.91 && Number(lng) >= 121.05 && Number(lng) <= 121.58)) fail('Add a valid Bongabong map pin before publishing.');
    if (owner.isSuspended || owner.isArchived) fail('Suspended or archived establishments cannot be published.');
  }
  await owner.update(action === 'unregistered' ? { publicMapUnregistered: true, publicMapPublished: false } : action === 'registered' ? { publicMapUnregistered: false, publicMapPublished: false } : { publicMapPublished: action === 'publish' });
  return { publicMapUnregistered: owner.publicMapUnregistered, publicMapPublished: owner.publicMapPublished };
}
