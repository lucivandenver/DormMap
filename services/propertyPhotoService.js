import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { DataTypes } from 'sequelize';
import { sequelize } from '../models/db.js';
import { OwnerGallery } from '../models/ownerModels.js';

export const GALLERY_CATEGORIES = [
  { index: 1, field: 'galleryOutdoor', key: 'outdoor', label: 'Outdoor Spaces', description: 'Front view, gate, compound exterior' },
  { index: 2, field: 'galleryLivingArea', key: 'living_area', label: 'Living Area', description: 'Common room, sala, lounge area' },
  { index: 3, field: 'galleryBedroom', key: 'bedroom', label: 'Bedroom', description: 'Typical room offered to tenants' },
  { index: 4, field: 'galleryDining', key: 'dining', label: 'Dining or kitchenette', description: 'Kitchen, dining area, cooking space' },
  { index: 5, field: 'galleryBathroom', key: 'bathroom', label: 'Bathroom', description: 'CR, comfort room, shower area' },
];

export const PropertyPhoto = sequelize.define('PropertyPhoto', {
  id: { type: DataTypes.CHAR(36), primaryKey: true, allowNull: false },
  ownerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
  contentType: { type: DataTypes.STRING(32), allowNull: false },
  bytes: { type: DataTypes.BLOB('medium'), allowNull: false },
}, { tableName: 'PropertyPhotos' });

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const galleryFields = new Set(['boardingHousePicture', ...GALLERY_CATEGORIES.map(category => category.field)]);

// Keep registration documents on their existing disk path. Only public property
// photos need an in-memory buffer for writing to the database.
export function registrationUploadStorage(disk) {
  const memory = multer.memoryStorage();
  const storageFor = file => galleryFields.has(file.fieldname) ? memory : disk;
  return {
    _handleFile(req, file, callback) { storageFor(file)._handleFile(req, file, callback); },
    _removeFile(req, file, callback) { storageFor(file)._removeFile(req, file, callback); },
  };
}

function photoType(bytes) {
  if (bytes?.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes?.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes?.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function storePropertyPhoto(file, ownerId, transaction) {
  const bytes = file.buffer;
  const contentType = photoType(bytes);
  if (!contentType || contentType !== file.mimetype) {
    throw Object.assign(new Error('Upload a valid JPG, PNG, or WebP property photo.'), { status: 422 });
  }
  const id = randomUUID();
  await PropertyPhoto.create({ id, ownerId, contentType, bytes }, { transaction });
  return `/uploads/property-${id}.${extensions[contentType]}`;
}

export async function saveGallerySlot(ownerId, boardingHouseId, category, imageUrl, transaction) {
  const where = { ownerId, boardingHouseId, sortOrder: category.index };
  const values = { imageUrl, caption: category.label, imageType: category.key };
  const existing = await OwnerGallery.findOne({ where, transaction });
  if (existing) await existing.update(values, { transaction });
  else await OwnerGallery.create({ ...where, ...values }, { transaction });
}

export async function storeRegistrationPhotos(files, ownerId, transaction) {
  const urls = [];
  for (const category of GALLERY_CATEGORIES) {
    const file = files?.[category.field]?.[0] || (category.index === 1 ? files?.boardingHousePicture?.[0] : null);
    urls.push(file ? await storePropertyPhoto(file, ownerId, transaction) : '');
  }
  return urls;
}

export async function servePropertyPhoto(req, res, next) {
  const match = /^property-([0-9a-f-]{36})\.(jpg|png|webp)$/.exec(req.params.filename);
  if (!match) return next();
  try {
    const photo = await PropertyPhoto.findByPk(match[1]);
    if (!photo || extensions[photo.contentType] !== match[2]) return res.sendStatus(404);
    res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return res.type(photo.contentType).send(photo.bytes);
  } catch (error) {
    return next(error);
  }
}
