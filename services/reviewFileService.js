import { photoType } from './propertyPhotoService.js';
import { findActiveRental } from './rentalIdentityService.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { TenantApplication } from '../models/tenantModels.js';
import { BoardingHouse, OwnerPayment } from '../models/ownerModels.js';

const ReviewFile = sequelize.define('ReviewFile', {
  id: { type: DataTypes.CHAR(36), primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
  filename: { type: DataTypes.STRING(255), allowNull: false },
  scope: { type: DataTypes.STRING(32), allowNull: false },
  bytes: { type: DataTypes.BLOB('long'), allowNull: false },
});

export async function readReservationQr(ownerId, url) {
  const match = /^\/documents\/([a-f0-9-]{36})\/([\w.-]+)$/.exec(url);
  if (!match) return null;
  return ReviewFile.findOne({ where: { id: match[1], filename: match[2], userId: ownerId, scope: 'payment-qr' }, attributes: ['bytes'] });
}

export async function storeReviewFile(file, userId, scope = 'registration', transaction) {
  if (!file) return null;
  const id = randomUUID();
  let filename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-200);
  const bytes = file.buffer || await readFile(file.path);
  if (scope === 'barangay-registration' &&
      photoType(bytes) !== file.mimetype &&
      !(file.mimetype === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-')) {
    throw Object.assign(new Error('Upload a valid JPG, PNG, WebP, or PDF government ID.'), { status: 422 });
  }
  if (['payment-qr', 'payment-proof', 'reservation-proof'].includes(scope)) {
    const type = photoType(bytes);
    if (!type || type !== file.mimetype || bytes.length > 5 * 1024 * 1024) {
      throw Object.assign(new Error('Upload a valid JPG, PNG, or WebP image up to 5 MB.'), { status: 422 });
    }
    filename = scope + '.' + ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[type];
  }
  await ReviewFile.create({ id, userId, filename, scope, bytes }, { transaction });
  return `/documents/${id}/${filename}`;
}

async function canReview(viewer, file) {
  if (viewer.isArchived || viewer.isSuspended) return false;
  if (viewer.id === file.userId) return true;
  if (file.scope === 'payment-qr') {
    const rental = viewer.accountType === 'tenant' ? await findActiveRental(viewer) : null;
    return rental?.ownerId === file.userId;
  }
  if (file.scope === 'payment-proof') {
    return viewer.accountType === 'boarding_house_owner' && Boolean(await OwnerPayment.findOne({
      where: { ownerId: viewer.id, paymentProofUrl: `/documents/${file.id}/${file.filename}` },
      attributes: ['id']
    }));
  }
  if (file.scope === 'reservation-proof') {
    return viewer.accountType === 'boarding_house_owner' && Boolean(await TenantApplication.findOne({
      where: { ownerId: viewer.id, tenantId: file.userId, reservationProofUrl: `/documents/${file.id}/${file.filename}` },
      attributes: ['id'],
    }));
  }
  if (['super_admin', 'bplo_admin'].includes(viewer.accountType)) return true;

  if (viewer.accountType === 'boarding_house_owner' &&
      ['approved', 'approved_barangay', 'forwarded_to_bplo'].includes(viewer.applicationStatus) &&
      file.scope === 'tenant-registration') {
    return Boolean(await TenantApplication.findOne({
      where: { ownerId: viewer.id, tenantId: file.userId,
        status: { [Op.in]: ['pending_owner', 'accepted_by_owner', 'confirmed'] } },
      attributes: ['id']
    }));
  }
  if (viewer.accountType === 'barangay' && viewer.applicationStatus === 'approved' &&
      viewer.barangay && file.scope === 'owner-registration') {
    const owner = await User.findByPk(file.userId, { attributes: ['accountType', 'barangay'] });
    if (owner?.accountType !== 'boarding_house_owner') return false;
    if (owner.barangay === viewer.barangay) return true;
    return Boolean(await BoardingHouse.findOne({
      where: { ownerId: file.userId, barangay: viewer.barangay },
      attributes: ['id']
    }));
  }
  return false;
}

export async function serveReviewFile(req, res, next) {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.sendStatus(404);
  try {
    const viewer = req.session?.userId && await User.findByPk(req.session.userId, {
      attributes: ['id', 'email', 'accountType', 'barangay', 'applicationStatus', 'isArchived', 'isSuspended']
    });
    if (!viewer) return res.sendStatus(404);
    const file = await ReviewFile.findByPk(req.params.id, { attributes: ['id', 'filename', 'userId', 'scope'] });
    if (!file || file.filename !== req.params.filename || !await canReview(viewer, file)) return res.sendStatus(404);

    const { bytes } = await ReviewFile.findByPk(file.id, { attributes: ['bytes'] });
    const type = ({
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
      '.gif': 'image/gif', '.pdf': 'application/pdf'
    })[path.extname(file.filename).toLowerCase()];
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'" });
    if (type) res.type(type);
    else res.attachment(file.filename).type('application/octet-stream');
    return res.send(bytes);
  } catch (error) { next(error); }
}
