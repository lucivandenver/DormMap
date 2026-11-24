import { PAYMENT_QR_FIELDS, ownerPaymentConfig, ownerPaymentQr, usesPaymentQr, validatePaymentMethods } from '../services/ownerPaymentConfig.js';
import { assertCurrentSubmission, assertNoOnlineCheckout, assertReferenceAvailable, manilaToday, notifyPaymentReview, paymentNotes, paymentReference, prepareManualConfirmation, validatePaidDate } from '../services/manualPaymentService.js';
import { createTenantApplication, closeDuplicatePendingApplications } from '../services/tenantApplicationService.js';
import { storeReviewFile } from '../services/reviewFileService.js';
import { GALLERY_CATEGORIES, saveGallerySlot, storePropertyPhoto } from '../services/propertyPhotoService.js';
import { BarangayMessage } from '../models/adminModels.js';
import { namedMessages } from '../services/messageIdentityService.js';
import { propertyMetadata, floorNumber } from '../services/roomPlanService.js';
import { branchName, branchNumbers } from '../services/propertyBranchesService.js';
import { syncPrimaryHouse } from '../services/primaryHouseService.js';
import { saveRoom, saveTenant, removeRoom, removeTenant, offerApplication, ownerLock, syncOccupancy, fail } from '../services/occupancyService.js';
import { reservationStatus } from '../services/tenantReservationService.js';
import { createWalkInTenant, editWalkInPassword } from '../services/walkInTenantService.js';
import { hasApprovedBarangay } from '../services/registrationPolicy.js';
import { Op, fn, col, literal } from 'sequelize';
import { User } from '../models/userModel.js';
import { BusinessPermit, AdminAuditLog, Announcement, BarangayNotification, BploPermitRenewal } from '../models/adminModels.js';
import {
  BoardingHouse, OwnerRoom, OwnerTenant, OwnerPayment, OwnerInquiry,
  OwnerMessage, OwnerNotification, OwnerActivityLog, OwnerGallery,
} from '../models/ownerModels.js';
import { TenantApplication, MaintenanceRequest } from '../models/tenantModels.js';
import { sequelize } from '../models/db.js';

const oid = (req) => req.session.userId;
const selectedBranch = value => {
  if (value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail('Select a valid boarding house branch.', 422);
  return id;
};
const propertyForRoom = (room, houses) => room?.boardingHouseId || houses.find(house => house.isPrimary)?.id || null;
const audit = (req, action, entityType, entityId, details = {}) =>
  OwnerActivityLog.create({ ownerId: oid(req), action, entityType, entityId, details, ipAddress: req.ip }).catch(() => {});

const batchId = value => (typeof value === 'string' || typeof value === 'number') && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

async function runOwnerBatch(items, getId, apply) {
  if (!Array.isArray(items) || !items.length || items.length > 25) fail('Select between 1 and 25 records.');
  const ids = items.map(item => batchId(getId(item)));
  if (ids.includes(null) || new Set(ids).size !== ids.length) fail('Choose valid, distinct records.');

  const results = [];
  for (const [index, id] of ids.entries()) {
    try {
      await apply(id, items[index]);
      results.push({ id, success: true });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) results.push({ id, success: false, error: error.message });
      else {
        console.error('Owner batch action failed for record', id, error);
        results.push({ id, success: false, error: 'Could not update this record. Refresh and try again.' });
      }
    }
  }
  return { results };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export const ownerDashboardPage = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req), { attributes: ['fullName', 'email', 'profilePicture'] });
    res.render('ownerDashboard', {
      title: 'DormMap | Owner Dashboard',
      userName: user?.fullName || req.session.userName || 'Property Owner',
      userEmail: user?.email || '',
      profilePicture: user?.profilePicture || '',
      pendingStatus: null,
    });
  } catch (error) { next(error); }
};

// ─── Overview / Dashboard Cards ───────────────────────────────────────────────

export const overview = async (req, res, next) => {
  try {
    const id = oid(req);
    const today = new Date();
    const next30 = new Date(); next30.setDate(today.getDate() + 30);

    const [owner, rooms, tenants, payments, permit, notifications, inquiries, messages] = await Promise.all([
      User.findByPk(id, { attributes: ['boardingHouseName', 'barangay', 'applicationStatus', 'roomsAvailable', 'occupiedRooms'] }),
      OwnerRoom.findAll({ where: { ownerId: id } }),
      OwnerTenant.findAll({ where: { ownerId: id, status: 'active' } }),
      OwnerPayment.findAll({ where: { ownerId: id } }),
      BusinessPermit.findOne({ where: { ownerId: id }, order: [['createdAt', 'DESC']] }),
      OwnerNotification.count({ where: { ownerId: id, isRead: false } }),
      OwnerInquiry.count({ where: { ownerId: id, status: 'new', isArchived: false } }),
      OwnerMessage.count({ where: { recipientId: id, isRead: false } }),
    ]);

    const totalRooms    = rooms.length;
    const availableRooms = rooms.filter(r => r.status === 'available' && r.availableSlots > 0).length;
    const occupiedRooms  = rooms.filter(r => r.status === 'occupied').length;
    const monthlyIncome  = payments.filter(p => p.status === 'paid' && p.month === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`).reduce((s, p) => s + Number(p.amount) + Number(p.penalty || 0), 0);
    const pendingPayments = payments.filter(p => p.status === 'pending').length;
    const overduePayments = payments.filter(p => p.status === 'pending' && new Date(p.dueDate) < today).length;
    const permitDaysLeft = permit?.expirationDate ? Math.ceil((new Date(permit.expirationDate) - today) / 86400000) : null;

    // Count pending tenant applications (tenants who selected this BH but not yet accepted)
    const pendingApplications = await TenantApplication.count({ where: { ownerId: id, status: 'pending_owner' } });

    // 6-month payment trend
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleString('default', { month: 'short' });
      const income = payments.filter(p => p.month === key && p.status === 'paid').reduce((s,p) => s + Number(p.amount) + Number(p.penalty || 0), 0);
      months.push({ label, income, month: key });
    }

    // Room type breakdown
    const roomTypes = {};
    rooms.forEach(r => { roomTypes[r.roomType] = (roomTypes[r.roomType] || 0) + 1; });

    // Tenant monthly registrations (last 6 months)
    const tenantAll = await OwnerTenant.findAll({ where: { ownerId: id }, attributes: ['createdAt'] });
    const tenantMonthly = months.map(m => ({
      label: m.label,
      count: tenantAll.filter(t => {
        const d = new Date(t.createdAt);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === m.month;
      }).length,
    }));

    res.json({
      cards: {
        totalRooms, availableRooms, occupiedRooms,
        totalTenants: tenants.length,
        monthlyIncome,
        pendingInquiries: inquiries,
        pendingApplications,
        newMessages: messages,
        permitStatus: permit?.status || 'none',
        permitDaysLeft,
        notifications,
        overduePayments,
        pendingPayments,
      },
      charts: {
        rentalTrend: months,
        roomTypes: Object.entries(roomTypes).map(([type, count]) => ({ type, count })),
        occupancy: [
          { label: 'Occupied', value: occupiedRooms },
          { label: 'Available', value: availableRooms },
        ],
        tenantMonthly,
      },
      owner: owner?.get({ plain: true }),
      permit: permit?.get({ plain: true }) || null,
    });
  } catch (err) { next(err); }
};

// ─── Profile ─────────────────────────────────────────────────────────────────

function validatedRate(raw, label) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10000000) fail(`Enter a valid monthly rent per ${label}.`, 422);
  return value;
}

export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req), { attributes: { exclude: ['password', 'verificationToken', 'resetPasswordToken'] } });
    if (!user) return res.status(404).json({ error: 'Profile not found.' });
    res.json({
      data: { ...user.toJSON(), rentPaymentOptions: {
        ...ownerPaymentConfig(user),
        uploadedQrCodes: Object.fromEntries(Object.keys(PAYMENT_QR_FIELDS).map(method => [method, Boolean(ownerPaymentQr(user, method))]))
      } }
    });
  } catch (err) { next(err); }
};

export const updateProfile = async (req, res, next) => {
  try {
    const allowed = [
      'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'description',
      'operatingHours', 'rentalPriceMin', 'rentalPriceMax', 'rentPerRoom', 'rentPerHead', 'amenities', 'houseRules',
      'boardingHouseLatitude', 'boardingHouseLongitude', 'mapPin', 'gcashNumber', 'gcashName', 'gcashQrCode'
    ];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    for (const field of ['rentPerRoom', 'rentPerHead']) {
      if (field in updates) updates[field] = validatedRate(updates[field], field === 'rentPerRoom' ? 'room' : 'head');
    }
    if (Object.hasOwn(updates, 'boardingHouseName')) {
      const name = typeof updates.boardingHouseName === 'string' ? updates.boardingHouseName.trim() : '';
      if (!name || name.length > 255) fail('Enter a boarding house name of up to 255 characters.');
      updates.boardingHouseName = name;
    }
    const user = await sequelize.transaction(async transaction => {
      const account = await ownerLock(oid(req), transaction);
      await account.update(updates, { transaction });
      await syncPrimaryHouse(account.id, updates, { transaction });
      return account;
    });
    await audit(req, 'update_profile', 'User', user.id, updates);
    res.json({ data: user.get({ plain: true }), message: 'Profile updated.' });
  } catch (err) { next(err); }
};

// ─── Boarding Houses (Multiple Establishments per Owner) ────────────────────

async function ensurePrimaryProperty(owner, records, transaction) {
  const existing = records.find(house => house.isPrimary);
  if (existing) return existing;
  if (owner.boardingHouseName) {
    const legacy = records.find(house => house.name === owner.boardingHouseName);
    if (legacy) return legacy.update({ isPrimary: true }, { transaction });
  }
  return BoardingHouse.create({
    ownerId: owner.id, name: owner.boardingHouseName || `${owner.fullName}'s Boarding House`,
    address: owner.boardingHouseAddress || '', barangay: owner.barangay, description: owner.description,
    latitude: owner.boardingHouseLatitude || null, longitude: owner.boardingHouseLongitude || null,
    mapPin: owner.mapPin || null, picture: owner.boardingHousePicture || '', amenities: owner.amenities || '',
    houseRules: owner.houseRules || '', rentPerRoom: owner.rentPerRoom, rentPerHead: owner.rentPerHead, isPrimary: true
  }, { transaction });
}

export const getBoardingHouses = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const { houses, mapOwner } = await sequelize.transaction(async transaction => {
      const user = await ownerLock(ownerId, transaction);
      const records = await BoardingHouse.findAll({ where: { ownerId }, order: [['id','ASC']], transaction });
      const primary = await ensurePrimaryProperty(user, records, transaction);
      await OwnerRoom.update({ boardingHouseId: primary.id }, { where: { ownerId, boardingHouseId: null }, transaction });
      return {
        houses: [primary, ...records.filter(house => house.id !== primary.id)],
        mapOwner: {
          ownerId: user.id,
          fullName: user.fullName,
          profilePicture: user.profilePicture,
          publicMapUnregistered: user.publicMapUnregistered
        }
      };
    });

    const numbers = branchNumbers(houses);
    res.json({ data: houses.map(house => ({ ...house.toJSON(), branchNumber: numbers.get(house.id) })), mapOwner });
  } catch (err) { next(err); }
};

export const createBoardingHouse = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const { address, barangay, latitude, longitude, picture, description, amenities, houseRules } = req.body;
    if (!barangay || !await hasApprovedBarangay(barangay)) return res.status(422).json({ error: 'Choose a barangay with an approved, active official. Each new branch requires its own barangay review.' });
    if (!latitude || !longitude) return res.status(422).json({ error: 'Select the actual property location on the map.' });
    if (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90 ||
        !Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180) {
      return res.status(422).json({ error: 'Invalid map coordinates.' });
    }
    const house = await sequelize.transaction(async transaction => {
      const owner = await ownerLock(ownerId, transaction);
      const houses = await BoardingHouse.findAll({ where: { ownerId }, transaction });
      const primary = await ensurePrimaryProperty(owner, houses, transaction);
      const number = Math.max(1, ...branchNumbers(houses).values()) + 1;
      return BoardingHouse.create({
        ...propertyMetadata({ ...req.body, streetAddress: address }),
        ownerId, name: branchName(primary.name, number),
        address: address || '', barangay, latitude, longitude,
        mapPin: `Lat ${latitude}, Lon ${longitude}`,
        picture: picture || '', description: description || '', amenities: amenities || '', houseRules: houseRules || '',
        rentPerRoom: validatedRate(req.body.rentPerRoom, 'room'), rentPerHead: validatedRate(req.body.rentPerHead, 'head'),
        isPrimary: false, approvalStatus: 'pending'
      }, { transaction });
    });
    await audit(req, 'create_boarding_house', 'BoardingHouse', house.id, { name: house.name });
    res.status(201).json({ data: house, message: 'Branch saved. Add its rooms, then wait for barangay review before it appears publicly.' });
  } catch (err) { next(err); }
};

export const updateBoardingHouse = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const { house, safeBody } = await sequelize.transaction(async transaction => {
      const owner = await ownerLock(ownerId, transaction);
      const house = await BoardingHouse.findOne({ where: { id: req.params.id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!house) fail('Boarding house not found.', 404);
      if (req.body.barangay && req.body.barangay !== house.barangay) fail('An existing property cannot silently move jurisdictions. Register a separate branch or contact BPLO about a transfer.');
      const safeBody = Object.fromEntries(['name','address','latitude','longitude','picture','description','amenities','houseRules','propertyType','floorCount','rentPerRoom','rentPerHead'].filter(key => req.body[key] !== undefined).map(key => [key, req.body[key]]));
      for (const field of ['rentPerRoom', 'rentPerHead']) if (field in safeBody) safeBody[field] = validatedRate(safeBody[field], field === 'rentPerRoom' ? 'room' : 'head');
      if ('propertyType' in safeBody || 'floorCount' in safeBody) { const metadata = propertyMetadata({ propertyType: safeBody.propertyType || house.propertyType, floorCount: safeBody.floorCount || house.floorCount || 1 }); safeBody.propertyType = metadata.propertyType; safeBody.floorCount = metadata.floorCount; }
      if (safeBody.floorCount && (await OwnerRoom.findAll({ where: { ownerId, boardingHouseId: house.id } })).some(room => floorNumber(room.floor) > safeBody.floorCount)) fail('Move or update rooms on higher floors before reducing this property’s floor count.');
      if (!house.isPrimary && ['rejected','revision_requested'].includes(house.approvalStatus)) safeBody.approvalStatus = 'pending';
      if ('name' in safeBody) {
        const name = typeof safeBody.name === 'string' ? safeBody.name.trim() : '';
        if (!name || name.length > 255) fail('Enter a boarding house name of up to 255 characters.');
        if (house.isPrimary) safeBody.name = name;
        else delete safeBody.name;
      }
      if ('latitude' in safeBody && safeBody.latitude !== '' && (!Number.isFinite(Number(safeBody.latitude)) || Math.abs(Number(safeBody.latitude)) > 90)) fail('Invalid latitude.');
      if ('longitude' in safeBody && safeBody.longitude !== '' && (!Number.isFinite(Number(safeBody.longitude)) || Math.abs(Number(safeBody.longitude)) > 180)) fail('Invalid longitude.');
      if (safeBody.latitude !== undefined || safeBody.longitude !== undefined) safeBody.mapPin = `Lat ${safeBody.latitude ?? house.latitude}, Lon ${safeBody.longitude ?? house.longitude}`;
      await house.update(safeBody, { transaction });
      if (house.isPrimary) await owner.update({
        boardingHouseName: house.name, boardingHouseAddress: house.address, boardingHouseLatitude: house.latitude,
        boardingHouseLongitude: house.longitude, mapPin: house.mapPin, description: house.description,
        amenities: house.amenities, houseRules: house.houseRules, rentPerRoom: house.rentPerRoom, rentPerHead: house.rentPerHead
      }, { transaction });
      return { house, safeBody };
    });
    await audit(req, 'update_boarding_house', 'BoardingHouse', house.id, safeBody);
    res.json({ data: house, message: 'Boarding house updated.' });
  } catch (err) { next(err); }
};

export const deleteBoardingHouse = async (req, res, next) => {
  try {
    await sequelize.transaction(async transaction => {
      const ownerId = oid(req); await ownerLock(ownerId, transaction);
      const house = await BoardingHouse.findOne({ where: { id: req.params.id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!house) fail('Boarding house not found.', 404);
      if (house.isPrimary) fail('Cannot delete the primary boarding house.');
      if (await OwnerRoom.count({ where: { ownerId, boardingHouseId: house.id }, transaction }) || await OwnerPayment.count({ where: { ownerId, boardingHouseId: house.id }, transaction }) || await TenantApplication.count({ where: { ownerId, boardingHouseId: house.id }, transaction })) fail('This property has room or application history and cannot be deleted.', 409);
      await OwnerGallery.destroy({ where: { ownerId, boardingHouseId: house.id }, transaction });
      await house.destroy({ transaction });
    });
    await audit(req, 'delete_boarding_house', 'BoardingHouse', req.params.id, {});
    res.json({ message: 'Boarding house deleted.' });
  } catch (error) { next(error); }
};

// ─── Rooms ────────────────────────────────────────────────────────────────────

export const getRooms = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.boardingHouseId) where.boardingHouseId = Number(req.query.boardingHouseId);
    const data = await OwnerRoom.findAll({ where, order: [['roomNumber', 'ASC']] });
    const tenants = await OwnerTenant.findAll({ where: { ownerId: oid(req), status: 'active' }, attributes: ['id','roomId','fullName','occupantCount','bedNumber'] });
    const houses = await BoardingHouse.findAll({ where: { ownerId: oid(req) }, attributes: ['id','name','approvalStatus'] });
    res.json({ data: data.map(room => {
      const house = houses.find(item => item.id === room.boardingHouseId);
      const occupants = tenants.filter(tenant => tenant.roomId === room.id);
      return { ...room.toJSON(), boardingHouseName: house?.name || '', branchApprovalStatus: house?.approvalStatus || null,
        occupants, occupiedPeople: occupants.reduce((sum, tenant) => sum + tenant.occupantCount, 0) };
    }) });
  } catch (err) { next(err); }
};

export const createRoom = async (req, res, next) => {
  try { const data = await saveRoom(oid(req), null, req.body); await audit(req, 'createRoom', 'Inventory', data?.id || req.params.id, {}); res.status(201).json({ data, message: 'Room created.' }); } catch (error) { next(error); }
};

export const updateRoom = async (req, res, next) => {
  try { const data = await saveRoom(oid(req), req.params.id, req.body); await audit(req, 'updateRoom', 'Inventory', data?.id || req.params.id, {}); res.status(200).json({ data, message: 'Room updated.' }); } catch (error) { next(error); }
};

export const deleteRoom = async (req, res, next) => {
  try { const data = await removeRoom(oid(req), req.params.id); await audit(req, 'deleteRoom', 'Inventory', data?.id || req.params.id, {}); res.status(200).json({ data, message: 'Room removed.' }); } catch (error) { next(error); }
};

export const getTenants = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req), archivedAt: req.query.archived === 'true' ? { [Op.ne]: null } : null };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where[Op.or] = ['fullName', 'email', 'contactNumber'].map(f => ({ [f]: { [Op.like]: `%${req.query.search}%` } }));
    }
    const branchId = selectedBranch(req.query.boardingHouseId);
    const [tenants, rooms, houses] = await Promise.all([
      OwnerTenant.findAll({ where, order: [['createdAt', 'DESC']] }),
      OwnerRoom.findAll({ where: { ownerId: oid(req) }, attributes: ['id', 'roomNumber', 'floor', 'boardingHouseId'] }),
      BoardingHouse.findAll({ where: { ownerId: oid(req) }, attributes: ['id', 'name', 'isPrimary'] })
    ]);
    const roomsById = new Map(rooms.map(room => [room.id, room]));
    const housesById = new Map(houses.map(house => [house.id, house]));
    res.json({ data: tenants.flatMap(tenant => {
      const room = roomsById.get(tenant.roomId);
      const boardingHouseId = propertyForRoom(room, houses);
      if (branchId && boardingHouseId !== branchId) return [];
      return [{
        ...tenant.toJSON(), boardingHouseId, roomNumber: room?.roomNumber || null, floor: room?.floor || null,
        boardingHouseName: housesById.get(boardingHouseId)?.name || null
      }];
    }) });
  } catch (err) { next(err); }
};

export const createTenant = async (req, res, next) => {
  try { const data = await saveTenant(oid(req), null, req.body); await audit(req, 'createTenant', 'Inventory', data?.id || req.params.id, {}); res.status(201).json({ data, message: 'Tenant registered.' }); } catch (error) { next(error); }
};

export const updateTenant = async (req, res, next) => {
  try { const data = await saveTenant(oid(req), req.params.id, req.body); await audit(req, 'updateTenant', 'Inventory', data?.id || req.params.id, {}); res.status(200).json({ data, message: 'Tenant updated.' }); } catch (error) { next(error); }
};

export const deleteTenant = async (req, res, next) => {
  try { const data = await removeTenant(oid(req), req.params.id); await audit(req, 'deleteTenant', 'Inventory', data?.id || req.params.id, {}); res.status(200).json({ data, message: 'Tenant removed.' }); } catch (error) { next(error); }
};

export const archiveTenants = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    res.json(await runOwnerBatch(req.body?.ids, id => id, async id => {
      const changed = await sequelize.transaction(async transaction => {
        await ownerLock(ownerId, transaction);
        const tenant = await OwnerTenant.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
        if (!tenant) fail('Tenant record not found.', 404);
        if (tenant.status === 'active') fail('Record move-out before archiving an active tenant.', 409);
        if (tenant.archivedAt) return false;
        await tenant.update({ archivedAt: new Date() }, { transaction });
        return true;
      });
      if (changed) await audit(req, 'archive_tenant', 'OwnerTenant', id);
    }));
  } catch (error) { next(error); }
};

export const listWalkInAccounts = async (req, res, next) => {
  try {
    const data = await User.findAll({ where: { accountType: 'tenant', walkInOwnerId: oid(req), isArchived: false },
      attributes: ['id', 'fullName', 'email', 'walkInPasswordPending'], order: [['createdAt', 'DESC']] });
    res.json({ data });
  } catch (error) { next(error); }
};

export const createWalkInAccount = async (req, res, next) => {
  try {
    const data = await createWalkInTenant(oid(req), req.body || {});
    await audit(req, 'create_walk_in_account', 'User', data.userId, { mode: req.body.mode });
    res.status(201).json({ data, message: data.applicationId ? 'Account ready. Review the reservation fee, then the tenant can accept the offer.' : 'Account ready. The tenant can sign in with the temporary password and set their own.' });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'That email already has an account.' });
    next(error);
  }
};

export const updateWalkInPassword = async (req, res, next) => {
  try {
    await editWalkInPassword(oid(req), req.params.id, req.body?.temporaryPassword);
    await audit(req, 'edit_walk_in_password', 'User', req.params.id);
    res.json({ message: 'Temporary password updated.' });
  } catch (error) { next(error); }
};

export const getPayments = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.tenantId) where.tenantId = req.query.tenantId;
    const branchId = selectedBranch(req.query.boardingHouseId);
    const [payments, tenants, rooms, houses] = await Promise.all([
      OwnerPayment.findAll({ where, order: [['dueDate', 'DESC']] }),
      OwnerTenant.findAll({ where: { ownerId: oid(req) }, attributes: ['id', 'fullName', 'roomId'] }),
      OwnerRoom.findAll({ where: { ownerId: oid(req) }, attributes: ['id', 'roomNumber', 'boardingHouseId'] }),
      BoardingHouse.findAll({ where: { ownerId: oid(req) }, attributes: ['id', 'name', 'isPrimary'] })
    ]);
    const tenantsById = new Map(tenants.map(tenant => [tenant.id, tenant]));
    const roomsById = new Map(rooms.map(room => [room.id, room]));
    const housesById = new Map(houses.map(house => [house.id, house]));
    const data = payments.flatMap(payment => {
      const tenant = tenantsById.get(payment.tenantId);
      const room = roomsById.get(payment.roomId || tenant?.roomId);
      const boardingHouseId = payment.boardingHouseId || propertyForRoom(room, houses);
      if (branchId && boardingHouseId !== branchId) return [];
      return [{
        ...payment.toJSON(), boardingHouseId, roomNumber: room?.roomNumber || null,
        boardingHouseName: housesById.get(boardingHouseId)?.name || null,
        totalAmount: Number(payment.amount) + Number(payment.penalty || 0),
        tenantName: tenant?.fullName || `Tenant #${payment.tenantId}`
      }];
    });
    res.json({ data, today: manilaToday() });
  } catch (err) { next(err); }
};

export const createPayment = async (req, res, next) => {
  try {
    const data = await sequelize.transaction(async transaction => {
      const ownerId = oid(req); await ownerLock(ownerId, transaction);
      const roomBatch = Boolean(req.body.roomId);
      const tenants = await OwnerTenant.findAll({
        where: { ownerId, status: 'active', ...(roomBatch ? { roomId: req.body.roomId } : { id: req.body.tenantId || 0 }) },
        order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE
      });
      if (!tenants.length) fail('Select an active tenant or a room with active tenants.');
      const branchId = selectedBranch(req.body.boardingHouseId);
      const roomId = tenants[0].roomId;
      const room = roomId ? await OwnerRoom.findOne({ where: { id: roomId, ownerId }, transaction }) : null;
      const primary = !room?.boardingHouseId && await BoardingHouse.findOne({ where: { ownerId, isPrimary: true }, transaction });
      const billingBranch = room?.boardingHouseId || primary?.id || null;
      if (branchId && (branchId !== billingBranch || (roomId && !room))) {
        fail('Select a tenant or room from this boarding house.', 422);
      }
      const amount = Number(req.body.amount), penalty = Number(req.body.penalty || 0);
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(penalty) || penalty < 0) fail('Enter a valid positive amount and non-negative penalty.');
      const dueDate = req.body.dueDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') || (!Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0,10) !== dueDate)) fail('A valid due date is required.');
      const month = req.body.month || dueDate.slice(0,7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('Invalid billing month.');
      if (await OwnerPayment.findOne({ where: { ownerId, tenantId: { [Op.in]: tenants.map(tenant => tenant.id) }, month }, transaction })) {
        fail('A bill already exists for a selected tenant and month.', 409);
      }
      const amountCents = Math.round(amount * 100);
      const penaltyCents = Math.round(penalty * 100);
      if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(penaltyCents) || amountCents < tenants.length ||
          Math.abs(amount * 100 - amountCents) > 0.00001 || Math.abs(penalty * 100 - penaltyCents) > 0.00001) {
        fail('Enter valid amounts with up to two decimal places and at least one centavo per tenant.');
      }
      const share = (cents, index) => (Math.floor(cents / tenants.length) + Number(index < cents % tenants.length)) / 100;
      const bills = [];
      for (const [index, tenant] of tenants.entries()) {
        const rent = share(amountCents, index);
        const fee = share(penaltyCents, index);
        const bill = await OwnerPayment.create({ ownerId, tenantId: tenant.id, roomId: tenant.roomId, boardingHouseId: billingBranch, amount: rent, penalty: fee, dueDate, month, status: 'pending', notes: String(req.body.notes || '').slice(0,2000) }, { transaction });
        await tenant.update({ balance: Number(tenant.balance) + rent + fee }, { transaction });
        bills.push(bill);
      }
      return roomBatch ? bills : bills[0];
    });
    res.status(201).json({ data, message: 'Rent bill created and tenant balance updated.' });
  } catch (error) { next(error); }
};
export const markPaid = async (req, res, next) => {
  try {
    const reviewDate = validatePaidDate(req.body.confirmedDate ?? req.body.receivedDate ?? manilaToday());
    const reviewNotes = paymentNotes(req.body.notes);
    await prepareManualConfirmation(oid(req), req.params.id, req.body);
    const data = await sequelize.transaction(async transaction => {
      const ownerId = oid(req); await ownerLock(ownerId, transaction);
      const bill = await OwnerPayment.findOne({ where: { id: req.params.id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!bill) fail('Bill not found.', 404);
      assertCurrentSubmission(bill, req.body);
      if (bill.status === 'paid') return bill;
      if (bill.reviewStatus === 'declined') fail('Wait for the tenant to submit updated payment details.', 409);
      await assertNoOnlineCheckout(bill, transaction);
      const tenant = await OwnerTenant.findOne({ where: { id: bill.tenantId, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!tenant) fail('The linked tenancy is missing.');
      const method = req.body.method || bill.submittedMethod || 'Cash';
      if (!['Cash','GCash','QR Ph','Bank Transfer','Other'].includes(method)) fail('Invalid payment method.');
      const reference = usesPaymentQr(method) ? paymentReference(req.body.reference ?? bill.submittedReference, method) : null;
      if (reference) await assertReferenceAvailable(bill, method, reference, transaction);
      await bill.update({
        status: 'paid', paidDate: reviewDate, method, reference,
        reviewStatus: 'confirmed', reviewDate, reviewNotes
      }, { transaction });
      await tenant.update({ balance: Math.max(0, Number(tenant.balance)-Number(bill.amount)-Number(bill.penalty)) }, { transaction });
      await notifyPaymentReview(bill, tenant, 'confirmed', transaction);
      return bill;
    });
    res.json({ data, message: 'Payment confirmed. The tenant has been notified.' });
  } catch (error) { next(error); }
};

export const returnPaymentSubmission = async (req, res, next) => {
  try {
    const reviewDate = validatePaidDate(req.body.confirmedDate ?? manilaToday());
    const reviewNotes = paymentNotes(req.body.notes, true);
    const data = await sequelize.transaction(async transaction => {
      const ownerId = oid(req);
      await ownerLock(ownerId, transaction);
      const bill = await OwnerPayment.findOne({
        where: { id: req.params.id, ownerId }, transaction, lock: transaction.LOCK.UPDATE
      });
      if (!bill) fail('Bill not found.', 404);
      assertCurrentSubmission(bill, req.body);
      if (bill.status !== 'pending' || !bill.submittedMethod) fail('There is no submission awaiting review.', 409);
      if (bill.reviewStatus === 'declined') return bill;
      const tenant = await OwnerTenant.findOne({ where: { id: bill.tenantId, ownerId }, transaction });
      if (!tenant) fail('The linked tenancy is missing.');
      await bill.update({ reviewStatus: 'declined', reviewDate, reviewNotes }, { transaction });
      await notifyPaymentReview(bill, tenant, 'declined', transaction);
      return bill;
    });
    res.json({ data, message: 'Payment declined. The tenant has been notified with your notes.' });
  } catch (error) { next(error); }
};

export const deletePayment = async (req, res, next) => {
  try {
    await sequelize.transaction(async transaction => {
      await ownerLock(oid(req), transaction);
      const bill = await OwnerPayment.findOne({ where: { id: req.params.id, ownerId: oid(req) }, transaction, lock: transaction.LOCK.UPDATE });
      if (!bill) fail('Bill not found.', 404);
      const { Payment } = await import('../models/paymentModels.js');
      if (bill.status === 'paid' || bill.submittedMethod || await Payment.count({ where: { tenantPaymentId: bill.id }, transaction })) fail('Bills with payment history cannot be deleted.', 409);
      const tenant = await OwnerTenant.findOne({ where: { id: bill.tenantId, ownerId: oid(req) }, transaction, lock: transaction.LOCK.UPDATE });
      if (tenant) await tenant.update({ balance: Math.max(0, Number(tenant.balance)-Number(bill.amount)-Number(bill.penalty)) }, { transaction });
      await bill.destroy({ transaction });
    });
    res.json({ message: 'Unpaid bill removed and balance updated.' });
  } catch (error) { next(error); }
};

export const getInquiries = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req), isArchived: req.query.archived === 'true' };
    if (req.query.status) where.status = req.query.status;
    const data = await OwnerInquiry.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ data });
  } catch (err) { next(err); }
};

export const replyInquiry = async (req, res, next) => {
  try {
    const inq = await sequelize.transaction(async transaction => {
      const inquiry = await OwnerInquiry.findOne({ where: { id: req.params.id, ownerId: oid(req), isArchived: false }, transaction, lock: transaction.LOCK.UPDATE });
      if (!inquiry) fail('Open inquiry not found.', 404);
      return inquiry.update({ reply: req.body.reply, status: 'replied', visitDate: req.body.visitDate || null }, { transaction });
    });
    await audit(req, 'reply_inquiry', 'OwnerInquiry', inq.id, {});
    res.json({ data: inq, message: 'Reply sent.' });
  } catch (err) { next(err); }
};

export const archiveInquiry = async (req, res, next) => {
  try {
    await archiveOwnerInquiry(req, req.params.id);
    res.json({ message: 'Inquiry archived.' });
  } catch (err) { next(err); }
};

async function archiveOwnerInquiry(req, id) {
  const ownerId = oid(req);
  const [changed] = await OwnerInquiry.update({ isArchived: true, status: 'completed' }, { where: { id, ownerId, isArchived: false } });
  if (changed) await audit(req, 'archive_inquiry', 'OwnerInquiry', id);
  else if (!await OwnerInquiry.count({ where: { id, ownerId } })) fail('Inquiry not found.', 404);
}

export const archiveInquiries = async (req, res, next) => {
  try {
    res.json(await runOwnerBatch(req.body?.ids, id => id, id => archiveOwnerInquiry(req, id)));
  } catch (error) { next(error); }
};

export const createInquiry = async (req, res, next) => {
  try {
    const data = await OwnerInquiry.create({ ...req.body, ownerId: oid(req) });
    res.status(201).json({ data, message: 'Inquiry created.' });
  } catch (err) { next(err); }
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export const getMessages = async (req, res, next) => {
  try {
    const id = oid(req);
    const direct = await OwnerMessage.findAll({
      where: { [Op.or]: [{ senderId: id }, { recipientId: id }] },
      order: [['createdAt', 'DESC']],
    });
    const official = await BarangayMessage.findAll({ where: { [Op.or]: [{ senderId: id }, { recipientId: id }] }, order: [['createdAt','DESC']] });
    const data = [...direct,...official].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    await BarangayMessage.update({isRead:true},{where:{recipientId:id,isRead:false}});
    await OwnerMessage.update({ isRead: true }, { where: { recipientId: id, isRead: false } });
    res.json({ data: await namedMessages(data, id) });
  } catch (err) { next(err); }
};

export const sendMessage = async (req, res, next) => {
  try {
    const recipient = await User.findByPk(req.body.recipientId);
    const message = String(req.body.message || '').trim();
    if (!recipient || recipient.isArchived || recipient.isSuspended || recipient.id === Number(oid(req)) || !message || message.length > 5000) return res.status(422).json({ error: 'Select a recipient and enter a message up to 5,000 characters.' });
    const prior = await OwnerMessage.count({ where: { [Op.or]: [{ senderId: oid(req), recipientId: recipient.id }, { senderId: recipient.id, recipientId: oid(req) }] } });
    const tenant = await OwnerTenant.count({ where: { ownerId: oid(req), tenantUserId: recipient.id } });
    const officialConversation = await BarangayMessage.count({ where: { [Op.or]: [{senderId:oid(req),recipientId:recipient.id},{senderId:recipient.id,recipientId:oid(req)}] } });
    if (officialConversation && ['barangay','super_admin','bplo_admin'].includes(recipient.accountType)) {
      const data = await BarangayMessage.create({senderId:oid(req),recipientId:recipient.id,message,subject:String(req.body.subject||'').slice(0,255)||null});
      return res.status(201).json({data,message:'Message sent.'});
    }
    if (!prior && !tenant) return res.status(403).json({ error: 'Choose one of your existing conversations or tenants.' });
    const data = await OwnerMessage.create({ recipientId: recipient.id, message, subject: String(req.body.subject || '').slice(0,255) || null, senderId: oid(req), ownerId: oid(req) });
    res.status(201).json({ data, message: 'Message sent.' });
  } catch (err) { next(err); }
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const getNotifications = async (req, res, next) => {
  try {
    const data = await OwnerNotification.findAll({ where: { ownerId: oid(req) }, order: [['createdAt', 'DESC']], limit: 50 });
    res.json({ data });
  } catch (err) { next(err); }
};

export const markNotificationRead = async (req, res, next) => {
  try {
    await OwnerNotification.update({ isRead: true }, { where: { ownerId: oid(req), id: req.params.id } });
    res.json({ message: 'Marked as read.' });
  } catch (err) { next(err); }
};

export const markAllNotificationsRead = async (req, res, next) => {
  try {
    await OwnerNotification.update({ isRead: true }, { where: { ownerId: oid(req) } });
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) { next(err); }
};

// ─── Gallery (5 Categorized Photo Slots) ───────────────────────────────────────

export const getGallery = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    let boardingHouseId = req.query.boardingHouseId ? Number(req.query.boardingHouseId) : null;

    // Fetch all boarding houses for this owner (for the selector dropdown)
    let boardingHouses = await BoardingHouse.findAll({
      where: { ownerId },
      attributes: ['id', 'name', 'address', 'isPrimary', 'picture'],
      order: [['isPrimary', 'DESC'], ['name', 'ASC']]
    });

    const owner = await User.findByPk(ownerId, {
      attributes: ['id', 'fullName', 'boardingHousePicture', 'galleryImages', 'boardingHouseName', 'boardingHouseAddress', 'barangay', 'description', 'amenities', 'houseRules']
    });

    // Auto-seed primary boarding house from User profile if none exist (matches getBoardingHouses logic)
    if ((!boardingHouses || boardingHouses.length === 0) && owner) {
      const primaryHouse = await BoardingHouse.create({
        ownerId,
        name: owner.boardingHouseName || `${owner.fullName}'s Boarding House`,
        address: owner.boardingHouseAddress || owner.barangay || 'Bongabong',
        barangay: owner.barangay || '',
        latitude: '12.7192',
        longitude: '121.4719',
        mapPin: 'Lat 12.7192, Lon 121.4719',
        picture: owner.boardingHousePicture || '',
        description: owner.description || '',
        amenities: owner.amenities || '',
        houseRules: owner.houseRules || '',
        isPrimary: true
      });
      boardingHouses = [primaryHouse];
    }

    // Default to the first / primary boarding house if not explicitly specified
    if (!boardingHouseId && boardingHouses.length > 0) {
      boardingHouseId = boardingHouses[0].id;
    }

    const selectedBh = boardingHouses.find(b => b.id === boardingHouseId) || null;
    if (boardingHouseId && !selectedBh) fail('Boarding house not found.', 404);
    const useLegacyPhotos = !selectedBh || selectedBh.isPrimary;

    // Build OwnerGallery query — filter by boardingHouseId
    let dbGallery = [];
    if (boardingHouseId) {
      dbGallery = await OwnerGallery.findAll({
        where: { ownerId, boardingHouseId },
        order: [['sortOrder', 'ASC']]
      });

      // A primary property can have older slots without a property ID.
      if (useLegacyPhotos) {
        const legacyGallery = await OwnerGallery.findAll({
          where: { ownerId, boardingHouseId: null },
          order: [['sortOrder', 'ASC']]
        });
        dbGallery.push(...legacyGallery);
      }
    } else {
      dbGallery = await OwnerGallery.findAll({
        where: { ownerId, boardingHouseId: null },
        order: [['sortOrder', 'ASC']]
      });
    }

    // Fallback: if no BH-specific photos, use legacy galleryImages from User (for primary house)
    const savedImages = useLegacyPhotos && owner ? savedGalleryImages(owner) : [];

    // Map 5 distinct categories
    const slots = GALLERY_CATEGORIES.map((cat, idx) => {
      let imageUrl = null;
      // First: try OwnerGallery record
      const matched = dbGallery.find(g =>
        g.sortOrder === cat.index ||
        g.imageType === cat.key ||
        (g.caption && g.caption.toLowerCase().includes(cat.label.toLowerCase()))
      );
      if (matched) imageUrl = matched.imageUrl;
      // Fallback: legacy galleryImages array
      if (!imageUrl) imageUrl = savedImages[idx] || null;
      // Fallback: cover photo from BoardingHouse or User
      if (!imageUrl && idx === 0) {
        imageUrl = selectedBh?.picture || (useLegacyPhotos ? owner?.boardingHousePicture : null) || null;
      }
      return { index: cat.index, key: cat.key, label: cat.label, description: cat.description, imageUrl, isMainListing: cat.index === 1 };
    });

    res.json({
      success: true,
      slots,
      boardingHouses: boardingHouses.map(bh => (typeof bh.get === 'function' ? bh.get({ plain: true }) : bh)),
      selectedBoardingHouseId: boardingHouseId,
      boardingHousePicture: slots[0]?.imageUrl || null,
      data: dbGallery
    });
  } catch (err) { next(err); }
};

function galleryHouse(ownerId, houseId, transaction) {
  const options = houseId
    ? { where: { id: houseId, ownerId } }
    : { where: { ownerId }, order: [['isPrimary', 'DESC'], ['id', 'ASC']] };
  return BoardingHouse.findOne({ ...options, transaction });
}

function savedGalleryImages(user) {
  try {
    const parsed = JSON.parse(user.galleryImages);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* Older accounts may have a malformed gallery value. */ }
  return [];
}

async function updateGalleryPhotos(ownerId, requestedHouseId, uploads) {
  return sequelize.transaction(async transaction => {
    const user = await ownerLock(ownerId, transaction);
    const house = await galleryHouse(ownerId, requestedHouseId, transaction);
    if (requestedHouseId && !house) fail('Boarding house not found or does not belong to you.', 403);

    const isPrimary = !house || house.isPrimary;
    const galleryImages = isPrimary ? savedGalleryImages(user) : [];
    while (galleryImages.length < GALLERY_CATEGORIES.length) galleryImages.push('');

    const urls = {};
    for (const { category, file } of uploads) {
      const url = await storePropertyPhoto(file, ownerId, transaction);
      urls[category.index] = url;
      await saveGallerySlot(ownerId, house?.id ?? null, category, url, transaction);
      if (category.index === 1 && house) await house.update({ picture: url }, { transaction });
      if (isPrimary) galleryImages[category.index - 1] = url;
    }
    if (isPrimary) {
      const values = { galleryImages: JSON.stringify(galleryImages) };
      if (urls[1]) values.boardingHousePicture = urls[1];
      await user.update(values, { transaction });
    }
    return { house, urls };
  });
}

export const updateGallerySlot = async (req, res, next) => {
  try {
    const category = GALLERY_CATEGORIES.find(item => item.index === Number(req.params.slotIndex));
    if (!category) fail('Invalid slot index (must be 1 to 10).', 400);
    if (!req.file) fail('No image uploaded for this slot.', 400);

    const { house, urls } = await updateGalleryPhotos(oid(req), req.body.boardingHouseId || req.query.boardingHouseId, [{ category, file: req.file }]);
    const imageUrl = urls[category.index];
    const boardingHouseId = house?.id ?? null;
    await audit(req, 'update_gallery_slot', 'User', oid(req), { slotIndex: category.index, imageUrl, boardingHouseId });
    res.json({
      success: true,
      message: `${category.label} updated successfully!`,
      slot: { index: category.index, label: category.label, imageUrl },
      boardingHouseId,
    });
  } catch (err) { next(err); }
};

export const deleteGallerySlot = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const slotIndex = Number(req.params.slotIndex);
    const requestedHouseId = req.query.boardingHouseId || req.body.boardingHouseId;
    if (!GALLERY_CATEGORIES.some(category => category.index === slotIndex)) {
      fail('Invalid slot index (must be 1 to 10).', 400);
    }

    const boardingHouseId = await sequelize.transaction(async transaction => {
      const user = await ownerLock(ownerId, transaction);
      const house = await galleryHouse(ownerId, requestedHouseId, transaction);
      if (requestedHouseId && !house) fail('Boarding house not found or does not belong to you.', 403);
      const where = { ownerId, sortOrder: slotIndex, boardingHouseId: house?.id ?? null };

      if (slotIndex === 1 && house) await house.update({ picture: '' }, { transaction });
      if (!house || house.isPrimary) {
        const galleryImages = savedGalleryImages(user);
        if (slotIndex <= galleryImages.length) galleryImages[slotIndex - 1] = '';
        const values = { galleryImages: JSON.stringify(galleryImages) };
        if (slotIndex === 1) values.boardingHousePicture = null;
        await user.update(values, { transaction });
        if (house) where.boardingHouseId = { [Op.or]: [house.id, null] };
      }
      await OwnerGallery.destroy({ where, transaction });
      return house?.id ?? null;
    });

    await audit(req, 'delete_gallery_slot', 'User', ownerId, { slotIndex, boardingHouseId });
    res.json({ success: true, message: 'Photo removed from category slot.' });
  } catch (err) { next(err); }
};

export const updateFiveGallerySlots = async (req, res, next) => {
  try {
    const uploads = GALLERY_CATEGORIES
      .map(category => ({ category, file: req.files?.[category.field]?.[0] }))
      .filter(upload => upload.file);
    if (!uploads.length) fail('Choose at least one photo to upload.', 400);

    const { house } = await updateGalleryPhotos(oid(req), req.body.boardingHouseId, uploads);
    const boardingHouseId = house?.id ?? null;
    const updatedCount = uploads.length;
    await audit(req, 'update_five_gallery_slots', 'User', oid(req), { updatedCount, boardingHouseId });
    res.json({
      success: true,
      message: `${updatedCount} photo ${updatedCount === 1 ? 'category' : 'categories'} updated successfully for ${house?.name || 'boarding house'}!`,
      boardingHouseId,
    });
  } catch (err) { next(err); }
};

export const addGalleryImage = async (req, res, next) => {
  try {
    if (!req.file) fail('No image uploaded.', 400);
    const ownerId = oid(req);
    const data = await sequelize.transaction(async transaction => {
      await ownerLock(ownerId, transaction);
      const where = { ownerId };
      if (req.body.boardingHouseId) where.id = req.body.boardingHouseId;
      else where.isPrimary = true;
      const house = await BoardingHouse.findOne({ where, transaction });
      if (req.body.boardingHouseId && !house) fail('Boarding house not found.', 404);
      const maxOrder = await OwnerGallery.max('sortOrder', { where: { ownerId }, transaction }) || 5;
      const imageUrl = await storePropertyPhoto(req.file, ownerId, transaction);
      return OwnerGallery.create({
        ownerId,
        boardingHouseId: house?.id ?? null,
        imageUrl,
        caption: req.body.caption || '',
        sortOrder: Math.max(maxOrder, 5) + 1,
        imageType: req.body.imageType || 'gallery',
      }, { transaction });
    });
    await audit(req, 'add_gallery', 'OwnerGallery', data.id, { imageUrl: data.imageUrl });
    res.status(201).json({ data, message: 'Image uploaded.' });
  } catch (err) { next(err); }
};

export const deleteGalleryImage = async (req, res, next) => {
  try {
    const img = await OwnerGallery.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!img) return res.status(404).json({ error: 'Image not found.' });
    await img.destroy();
    res.json({ message: 'Image deleted.' });
  } catch (err) { next(err); }
};

// ─── Amenities ────────────────────────────────────────────────────────────────

export const updateAmenities = async (req, res, next) => {
  try {
    const amenities = JSON.stringify(req.body.amenities || []);
    await User.update({ amenities }, { where: { id: oid(req) } });
    await syncPrimaryHouse(oid(req), { amenities });
    await audit(req, 'update_amenities', 'User', oid(req), {});
    res.json({ message: 'Amenities updated.' });
  } catch (err) { next(err); }
};

// ─── House Rules ──────────────────────────────────────────────────────────────

export const updateHouseRules = async (req, res, next) => {
  try {
    const houseRules = JSON.stringify(req.body.rules || []);
    await User.update({ houseRules }, { where: { id: oid(req) } });
    await syncPrimaryHouse(oid(req), { houseRules });
    await audit(req, 'update_rules', 'User', oid(req), {});
    res.json({ message: 'House rules updated.' });
  } catch (err) { next(err); }
};

// ─── Map / Location ───────────────────────────────────────────────────────────

export const updateLocation = async (req, res, next) => {
  try {
    const { latitude, longitude, mapPin } = req.body;
    if (latitude === '' || longitude === '' || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) || Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180) fail('Choose valid map coordinates.');
    const coordinates = { boardingHouseLatitude: latitude, boardingHouseLongitude: longitude, mapPin: `Lat ${latitude}, Lon ${longitude}` };
    await User.update(coordinates, { where: { id: oid(req) } });
    await syncPrimaryHouse(oid(req), coordinates);
    await audit(req, 'update_location', 'User', oid(req), { latitude, longitude });
    res.json({ message: 'Location updated.' });
  } catch (err) { next(err); }
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export const getReports = async (req, res, next) => {
  try {
    const type = req.query.type || 'payments';
    const id = oid(req);

    if (type === 'payments') {
      const data = await OwnerPayment.findAll({ where: { ownerId: id }, order: [['dueDate', 'DESC']] });
      return res.json({ type, data });
    }
    if (type === 'tenants') {
      const data = await OwnerTenant.findAll({ where: { ownerId: id } });
      return res.json({ type, data });
    }
    if (type === 'rooms') {
      const data = await OwnerRoom.findAll({ where: { ownerId: id } });
      return res.json({ type, data });
    }
    if (type === 'income') {
      const today = new Date();
      const payments = await OwnerPayment.findAll({ where: { ownerId: id, status: 'paid' } });
      const byMonth = {};
      payments.forEach(p => {
        const key = p.month || 'Unknown';
        byMonth[key] = (byMonth[key] || 0) + Number(p.amount);
      });
      return res.json({ type, data: Object.entries(byMonth).map(([month, total]) => ({ month, total })) });
    }

    res.status(400).json({ error: 'Invalid report type.' });
  } catch (err) { next(err); }
};

// ─── Activity Logs ────────────────────────────────────────────────────────────

export const getActivityLogs = async (req, res, next) => {
  try {
    const data = await OwnerActivityLog.findAll({ where: { ownerId: oid(req) }, order: [['createdAt', 'DESC']], limit: 100 });
    res.json({ data });
  } catch (err) { next(err); }
};

// ─── Business Permit ─────────────────────────────────────────────────────────

export const getPermit = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    let permit = await BusinessPermit.findOne({ where: { ownerId }, order: [['createdAt', 'DESC']] });
    const pendingRenewal = await BploPermitRenewal.findOne({
      where: {
        ownerId,
        status: { [Op.in]: ['pending_barangay', 'barangay_approved', 'forwarded_to_bplo'] }
      },
      order: [['createdAt', 'DESC']]
    });

    if (permit) {
      const today = new Date();
      const expiry = new Date(permit.expirationDate);
      const daysLeft = Math.ceil((expiry - today) / 86400000);
      const status = pendingRenewal ? 'renewal_requested' : permit.status;
      return res.json({
        data: {
          ...permit.get({ plain: true }),
          status,
          daysLeft,
          pendingRenewal: pendingRenewal ? pendingRenewal.get({ plain: true }) : null
        }
      });
    } else if (pendingRenewal) {
      return res.json({
        data: {
          id: 0,
          ownerId,
          permitNumber: pendingRenewal.permitNumber || 'BP-PENDING',
          issueDate: null,
          expirationDate: pendingRenewal.requestedRenewalDate || null,
          status: 'renewal_requested',
          notes: pendingRenewal.barangayNotes || 'Permit renewal request submitted to BPLO.',
          daysLeft: null,
          pendingRenewal: pendingRenewal.get({ plain: true }),
        }
      });
    }

    res.json({ data: null });
  } catch (err) { next(err); }
};

export const requestPermitRenewal = async (req, res, next) => {
  try {
    const id = oid(req);
    const owner = await User.findByPk(id, { attributes: ['fullName', 'barangay', 'boardingHouseName'] });
    if (!owner) return res.status(404).json({ error: 'Owner not found.' });

    const { requestedRenewalDate, notes, permitNumber } = req.body;

    const existingPending = await BploPermitRenewal.findOne({
      where: {
        ownerId: id,
        status: { [Op.in]: ['pending_barangay', 'barangay_approved', 'forwarded_to_bplo'] }
      }
    });

    if (existingPending) {
      return res.status(409).json({ error: 'A permit renewal request is already pending review with BPLO.' });
    }

    let permit = await BusinessPermit.findOne({ where: { ownerId: id }, order: [['createdAt', 'DESC']] });

    const pNo = permitNumber || permit?.permitNumber || `BP-2026-${String(id).padStart(3, '0')}`;

    if (!permit) {
      permit = await BusinessPermit.create({
        ownerId: id,
        permitNumber: pNo,
        issueDate: null,
        expirationDate: requestedRenewalDate || new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        status: 'renewal_requested',
        notes: notes || 'Business permit renewal submitted by owner',
      });
    } else {
      await permit.update({ status: 'renewal_requested' });
    }

    // Create renewal record forwarded directly to BPLO so it appears under Permit Renewal Requests
    const renewal = await BploPermitRenewal.create({
      ownerId: id,
      barangay: owner.barangay || 'Bongabong',
      permitNumber: pNo,
      currentExpirationDate: permit.expirationDate,
      requestedRenewalDate: requestedRenewalDate || null,
      status: 'forwarded_to_bplo',
      barangayNotes: notes || null,
      bploNotes: 'Submitted via Owner Portal',
    });

    // Notify the owner
    await OwnerNotification.create({
      ownerId: id,
      title: 'Permit Renewal Request Submitted',
      body: `Your permit renewal request (${pNo}) has been submitted to BPLO Bongabong for processing.`,
      type: 'permit',
    });

    await audit(req, 'request_permit_renewal', 'BploPermitRenewal', renewal.id, { permitNumber: pNo });
    res.json({ message: 'Business permit renewal request submitted to BPLO successfully.' });
  } catch (err) { next(err); }
};

// ─── Announcements (from Barangay) ────────────────────────────────────────────

export const getAnnouncements = async (req, res, next) => {
  try {
    const owner = await User.findByPk(oid(req), { attributes: ['barangay'] });
    const data = await Announcement.findAll({
      where: {
        isPublished: true,
        [Op.or]: [
          { audience: 'all' },
          { audience: `owners:${owner?.barangay}` },
        ],
      },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    res.json({ data });
  } catch (err) { next(err); }
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req), {
      attributes: ['id', 'boardingHouseName', 'email', 'contactNumber', 'gcashNumber', 'gcashName', 'gcashQrCode']
    });
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('getSettings error:', err);
    next(err);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    const allowed = ['gcashNumber', 'gcashName', 'gcashQrCode', 'contactNumber'];
    const updates = {};
    allowed.forEach(k => {
      if (req.body[k] !== undefined && typeof req.body[k] === 'string') {
        updates[k] = req.body[k].trim();
      }
    });

    await User.update(updates, { where: { id: oid(req) } });
    await audit(req, 'update_gcash_settings', 'User', oid(req), updates);
    res.json({ success: true, message: 'GCash settings saved successfully.' });
  } catch (err) {
    console.error('updateSettings error:', err);
    res.status(500).json({ error: err.message || 'Failed to save settings.' });
  }
};

// ─── My Profile (Personal Info + Profile Photo) ────────────────────────────────

export const updateMyProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const updates = {};
    if (req.body.fullName) updates.fullName = req.body.fullName;
    if (req.body.contactNumber) updates.contactNumber = req.body.contactNumber;
    if (req.body.gcashNumber !== undefined) updates.gcashNumber = req.body.gcashNumber;
    if (req.body.gcashName !== undefined) updates.gcashName = req.body.gcashName;
    for (const field of ['rentPerRoom', 'rentPerHead']) if (req.body[field] !== undefined) updates[field] = validatedRate(req.body[field], field === 'rentPerRoom' ? 'room' : 'head');

    const profilePic = req.files?.['profilePicture']?.[0];
    if (profilePic) updates.profilePicture = `/uploads/${profilePic.filename}`;

    await sequelize.transaction(async transaction => {
      const account = await ownerLock(user.id, transaction);
      const uploads = Object.entries(PAYMENT_QR_FIELDS).map(([method, field]) =>
        ({ method, field, file: req.files?.[field]?.[0] }));
      if (req.body.configureRentPayments === 'on') {
        const available = Object.fromEntries(uploads.map(({ method, file }) =>
          [method, Boolean(file || ownerPaymentQr(account, method))]));
        updates.paymentMethods = JSON.stringify(validatePaymentMethods(req.body.paymentMethods, available));
      }
      for (const { field, file } of uploads) {
        if (file) updates[field] = await storeReviewFile(file, account.id, 'payment-qr', transaction);
      }
      await user.update(updates, { transaction });
    });
    await syncPrimaryHouse(user.id, updates);
    await audit(req, 'update_my_profile', 'User', user.id, { fields: Object.keys(updates) });
    const { password, verificationToken, resetPasswordToken, ...profile } = user.toJSON();
    res.json({ message: 'Profile and payment settings saved.', data: profile });
  } catch (err) { next(err); }
};

// ─── My Documents (Re-upload any of the 6 required docs) ──────────────────────

export const updateMyDocuments = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const docFields = [
      'validIdPicture', 'businessPermit', 'barangayClearance',
      'proofOfOwnership', 'rentalPermit', 'boardingHousePicture',
    ];

    const updates = {};
    for (const field of docFields) {
      const file = req.files?.[field]?.[0];
      if (!file) continue;
      updates[field] = field === 'boardingHousePicture'
        ? await storePropertyPhoto(file, user.id)
        : await storeReviewFile(file, user.id, 'owner-registration');
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    await user.update(updates);
    await syncPrimaryHouse(user.id, updates);
    await audit(req, 'update_documents', 'User', user.id, { updatedDocs: Object.keys(updates) });
    res.json({ message: 'Documents updated successfully.', updated: Object.keys(updates) });
  } catch (err) { next(err); }
};

// ─── Pending Tenant Applications (Two-Way Confirmation Workflow) ─────────────

export const getPendingApplications = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const archived = req.query.archived === 'true';
    const owner = await User.findByPk(ownerId, { attributes: ['boardingHouseName'] });
    const branchId = selectedBranch(req.query.boardingHouseId);
    const branch = branchId && await BoardingHouse.findOne({ where: { id: branchId, ownerId }, attributes: ['id', 'isPrimary'] });
    if (branchId && !branch) return res.json({ data: [] });

    let applications = await TenantApplication.findAll({
      where: { ownerId, ...(archived ? { status: 'archived_by_owner' } : {}) },
      order: [['createdAt', 'DESC']]
    });

    // Legacy registrations saved a house name without an application ID.
    const legacyHouseIsUnique = !archived && (!branch || branch.isPrimary) && owner?.boardingHouseName && await User.count({
      where: { accountType: 'boarding_house_owner', isArchived: false, boardingHouseName: owner.boardingHouseName }
    }) === 1;
    if (legacyHouseIsUnique) {
      const pendingTenantUsers = await User.findAll({
        where: {
          accountType: 'tenant',
          selectedBoardingHouse: owner.boardingHouseName,
        },
        attributes: ['id', 'fullName', 'email', 'contactNumber', 'profilePicture', 'selectedBoardingHouse', 'applicationStatus', 'emailVerified', 'createdAt'],
      });

      for (const u of pendingTenantUsers) {
        const hasApp = applications.some(a => a.tenantId === u.id);
        if (!hasApp) {
          // Synthesize an application in DB
          try {
            const { application, created } = await createTenantApplication({
              tenantId: u.id,
              ownerId: ownerId,
              boardingHouseName: owner.boardingHouseName,
              status: await OwnerTenant.count({ where: { ownerId, tenantUserId: u.id, status: 'active' } })
                ? 'confirmed' : 'pending_owner',
              message: 'Registered with selected boarding house'
            }, { legacy: true });
            if (created) applications.unshift(application);
          } catch (e) {}
        }
      }
    }

    if (!archived) applications = (await closeDuplicatePendingApplications(applications)).filter(app => ['pending_owner', 'accepted_by_owner'].includes(app.status));

    if (branch) applications = applications.filter(app =>
      app.boardingHouseId === branch.id || (!app.boardingHouseId && branch.isPrimary)
    );

    // Attach tenant user information & room details to each application
    const enriched = await Promise.all(applications.map(async (app) => {
      const tenantUser = await User.findByPk(app.tenantId, {
        attributes: ['id', 'fullName', 'email', 'contactNumber', 'profilePicture', 'gender', 'validIdPicture', 'selectedBoardingHouse', 'createdAt']
      });
      let room = null;
      if (app.roomId) {
        room = await OwnerRoom.findByPk(app.roomId, {
          attributes: ['id', 'roomNumber', 'roomType', 'rentalPrice']
        });
      }
      return {
        id: app.id,
        applicationId: app.id,
        userId: app.tenantId,
        fullName: tenantUser ? tenantUser.fullName : 'Tenant User',
        email: tenantUser ? tenantUser.email : '',
        contactNumber: tenantUser ? tenantUser.contactNumber : '',
        gender: tenantUser ? tenantUser.gender : '',
        profilePicture: tenantUser ? tenantUser.profilePicture : '',
        validIdPicture: !archived ? tenantUser?.validIdPicture || '' : '',
        boardingHouseId: app.boardingHouseId,
        boardingHouseName: app.boardingHouseName,
        occupantCount: app.occupantCount,
        requestedRoomType: app.requestedRoomType || 'Any',
        preferredRoomLabel: app.preferredRoomLabel,
        message: app.message,
        status: app.status,
        roomId: app.roomId,
        monthlyRent: app.monthlyRent,
        moveInDate: app.moveInDate,
        ownerNotes: app.ownerNotes,
        acceptedAt: app.acceptedAt,
        reservation: app.reservationRoomId ? {
          status: reservationStatus(app), roomId: app.reservationRoomId, fee: app.reservationFee, monthlyRent: app.reservationRent,
          method: app.reservationMethod, reference: app.reservationReference,
        } : null,
        confirmedAt: app.confirmedAt,
        createdAt: app.createdAt,
        room
      };
    }));

    res.json({ data: enriched });
  } catch (err) { next(err); }
};

export const bulkOfferApplications = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    res.json(await runOwnerBatch(req.body?.offers, offer => offer?.applicationId, async (id, offer) => {
      const app = await TenantApplication.findOne({ where: { id, ownerId }, attributes: ['tenantId'] });
      if (!app) fail('Application not found.', 404);
      const saved = await offerApplication(ownerId, app.tenantId, { ...offer, applicationId: id }, { bulk: true });
      await audit(req, 'offer_application', 'TenantApplication', id, { roomId: saved.roomId });
    }));
  } catch (error) { next(error); }
};

export const approveApplicationReservation = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const app = await TenantApplication.findOne({ where: { id: req.params.id, ownerId } });
    if (!app?.reservationRoomId) fail('Reservation request not found.', 404);
    if (req.body?.paymentChecked !== true) fail('Confirm that you received the reservation fee.');
    const data = await offerApplication(ownerId, app.tenantId, { applicationId: app.id, moveInDate: req.body.moveInDate }, { approveReservation: true });
    await audit(req, 'approve_reservation', 'TenantApplication', app.id, { roomId: data.roomId });
    res.json({ data, message: 'Reservation approved. The room or slot is held until the tenant accepts or the reservation is closed.' });
  } catch (error) { next(error); }
};

export const archiveApplications = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    res.json(await runOwnerBatch(req.body?.ids, id => id, async id => {
      const initial = await TenantApplication.findOne({ where: { id, ownerId }, attributes: ['tenantId'] });
      if (!initial) fail('Application not found.', 404);
      const changed = await sequelize.transaction(async transaction => {
        await User.findByPk(initial.tenantId, { transaction, lock: transaction.LOCK.UPDATE });
        await ownerLock(ownerId, transaction);
        const app = await TenantApplication.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
        if (!app) fail('Application not found.', 404);
        if (app.status === 'archived_by_owner') return false;
        if (!['pending_owner', 'accepted_by_owner'].includes(app.status)) fail('Only open applications and offers can be archived here.', 409);
        const held = app.status === 'accepted_by_owner' && app.reservationRoomId;
        await app.update({ status: 'archived_by_owner' }, { transaction });
        if (held) await syncOccupancy(ownerId, [held], transaction);
        await BarangayNotification.create({ userId: app.tenantId, title: 'Rental application closed',
          body: `The owner closed your application for ${app.boardingHouseName}. You can still browse and apply for another boarding house.`,
          type: 'application_archived' }, { transaction });
        return true;
      });
      if (changed) await audit(req, 'archive_application', 'TenantApplication', id);
    }));
  } catch (error) { next(error); }
};

export const acceptTenantApplication = async (req, res, next) => {
  try {
    const data = await offerApplication(oid(req), req.params.userId, req.body);
    res.json({ success: true, data, message: 'Offer sent. The tenant must confirm; vacancy is checked again at confirmation.' });
  } catch (error) {
    if (error.code === 'ACTIVE_TENANCY') {
      await BarangayNotification.create({
        userId: req.params.userId, title: 'Move-out needed before a new offer',
        body: 'An owner tried to send you a room offer. Ask your current owner to record move-out before accepting a new tenancy.',
        type: 'application_active_tenancy'
      }).catch(() => {});
    }
    next(error);
  }
};

export const declineTenantApplication = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const ownerId = oid(req);

    const tenantUser = await User.findOne({ where: { id: userId, accountType: 'tenant' } });
    if (!tenantUser) return res.status(404).json({ error: 'Tenant user not found.' });

    const { owner, houseName } = await sequelize.transaction(async transaction => {
      await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      const owner = await ownerLock(ownerId, transaction);
      const app = await TenantApplication.findOne({
        where: {
          tenantId: userId, ownerId,
          ...(req.query.applicationId ? { id: req.query.applicationId } : {}),
          status: { [Op.in]: ['pending_owner', 'accepted_by_owner'] }
        },
        order: [['createdAt', 'DESC']],
        transaction, lock: transaction.LOCK.UPDATE
      });
      if (!app) fail('This application is no longer pending or offered.', 409);
      const held = app.status === 'accepted_by_owner' && app.reservationRoomId;
      await app.update({ status: 'declined_by_owner' }, { transaction });
      if (held) await syncOccupancy(ownerId, [held], transaction);
      return { owner, houseName: app.boardingHouseName };
    });

    // Send notification to tenant
    await BarangayNotification.create({
      userId: tenantUser.id,
      title: 'Boarding House Application Update',
      body: `${houseName || owner.boardingHouseName || owner.fullName || 'The landlord'} was unable to accept your application at this time. You may browse and apply to other boarding houses on DormMap.`,
      type: 'application_declined',
      isRead: false,
    }).catch(() => {});

    await OwnerNotification.create({
      ownerId,
      title: 'Tenant Application Declined',
      body: `You have declined ${tenantUser.fullName}'s rental application.`,
      type: 'tenant_declined',
    }).catch(() => {});

    res.json({ success: true, message: 'Tenant application declined.' });
  } catch (err) { next(err); }
};


export const getMaintenance = async (req,res,next) => {
  try {
    const rows=await MaintenanceRequest.findAll({where:{ownerId:oid(req)},order:[['createdAt','DESC']]});
    const users=rows.length?await User.findAll({where:{id:{[Op.in]:rows.map(row=>row.tenantId)}},attributes:['id','fullName']}):[];
    res.json({data:rows.map(row=>({...row.toJSON(),tenantName:users.find(user=>user.id===row.tenantId)?.fullName||'Former tenant'}))});
  }catch(error){next(error);}
};
export const updateMaintenance = async (req,res,next) => {
  try {
    const row=await MaintenanceRequest.findOne({where:{id:req.params.id,ownerId:oid(req)}});
    if(!row)return res.status(404).json({error:'Maintenance request not found.'});
    if(!['in_progress','resolved','rejected'].includes(req.body.status))return res.status(422).json({error:'Select a valid maintenance status.'});
    const ownerResponse=String(req.body.ownerResponse||'').trim().slice(0,2000);
    if(!ownerResponse)return res.status(422).json({error:'Enter a response so the tenant understands this update.'});
    await row.update({status:req.body.status,ownerResponse,resolvedAt:req.body.status==='resolved'?new Date():null});
    await audit(req,'update_maintenance','MaintenanceRequest',row.id,{status:row.status});res.json({message:'Maintenance request updated.'});
  }catch(error){next(error);}
};
