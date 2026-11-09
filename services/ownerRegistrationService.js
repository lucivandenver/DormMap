import { BoardingHouse, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { propertyMetadata } from './roomPlanService.js';

export function validateOwnerSetup(body, files) {
  const metadata = propertyMetadata(body);
  const declaredBranches = Number(body.declaredBranches);
  const declaredRooms = Number(body.roomsAvailable);
  if (![declaredBranches, declaredRooms].every(count => Number.isInteger(count) && count >= 1 && count <= 100)) {
    throw Object.assign(new Error('Enter between 1 and 100 branches and rooms.'), { status: 422 });
  }
  const branches = [{ floors: metadata.floorCount, rooms: declaredRooms }];
  for (let number = 2; number <= declaredBranches; number++) {
    const floors = Number(body[`branchFloors${number}`]);
    const rooms = Number(body[`branchRooms${number}`]);
    if (!Number.isInteger(floors) || floors < 1 || floors > 50 || !Number.isInteger(rooms) || rooms < 1 || rooms > 100) {
      throw Object.assign(new Error(`Enter valid floors and rooms for branch ${number}.`), { status: 422 });
    }
    branches.push({ floors, rooms });
  }
  Object.assign(metadata, { declaredBranches, declaredRooms });
  const imageFields = ['galleryOutdoor','galleryLivingArea','galleryBedroom','galleryDining','galleryBathroom'];
  const required = ['validIdPicture', 'businessPermit', 'barangayClearance'];
  for (const field of [...required, ...imageFields]) {
    const file = files?.[field]?.[0];
    if (!file) throw Object.assign(new Error(`Please upload ${field.replace(/([A-Z])/g,' $1').toLowerCase()}.`), { status: 422 });
    const allowed = imageFields.includes(field) ? ['image/jpeg','image/png','image/webp'] : ['image/jpeg','image/png','image/webp','application/pdf'];
    if (!allowed.includes(file.mimetype) || file.size > 5*1024*1024) throw Object.assign(new Error(`Invalid file for ${field}: use the listed format, up to 5 MB.`), { status: 422 });
  }
  const lat = Number(body.boardingHouseLatitude), lng = Number(body.boardingHouseLongitude);
  if (!body.boardingHouseLatitude || !body.boardingHouseLongitude || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 12.48 || lat > 12.91 || lng < 121.05 || lng > 121.58) throw Object.assign(new Error('Select the property’s actual Bongabong location on the map.'), { status: 422 });
  return { metadata, branches };
}
export async function registerPropertyInventory(user, setup, transaction) {
  let house = await BoardingHouse.findOne({ where: { ownerId: user.id, isPrimary: true }, transaction, lock: transaction.LOCK.UPDATE });
  if (house && (await OwnerRoom.count({ where: { boardingHouseId: house.id }, transaction }) || await OwnerTenant.count({ where: { ownerId: user.id }, transaction }))) throw Object.assign(new Error('This account already has a room inventory. Manage branches and rooms from the owner dashboard.'), { status: 409 });
  const registrationSubmission = {
    fullName: user.fullName, email: user.email, boardingHouseName: user.boardingHouseName,
    barangay: user.barangay, mapPin: user.mapPin, branches: setup.branches,
    galleryImages: JSON.parse(user.galleryImages || '[]'),
    validIdPicture: user.validIdPicture, businessPermit: user.businessPermit, barangayClearance: user.barangayClearance
  };
  const values = { ...setup.metadata, registrationSubmission, address: setup.metadata.address || user.boardingHouseAddress || user.barangay, name: user.boardingHouseName, barangay: user.barangay, ownerId: user.id, latitude: user.boardingHouseLatitude, longitude: user.boardingHouseLongitude, picture: user.boardingHousePicture, isPrimary: true, approvalStatus: 'approved' };
  house = house ? await house.update(values, { transaction }) : await BoardingHouse.create(values, { transaction });

  await user.update({ boardingHouseAddress: house.address, amenities: house.amenities, houseRules: house.houseRules, description: house.description, roomsAvailable: 0, roomTypes: '[]' }, { transaction });
  return house;
}
