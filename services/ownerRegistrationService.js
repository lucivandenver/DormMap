import { PAYMENT_QR_FIELDS, validatePaymentMethods } from './ownerPaymentConfig.js';
import { BoardingHouse, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { propertyMetadata } from './roomPlanService.js';
import { GALLERY_CATEGORIES, saveGallerySlot, storeRegistrationPhotos } from './propertyPhotoService.js';

const barangays = new Set([
  'Anilao', 'Aplaya', 'Bagong Bayan I', 'Bagong Bayan II', 'Batangan', 'Bukal', 'Camantigue', 'Carmundo',
  'Cawayan', 'Dayhagan', 'Formon', 'Hagan', 'Hagupit', 'Ipil', 'Kaligtasan', 'Labasan', 'Labonan',
  'Libertad', 'Lisap', 'Luna', 'Malitbog', 'Mapang', 'Masaguisi', 'Mina de Oro', 'Morente', 'Ogbot',
  'Orconuma', 'Poblacion', 'Pulosahi', 'Sagana', 'San Isidro', 'San Jose', 'San Juan', 'Sta. Cruz',
  'Sigange', 'Tawas'
]);
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const pinLabel = (lat, lng) => `Lat ${lat.toFixed(6)}, Lon ${lng.toFixed(6)}`;
const prefixFor = index => index ? `branch${index + 1}_` : '';
const invalidSetup = message => Object.assign(new Error(message), { status: 422 });

function checkUpload(file, types, label) {
  if (!file) throw invalidSetup(`Please upload ${label}.`);
  if (!types.includes(file.mimetype) || file.size > 5 * 1024 * 1024) {
    throw invalidSetup(`Invalid file for ${label}. Use a supported format, up to 5 MB.`);
  }
}

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
  for (const field of ['validIdPicture', 'businessPermit', 'barangayClearance']) {
    checkUpload(files?.[field]?.[0], [...imageTypes, 'application/pdf'], field.replace(/([A-Z])/g, ' $1').toLowerCase());
  }
  branches.forEach((branch, index) => {
    const prefix = prefixFor(index);
    const barangay = String(body[prefix + 'boardingHouseAddress'] || '').trim();
    if (!barangay || (index > 0 && !barangays.has(barangay))) throw invalidSetup(`Select a Bongabong barangay for branch ${index + 1}.`);
    const address = String(body[prefix + 'streetAddress'] || '').trim();
    if (!address || address.toLowerCase() === barangay.toLowerCase() || address.length > 255) {
      throw invalidSetup(`Enter a street address for branch ${index + 1} (up to 255 characters).`);
    }
    const lat = Number(body[prefix + 'boardingHouseLatitude']);
    const lng = Number(body[prefix + 'boardingHouseLongitude']);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 12.48 || lat > 12.91 || lng < 121.05 || lng > 121.58) {
      throw invalidSetup(`Select branch ${index + 1}’s actual Bongabong location on the map.`);
    }
    Object.assign(branch, {
      barangay, latitude: lat, longitude: lng, mapPin: pinLabel(lat, lng),
      address
    });
    for (const category of GALLERY_CATEGORIES) {
      const file = files?.[prefix + category.field]?.[0];
      if (category.index <= 5 || file) checkUpload(file, imageTypes, `${category.label} for branch ${index + 1}`);
    }
  });
  return { metadata, branches };
}
export function validateOwnerPaymentSetup(body, files) {
  const contactNumber = String(body.contactNumber || '').trim();
  if (!/^\+?[0-9 ()-]{7,24}$/.test(contactNumber) || contactNumber.replace(/\D/g, '').length < 7) {
    throw invalidSetup('Enter a valid contact number.');
  }
  const methods = validatePaymentMethods(body.paymentMethods, null, { requireQr: false });
  const qrUploads = Object.fromEntries(Object.entries(PAYMENT_QR_FIELDS).map(([method, field]) =>
    [field, methods.includes(method) ? files?.[field]?.[0] || null : null]));
  return { contactNumber, paymentMethods: JSON.stringify(methods), qrUploads };
}

export async function registerPropertyInventory(user, setup, files, transaction) {
  let house = await BoardingHouse.findOne({ where: { ownerId: user.id, isPrimary: true }, transaction, lock: transaction.LOCK.UPDATE });
  if (house && (house.registrationSubmission || await OwnerRoom.count({ where: { boardingHouseId: house.id }, transaction }) || await OwnerTenant.count({ where: { ownerId: user.id }, transaction }))) throw Object.assign(new Error('This account already has a property registration or room inventory. Manage branches and rooms from the owner dashboard.'), { status: 409 });
  const branches = [];
  for (const [index, branch] of setup.branches.entries()) {
    const galleryImages = index
      ? await storeRegistrationPhotos(files, user.id, transaction, prefixFor(index))
      : JSON.parse(user.galleryImages || '[]');
    branches.push({ ...branch, galleryImages });
  }
  const registrationSubmission = {
    fullName: user.fullName, email: user.email, boardingHouseName: user.boardingHouseName,
    barangay: user.barangay, mapPin: user.mapPin, branches,
    galleryImages: JSON.parse(user.galleryImages || '[]'),
    validIdPicture: user.validIdPicture, businessPermit: user.businessPermit, barangayClearance: user.barangayClearance
  };
  const values = { ...setup.metadata, registrationSubmission, address: branches[0].address, mapPin: branches[0].mapPin, name: user.boardingHouseName, barangay: user.barangay, ownerId: user.id, latitude: user.boardingHouseLatitude, longitude: user.boardingHouseLongitude, picture: user.boardingHousePicture, isPrimary: true, approvalStatus: 'approved' };
  house = house ? await house.update(values, { transaction }) : await BoardingHouse.create(values, { transaction });

  await user.update({ boardingHouseAddress: house.address, amenities: house.amenities, houseRules: house.houseRules, description: house.description, roomsAvailable: 0, roomTypes: '[]' }, { transaction });
  for (const category of GALLERY_CATEGORIES) {
    const url = registrationSubmission.galleryImages[category.index - 1];
    if (url) await saveGallerySlot(user.id, house.id, category, url, transaction);
  }
  for (let index = 1; index < branches.length; index++) {
    const branch = branches[index];
    const suffix = ` — Branch ${index + 1}`;
    const listing = await BoardingHouse.create({
      name: user.boardingHouseName.slice(0, 255 - suffix.length) + suffix,
      ownerId: user.id,
      isPrimary: false,
      approvalStatus: 'approved',
      registrationSubmission: { submittedWithOwner: true },
      propertyType: setup.metadata.propertyType,
      floorCount: branch.floors,
      declaredRooms: branch.rooms,
      address: branch.address,
      barangay: branch.barangay,
      latitude: branch.latitude,
      longitude: branch.longitude,
      mapPin: branch.mapPin,
      picture: branch.galleryImages[0]
    }, { transaction });
    branch.boardingHouseId = listing.id;
    for (const category of GALLERY_CATEGORIES) {
      const url = branch.galleryImages[category.index - 1];
      if (url) await saveGallerySlot(user.id, listing.id, category, url, transaction);
    }
  }
  if (branches.length > 1) {
    await house.update({ registrationSubmission: { ...registrationSubmission, branches: [...branches] } }, { transaction });
  }
  return house;
}
