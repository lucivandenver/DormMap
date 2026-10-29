import { BoardingHouse, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { parseRoomPlan, propertyMetadata } from './roomPlanService.js';

export function validateOwnerSetup(body, files) {
  const metadata = propertyMetadata(body);
  const rooms = parseRoomPlan(body.roomPlan, metadata.floorCount);
  const imageFields = ['profilePicture','galleryOutdoor','galleryLivingArea','galleryBedroom','galleryDining','galleryBathroom'];
  const required = [...imageFields,'validIdPicture','businessPermit','barangayClearance','proofOfOwnership','rentalPermit'];
  for (const field of required) {
    const file = files?.[field]?.[0];
    if (!file) throw Object.assign(new Error(`Please upload ${field.replace(/([A-Z])/g,' $1').toLowerCase()}.`), { status: 422 });
    const allowed = imageFields.includes(field) ? ['image/jpeg','image/png','image/webp'] : ['image/jpeg','image/png','image/webp','application/pdf'];
    if (!allowed.includes(file.mimetype) || file.size > 5*1024*1024) throw Object.assign(new Error(`Invalid file for ${field}: use the listed format, up to 5 MB.`), { status: 422 });
  }
  const lat = Number(body.boardingHouseLatitude), lng = Number(body.boardingHouseLongitude);
  if (!body.boardingHouseLatitude || !body.boardingHouseLongitude || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 12.48 || lat > 12.91 || lng < 121.05 || lng > 121.58) throw Object.assign(new Error('Select the property’s actual Bongabong location on the map.'), { status: 422 });
  return { metadata, rooms };
}
export async function registerPropertyInventory(user, setup, transaction) {
  let house = await BoardingHouse.findOne({ where: { ownerId: user.id, isPrimary: true }, transaction, lock: transaction.LOCK.UPDATE });
  if (house && (await OwnerRoom.count({ where: { boardingHouseId: house.id }, transaction }) || await OwnerTenant.count({ where: { ownerId: user.id }, transaction }))) throw Object.assign(new Error('This account already has a room inventory. Manage branches and rooms from the owner dashboard.'), { status: 409 });
  const values = { ...setup.metadata, address: setup.metadata.address || user.boardingHouseAddress || user.barangay, name: user.boardingHouseName, barangay: user.barangay, ownerId: user.id, latitude: user.boardingHouseLatitude, longitude: user.boardingHouseLongitude, picture: user.boardingHousePicture, isPrimary: true, approvalStatus: 'approved' };
  house = house ? await house.update(values, { transaction }) : await BoardingHouse.create(values, { transaction });
  await OwnerRoom.bulkCreate(setup.rooms.map(room => ({ ...room, ownerId: user.id, boardingHouseId: house.id })), { transaction });
  await user.update({ boardingHouseAddress: house.address, amenities: house.amenities, houseRules: house.houseRules, description: house.description, roomsAvailable: setup.rooms.filter(room => room.availableSlots > 0).length, roomTypes: JSON.stringify([...new Set(setup.rooms.map(room => room.roomType))]) }, { transaction });
  return house;
}
