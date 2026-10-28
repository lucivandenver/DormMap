import { Op, fn, col, literal } from 'sequelize';
import { User } from '../models/userModel.js';
import { BusinessPermit, AdminAuditLog, Announcement, BarangayNotification, BploPermitRenewal } from '../models/adminModels.js';
import {
  BoardingHouse, OwnerRoom, OwnerTenant, OwnerPayment, OwnerInquiry,
  OwnerMessage, OwnerNotification, OwnerActivityLog, OwnerGallery,
} from '../models/ownerModels.js';
import { TenantApplication } from '../models/tenantModels.js';
import { sequelize } from '../models/db.js';

const oid = (req) => req.session.userId;
const audit = (req, action, entityType, entityId, details = {}) =>
  OwnerActivityLog.create({ ownerId: oid(req), action, entityType, entityId, details, ipAddress: req.ip }).catch(() => {});

// ─── Page ────────────────────────────────────────────────────────────────────

export const ownerDashboardPage = (req, res) =>
  res.render('ownerDashboard', { title: 'DormMap | Owner Dashboard', userName: req.session.userName, pendingStatus: null });

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
    const availableRooms = rooms.filter(r => r.status === 'available').length;
    const occupiedRooms  = rooms.filter(r => r.status === 'occupied').length;
    const monthlyIncome  = payments.filter(p => p.status === 'paid' && p.month === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`).reduce((s, p) => s + Number(p.amount), 0);
    const pendingPayments = payments.filter(p => p.status === 'pending').length;
    const overduePayments = payments.filter(p => p.status === 'pending' && new Date(p.dueDate) < today).length;
    const permitDaysLeft = permit?.expirationDate ? Math.ceil((new Date(permit.expirationDate) - today) / 86400000) : null;

    // Count pending tenant applications (tenants who selected this BH but not yet accepted)
    let pendingApplications = 0;
    if (owner?.boardingHouseName) {
      const pendingTenantUsers = await User.findAll({
        where: { accountType: 'tenant', selectedBoardingHouse: { [Op.like]: owner.boardingHouseName } },
        attributes: ['id', 'email', 'fullName'],
      });
      const existingTenants = await OwnerTenant.findAll({ where: { ownerId: id }, attributes: ['email', 'fullName'] });
      const regEmails = new Set(existingTenants.map(t => (t.email || '').toLowerCase()).filter(Boolean));
      const regNames  = new Set(existingTenants.map(t => (t.fullName || '').toLowerCase()).filter(Boolean));
      pendingApplications = pendingTenantUsers.filter(u => {
        const em = u.email && regEmails.has(u.email.toLowerCase());
        const nm = u.fullName && regNames.has(u.fullName.toLowerCase());
        return !em && !nm;
      }).length;
    }


    // 6-month payment trend
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleString('default', { month: 'short' });
      const income = payments.filter(p => p.month === key && p.status === 'paid').reduce((s,p) => s + Number(p.amount), 0);
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

export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req), { attributes: { exclude: ['password', 'verificationToken'] } });
    if (!user) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ data: user });
  } catch (err) { next(err); }
};

export const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(oid(req));
    if (!user) return res.status(404).json({ error: 'Profile not found.' });
    const allowed = [
      'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'description',
      'operatingHours', 'rentalPriceMin', 'rentalPriceMax', 'amenities', 'houseRules',
      'boardingHouseLatitude', 'boardingHouseLongitude', 'mapPin', 'gcashNumber', 'gcashName', 'gcashQrCode'
    ];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    // Sync barangay for filtering
    if (updates.boardingHouseAddress) updates.barangay = updates.boardingHouseAddress;
    await user.update(updates);
    await audit(req, 'update_profile', 'User', user.id, updates);
    res.json({ data: user.get({ plain: true }), message: 'Profile updated.' });
  } catch (err) { next(err); }
};

// ─── Boarding Houses (Multiple Establishments per Owner) ────────────────────

export const getBoardingHouses = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    let houses = await BoardingHouse.findAll({ where: { ownerId }, order: [['isPrimary', 'DESC'], ['id', 'ASC']] });

    // Auto-seed primary boarding house from User profile if none exist
    if (!houses || houses.length === 0) {
      const user = await User.findByPk(ownerId);
      if (user) {
        const primaryHouse = await BoardingHouse.create({
          ownerId,
          name: user.boardingHouseName || `${user.fullName}'s Boarding House`,
          address: user.boardingHouseAddress || user.barangay || 'Bongabong',
          barangay: user.barangay || '',
          latitude: user.boardingHouseLatitude || '12.7192',
          longitude: user.boardingHouseLongitude || '121.4719',
          mapPin: user.mapPin || 'Lat 12.7192, Lon 121.4719',
          picture: user.boardingHousePicture || '',
          description: user.description || '',
          amenities: user.amenities || '',
          houseRules: user.houseRules || '',
          isPrimary: true
        });

        // Link existing rooms to primary house
        await OwnerRoom.update({ boardingHouseId: primaryHouse.id }, { where: { ownerId, boardingHouseId: null } });
        houses = [primaryHouse];
      }
    } else {
      // Ensure any orphaned room is linked to the primary house
      const primaryHouse = houses.find(h => h.isPrimary) || houses[0];
      if (primaryHouse) {
        await OwnerRoom.update({ boardingHouseId: primaryHouse.id }, { where: { ownerId, boardingHouseId: null } });
      }
    }

    res.json({ data: houses });
  } catch (err) { next(err); }
};

export const createBoardingHouse = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const { name, address, barangay, latitude, longitude, mapPin, picture, description, amenities, houseRules } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Boarding House name is required.' });
    }
    const house = await BoardingHouse.create({
      ownerId,
      name,
      address: address || '',
      barangay: barangay || address || '',
      latitude: latitude || '12.7192',
      longitude: longitude || '121.4719',
      mapPin: mapPin || `Lat ${latitude || '12.7192'}, Lon ${longitude || '121.4719'}`,
      picture: picture || '',
      description: description || '',
      amenities: amenities || '',
      houseRules: houseRules || '',
      isPrimary: false
    });
    await audit(req, 'create_boarding_house', 'BoardingHouse', house.id, { name: house.name });
    res.status(201).json({ data: house, message: 'Boarding House added successfully.' });
  } catch (err) { next(err); }
};

export const updateBoardingHouse = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const house = await BoardingHouse.findOne({ where: { id: req.params.id, ownerId } });
    if (!house) return res.status(404).json({ error: 'Boarding house not found.' });
    const { id: _id, ownerId: _ownerId, ...safeBody } = req.body;
    await house.update(safeBody);
    await audit(req, 'update_boarding_house', 'BoardingHouse', house.id, safeBody);
    res.json({ data: house, message: 'Boarding house updated.' });
  } catch (err) { next(err); }
};

export const deleteBoardingHouse = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const house = await BoardingHouse.findOne({ where: { id: req.params.id, ownerId } });
    if (!house) return res.status(404).json({ error: 'Boarding house not found.' });
    if (house.isPrimary) {
      return res.status(400).json({ error: 'Cannot delete the main primary boarding house.' });
    }
    await house.destroy();
    await audit(req, 'delete_boarding_house', 'BoardingHouse', req.params.id, {});
    res.json({ message: 'Boarding house deleted.' });
  } catch (err) { next(err); }
};

// ─── Rooms ────────────────────────────────────────────────────────────────────

export const getRooms = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.boardingHouseId) where.boardingHouseId = Number(req.query.boardingHouseId);
    const data = await OwnerRoom.findAll({ where, order: [['roomNumber', 'ASC']] });
    res.json({ data });
  } catch (err) { next(err); }
};

export const createRoom = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    // Whitelist only known OwnerRoom fields; never pass `id` or unknown keys
    const { id: _id, roomNumber, roomType, floor, capacity, availableSlots, rentalPrice,
            dimensions, genderPref, furnished, aircon, status, amenities, photos,
            description, boardingHouseId } = req.body;

    if (!roomNumber || !rentalPrice || !capacity) {
      return res.status(400).json({ error: 'Room Number, Rental Price, and Capacity are required.' });
    }

    let bhId = boardingHouseId ? Number(boardingHouseId) : null;
    if (!bhId) {
      const primaryBh = await BoardingHouse.findOne({ where: { ownerId, isPrimary: true } });
      if (primaryBh) bhId = primaryBh.id;
    }

    const data = await OwnerRoom.create({
      ownerId,
      boardingHouseId: bhId,
      roomNumber,
      roomType: roomType || 'Solo Room',
      floor: floor || '1st Floor',
      capacity: Number(capacity),
      availableSlots: availableSlots !== undefined ? Number(availableSlots) : Number(capacity),
      rentalPrice: Number(rentalPrice),
      dimensions: dimensions || null,
      genderPref: genderPref || 'Any',
      furnished: furnished === 'true' || furnished === true,
      aircon: aircon === 'true' || aircon === true,
      status: status || 'available',
      amenities: amenities || null,
      photos: photos || null,
      description: description || null,
    });

    await audit(req, 'create_room', 'OwnerRoom', data.id, { roomNumber: data.roomNumber });
    const avail = await OwnerRoom.count({ where: { ownerId, status: 'available' } });
    await User.update({ roomsAvailable: avail }, { where: { id: ownerId } });
    res.status(201).json({ data, message: 'Room created.' });
  } catch (err) { next(err); }
};


export const updateRoom = async (req, res, next) => {
  try {
    const room = await OwnerRoom.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    // Strip id and unknown keys from update payload
    const { id: _id, ownerId: _ownerId, ...safeBody } = req.body;
    // Coerce numeric fields
    if (safeBody.capacity)       safeBody.capacity       = Number(safeBody.capacity);
    if (safeBody.availableSlots) safeBody.availableSlots = Number(safeBody.availableSlots);
    if (safeBody.rentalPrice)    safeBody.rentalPrice    = Number(safeBody.rentalPrice);
    await room.update(safeBody);
    const avail = await OwnerRoom.count({ where: { ownerId: oid(req), status: 'available' } });
    await User.update({ roomsAvailable: avail }, { where: { id: oid(req) } });
    await audit(req, 'update_room', 'OwnerRoom', room.id, safeBody);
    res.json({ data: room, message: 'Room updated.' });
  } catch (err) { next(err); }
};

export const deleteRoom = async (req, res, next) => {
  try {
    const room = await OwnerRoom.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    await room.destroy();
    await audit(req, 'delete_room', 'OwnerRoom', req.params.id, {});
    res.json({ message: 'Room deleted.' });
  } catch (err) { next(err); }
};

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const getTenants = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where[Op.or] = ['fullName', 'email', 'contactNumber'].map(f => ({ [f]: { [Op.like]: `%${req.query.search}%` } }));
    }
    const data = await OwnerTenant.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ data });
  } catch (err) { next(err); }
};

export const createTenant = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const data = await OwnerTenant.create({ ...req.body, ownerId });
    if (data.roomId) {
      await OwnerRoom.update({ status: 'occupied' }, { where: { id: data.roomId, ownerId } });
    }

    // Check if there is a matching tenant User account to approve & unlock dashboard
    if (data.email || data.fullName) {
      const matchCriteria = [];
      if (data.email) matchCriteria.push({ email: data.email });
      if (data.contactNumber) matchCriteria.push({ contactNumber: data.contactNumber });
      if (data.fullName) matchCriteria.push({ fullName: data.fullName });

      const tenantUser = await User.findOne({
        where: {
          accountType: 'tenant',
          [Op.or]: matchCriteria
        }
      });

      if (tenantUser) {
        const ownerUser = await User.findByPk(ownerId, { attributes: ['boardingHouseName'] });
        tenantUser.applicationStatus = 'approved';
        if (ownerUser?.boardingHouseName) {
          tenantUser.selectedBoardingHouse = ownerUser.boardingHouseName;
        }
        await tenantUser.save();

        await TenantApplication.findOrCreate({
          where: { tenantId: tenantUser.id, ownerId },
          defaults: {
            boardingHouseName: ownerUser?.boardingHouseName || 'Boarding House',
            status: 'confirmed',
            roomId: data.roomId || null,
            monthlyRent: data.monthlyRent || 0,
            moveInDate: data.moveInDate || new Date(),
            confirmedAt: new Date()
          }
        }).then(async ([appRec, created]) => {
          if (!created && appRec.status !== 'confirmed') {
            appRec.status = 'confirmed';
            appRec.confirmedAt = new Date();
            if (data.roomId) appRec.roomId = data.roomId;
            if (data.monthlyRent) appRec.monthlyRent = data.monthlyRent;
            await appRec.save();
          }
        }).catch(() => {});

        const { BarangayNotification } = await import('../models/adminModels.js');
        await BarangayNotification.create({
          userId: tenantUser.id,
          title: '🎉 Rental Application Accepted!',
          body: `Congratulations! Your rental application for ${ownerUser?.boardingHouseName || 'the boarding house'} has been accepted by the owner. Your full tenant portal features are now unlocked!`,
          type: 'application_approved',
          isRead: false
        }).catch(() => {});
      }
    }

    await audit(req, 'create_tenant', 'OwnerTenant', data.id, { fullName: data.fullName });
    res.status(201).json({ data, message: 'Tenant registered & account activated.' });
  } catch (err) { next(err); }
};

export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await OwnerTenant.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
    await tenant.update(req.body);
    if (req.body.status === 'moved_out' && tenant.roomId) {
      await OwnerRoom.update({ status: 'available' }, { where: { id: tenant.roomId, ownerId: oid(req) } });
    }
    await audit(req, 'update_tenant', 'OwnerTenant', tenant.id, req.body);
    res.json({ data: tenant, message: 'Tenant updated.' });
  } catch (err) { next(err); }
};

export const deleteTenant = async (req, res, next) => {
  try {
    const tenant = await OwnerTenant.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
    await tenant.destroy();
    await audit(req, 'delete_tenant', 'OwnerTenant', req.params.id, {});
    res.json({ message: 'Tenant removed.' });
  } catch (err) { next(err); }
};

// ─── Payments ─────────────────────────────────────────────────────────────────

export const getPayments = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.tenantId) where.tenantId = req.query.tenantId;
    const payments = await OwnerPayment.findAll({ where, order: [['dueDate', 'DESC']] });
    
    const tenants = await OwnerTenant.findAll({ where: { ownerId: oid(req) }, attributes: ['id', 'fullName'] });
    const tenantMap = {};
    tenants.forEach(t => { tenantMap[t.id] = t.fullName; });

    const data = payments.map(p => {
      const plain = p.toJSON();
      plain.tenantName = tenantMap[p.tenantId] || `Tenant #${p.tenantId}`;
      return plain;
    });

    res.json({ data });
  } catch (err) { next(err); }
};

export const createPayment = async (req, res, next) => {
  try {
    const data = await OwnerPayment.create({ ...req.body, ownerId: oid(req) });
    await audit(req, 'create_payment', 'OwnerPayment', data.id, { amount: data.amount });
    res.status(201).json({ data, message: 'Payment record created.' });
  } catch (err) { next(err); }
};

export const markPaid = async (req, res, next) => {
  try {
    const payment = await OwnerPayment.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!payment) return res.status(404).json({ error: 'Payment record not found.' });
    await payment.update({ status: 'paid', paidDate: new Date(), method: req.body.method || 'Cash', reference: req.body.reference || null });
    // Update tenant balance
    await OwnerTenant.decrement('balance', { by: Number(payment.amount), where: { id: payment.tenantId } });
    await audit(req, 'mark_paid', 'OwnerPayment', payment.id, { amount: payment.amount });
    res.json({ data: payment, message: 'Payment marked as paid.' });
  } catch (err) { next(err); }
};

export const deletePayment = async (req, res, next) => {
  try {
    const payment = await OwnerPayment.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    await payment.destroy();
    res.json({ message: 'Payment deleted.' });
  } catch (err) { next(err); }
};

// ─── Inquiries ────────────────────────────────────────────────────────────────

export const getInquiries = async (req, res, next) => {
  try {
    const where = { ownerId: oid(req), isArchived: false };
    if (req.query.status) where.status = req.query.status;
    const data = await OwnerInquiry.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ data });
  } catch (err) { next(err); }
};

export const replyInquiry = async (req, res, next) => {
  try {
    const inq = await OwnerInquiry.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!inq) return res.status(404).json({ error: 'Inquiry not found.' });
    await inq.update({ reply: req.body.reply, status: 'replied', visitDate: req.body.visitDate || null });
    await audit(req, 'reply_inquiry', 'OwnerInquiry', inq.id, {});
    res.json({ data: inq, message: 'Reply sent.' });
  } catch (err) { next(err); }
};

export const archiveInquiry = async (req, res, next) => {
  try {
    const inq = await OwnerInquiry.findOne({ where: { id: req.params.id, ownerId: oid(req) } });
    if (!inq) return res.status(404).json({ error: 'Inquiry not found.' });
    await inq.update({ isArchived: true, status: 'completed' });
    res.json({ message: 'Inquiry archived.' });
  } catch (err) { next(err); }
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
    const data = await OwnerMessage.findAll({
      where: { [Op.or]: [{ senderId: id }, { recipientId: id }] },
      order: [['createdAt', 'DESC']],
    });
    await OwnerMessage.update({ isRead: true }, { where: { recipientId: id, isRead: false } });
    res.json({ data });
  } catch (err) { next(err); }
};

export const sendMessage = async (req, res, next) => {
  try {
    const data = await OwnerMessage.create({ ...req.body, senderId: oid(req), ownerId: oid(req) });
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

export const GALLERY_CATEGORIES = [
  { index: 1, key: 'outdoor', label: 'Outdoor Spaces', description: 'Front view, gate, compound exterior' },
  { index: 2, key: 'living_area', label: 'Living Area', description: 'Common room, sala, lounge area' },
  { index: 3, key: 'bedroom', label: 'Bedroom', description: 'Typical room offered to tenants' },
  { index: 4, key: 'dining', label: 'Dining or kitchenette', description: 'Kitchen, dining area, cooking space' },
  { index: 5, key: 'bathroom', label: 'Bathroom', description: 'CR, comfort room, shower area' },
];

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

    // Build OwnerGallery query — filter by boardingHouseId
    let dbGallery = [];
    if (boardingHouseId) {
      dbGallery = await OwnerGallery.findAll({
        where: { ownerId, boardingHouseId },
        order: [['sortOrder', 'ASC']]
      });

      // Fallback: if this is the first/primary house and has no photos under its ID yet,
      // check if there are legacy photos (boardingHouseId: null)
      if (dbGallery.length === 0 && boardingHouses.length > 0 && boardingHouses[0].id === boardingHouseId) {
        const legacyGallery = await OwnerGallery.findAll({
          where: { ownerId, boardingHouseId: null },
          order: [['sortOrder', 'ASC']]
        });
        if (legacyGallery.length > 0) {
          dbGallery = legacyGallery;
        }
      }
    } else {
      dbGallery = await OwnerGallery.findAll({
        where: { ownerId, boardingHouseId: null },
        order: [['sortOrder', 'ASC']]
      });
    }

    // Fallback: if no BH-specific photos, use legacy galleryImages from User (for primary house)
    let savedImages = [];
    const isFirstOrPrimary = boardingHouses.length > 0 && boardingHouses[0].id === boardingHouseId;
    if ((!boardingHouseId || isFirstOrPrimary) && owner?.galleryImages) {
      try {
        const parsed = JSON.parse(owner.galleryImages);
        if (Array.isArray(parsed)) savedImages = parsed;
      } catch (e) { savedImages = []; }
    }

    const selectedBh = boardingHouses.find(b => b.id === boardingHouseId) || boardingHouses[0] || null;

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
        imageUrl = selectedBh?.picture || owner?.boardingHousePicture || null;
      }
      return { ...cat, imageUrl, isMainListing: cat.index === 1 };
    });

    res.json({
      success: true,
      slots,
      boardingHouses: boardingHouses.map(bh => (typeof bh.get === 'function' ? bh.get({ plain: true }) : bh)),
      selectedBoardingHouseId: boardingHouseId,
      boardingHousePicture: selectedBh?.picture || owner?.boardingHousePicture || slots[0]?.imageUrl || null,
      data: dbGallery
    });
  } catch (err) { next(err); }
};

export const updateGallerySlot = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const slotIndex = parseInt(req.params.slotIndex, 10);
    const boardingHouseId = req.body.boardingHouseId ? Number(req.body.boardingHouseId) : (req.query.boardingHouseId ? Number(req.query.boardingHouseId) : null);

    if (!slotIndex || slotIndex < 1 || slotIndex > 5) {
      return res.status(400).json({ error: 'Invalid slot index (must be 1 to 5).' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded for this slot.' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const user = await User.findByPk(ownerId);
    if (!user) return res.status(404).json({ error: 'Owner not found.' });

    let bh = null;
    if (boardingHouseId) {
      bh = await BoardingHouse.findOne({ where: { id: boardingHouseId, ownerId } });
    } else {
      bh = await BoardingHouse.findOne({ where: { ownerId }, order: [['isPrimary', 'DESC'], ['id', 'ASC']] });
    }

    const activeBhId = bh ? bh.id : null;

    let galleryArr = [];
    if (user.galleryImages) {
      try {
        const p = JSON.parse(user.galleryImages);
        if (Array.isArray(p)) galleryArr = p;
      } catch { galleryArr = []; }
    }
    while (galleryArr.length < 5) galleryArr.push('');

    // If slot 1 is Outdoor Spaces, update cover photo on BH
    if (slotIndex === 1 && bh) {
      bh.picture = imageUrl;
      await bh.save();
    }

    // Slot 1 & primary BH -> update User
    if (!activeBhId || bh?.isPrimary) {
      galleryArr[slotIndex - 1] = imageUrl;
      user.galleryImages = JSON.stringify(galleryArr);
      if (slotIndex === 1) user.boardingHousePicture = imageUrl;
      await user.save();
    }

    // Upsert into OwnerGallery with boardingHouseId
    const category = GALLERY_CATEGORIES.find(c => c.index === slotIndex);
    const whereClause = { ownerId, sortOrder: slotIndex, boardingHouseId: activeBhId };
    const existing = await OwnerGallery.findOne({ where: whereClause });
    if (existing) {
      existing.imageUrl = imageUrl;
      existing.caption = category ? category.label : `Slot ${slotIndex}`;
      existing.imageType = category ? category.key : 'gallery';
      await existing.save();
    } else {
      await OwnerGallery.create({
        ownerId,
        boardingHouseId: activeBhId,
        imageUrl,
        caption: category ? category.label : `Slot ${slotIndex}`,
        sortOrder: slotIndex,
        imageType: category ? category.key : 'gallery',
      });
    }

    await audit(req, 'update_gallery_slot', 'User', user.id, { slotIndex, imageUrl, boardingHouseId: activeBhId });
    res.json({
      success: true,
      message: `${category ? category.label : 'Photo'} updated successfully!`,
      slot: {
        index: slotIndex,
        label: category ? category.label : '',
        imageUrl
      },
      boardingHouseId: activeBhId
    });
  } catch (err) { next(err); }
};

export const deleteGallerySlot = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const slotIndex = parseInt(req.params.slotIndex, 10);
    const boardingHouseId = req.query.boardingHouseId ? Number(req.query.boardingHouseId) : (req.body.boardingHouseId ? Number(req.body.boardingHouseId) : null);

    if (!slotIndex || slotIndex < 1 || slotIndex > 5) {
      return res.status(400).json({ error: 'Invalid slot index (must be 1 to 5).' });
    }

    const user = await User.findByPk(ownerId);
    if (!user) return res.status(404).json({ error: 'Owner not found.' });

    let bh = null;
    if (boardingHouseId) {
      bh = await BoardingHouse.findOne({ where: { id: boardingHouseId, ownerId } });
    } else {
      bh = await BoardingHouse.findOne({ where: { ownerId }, order: [['isPrimary', 'DESC'], ['id', 'ASC']] });
    }
    const activeBhId = bh ? bh.id : null;

    let galleryArr = [];
    if (user.galleryImages) {
      try {
        const p = JSON.parse(user.galleryImages);
        if (Array.isArray(p)) galleryArr = p;
      } catch { galleryArr = []; }
    }
    if (galleryArr[slotIndex - 1]) {
      galleryArr[slotIndex - 1] = '';
      user.galleryImages = JSON.stringify(galleryArr);
      if (slotIndex === 1) {
        user.boardingHousePicture = galleryArr.find(Boolean) || null;
      }
      await user.save();
    }

    if (slotIndex === 1 && bh) {
      bh.picture = '';
      await bh.save();
    }

    const whereClause = { ownerId, sortOrder: slotIndex };
    if (activeBhId) whereClause.boardingHouseId = activeBhId;

    await OwnerGallery.destroy({ where: whereClause });

    await audit(req, 'delete_gallery_slot', 'User', user.id, { slotIndex, boardingHouseId: activeBhId });
    res.json({ success: true, message: 'Photo removed from category slot.' });
  } catch (err) { next(err); }
};

export const updateFiveGallerySlots = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    let boardingHouseId = req.body.boardingHouseId ? Number(req.body.boardingHouseId) : null;

    const user = await User.findByPk(ownerId);
    if (!user) return res.status(404).json({ error: 'Owner not found.' });

    // Look up boarding house
    let bh = null;
    if (boardingHouseId) {
      bh = await BoardingHouse.findOne({ where: { id: boardingHouseId, ownerId } });
      if (!bh) return res.status(403).json({ error: 'Boarding house not found or does not belong to you.' });
    } else {
      bh = await BoardingHouse.findOne({ where: { ownerId }, order: [['isPrimary', 'DESC'], ['id', 'ASC']] });
      if (bh) boardingHouseId = bh.id;
    }

    let galleryArr = [];
    if (user.galleryImages) {
      try {
        const p = JSON.parse(user.galleryImages);
        if (Array.isArray(p)) galleryArr = p;
      } catch { galleryArr = []; }
    }
    while (galleryArr.length < 5) galleryArr.push('');

    const fileMap = {
      1: req.files?.galleryOutdoor?.[0],
      2: req.files?.galleryLivingArea?.[0],
      3: req.files?.galleryBedroom?.[0],
      4: req.files?.galleryDining?.[0],
      5: req.files?.galleryBathroom?.[0],
    };

    let updatedCount = 0;
    for (let slot = 1; slot <= 5; slot++) {
      const file = fileMap[slot];
      if (file) {
        const url = `/uploads/${file.filename}`;
        const category = GALLERY_CATEGORIES.find(c => c.index === slot);

        // Upsert into OwnerGallery with ownerId + slot + boardingHouseId
        const whereClause = { ownerId, sortOrder: slot, boardingHouseId: boardingHouseId || null };
        const existing = await OwnerGallery.findOne({ where: whereClause });
        if (existing) {
          existing.imageUrl = url;
          existing.caption = category?.label || `Slot ${slot}`;
          existing.imageType = category?.key || 'gallery';
          await existing.save();
        } else {
          await OwnerGallery.create({
            ownerId,
            boardingHouseId: boardingHouseId || null,
            imageUrl: url,
            caption: category?.label || `Slot ${slot}`,
            sortOrder: slot,
            imageType: category?.key || 'gallery'
          });
        }

        // If slot 1 (Cover photo), update BoardingHouse.picture
        if (slot === 1 && bh) {
          bh.picture = url;
          await bh.save();
        }

        // If primary BH or no specific BH, also update legacy User fields
        if (!boardingHouseId || bh?.isPrimary) {
          galleryArr[slot - 1] = url;
          if (slot === 1) user.boardingHousePicture = url;
        }
        updatedCount++;
      }
    }

    if (!boardingHouseId || bh?.isPrimary) {
      user.galleryImages = JSON.stringify(galleryArr);
      await user.save();
    }

    await audit(req, 'update_five_gallery_slots', 'User', user.id, { updatedCount, boardingHouseId });
    res.json({
      success: true,
      message: `${updatedCount} photo ${updatedCount === 1 ? 'category' : 'categories'} updated successfully for ${bh ? bh.name : 'boarding house'}!`,
      boardingHouseId
    });
  } catch (err) { next(err); }
};

export const addGalleryImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const imageUrl = `/uploads/${req.file.filename}`;
    const maxOrder = await OwnerGallery.max('sortOrder', { where: { ownerId: oid(req) } }) || 5;
    const data = await OwnerGallery.create({ ownerId: oid(req), imageUrl, caption: req.body.caption || '', sortOrder: maxOrder + 1, imageType: req.body.imageType || 'gallery' });
    await audit(req, 'add_gallery', 'OwnerGallery', data.id, { imageUrl });
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
    await User.update({ amenities: JSON.stringify(req.body.amenities || []) }, { where: { id: oid(req) } });
    await audit(req, 'update_amenities', 'User', oid(req), {});
    res.json({ message: 'Amenities updated.' });
  } catch (err) { next(err); }
};

// ─── House Rules ──────────────────────────────────────────────────────────────

export const updateHouseRules = async (req, res, next) => {
  try {
    await User.update({ houseRules: JSON.stringify(req.body.rules || []) }, { where: { id: oid(req) } });
    await audit(req, 'update_rules', 'User', oid(req), {});
    res.json({ message: 'House rules updated.' });
  } catch (err) { next(err); }
};

// ─── Map / Location ───────────────────────────────────────────────────────────

export const updateLocation = async (req, res, next) => {
  try {
    const { latitude, longitude, mapPin } = req.body;
    await User.update({ boardingHouseLatitude: latitude, boardingHouseLongitude: longitude, mapPin }, { where: { id: oid(req) } });
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

    const profilePic = req.files?.['profilePicture']?.[0];
    if (profilePic) updates.profilePicture = `/uploads/${profilePic.filename}`;

    const gcashQrFile = req.files?.['gcashQrCode']?.[0];
    if (gcashQrFile) updates.gcashQrCode = `/uploads/${gcashQrFile.filename}`;

    await user.update(updates);
    await audit(req, 'update_my_profile', 'User', user.id, { fields: Object.keys(updates) });
    res.json({ message: 'Profile updated.', data: user.get({ plain: true }) });
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
    docFields.forEach(field => {
      const file = req.files?.[field]?.[0];
      if (file) updates[field] = `/uploads/${file.filename}`;
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    await user.update(updates);
    await audit(req, 'update_documents', 'User', user.id, { updatedDocs: Object.keys(updates) });
    res.json({ message: 'Documents updated successfully.', updated: Object.keys(updates) });
  } catch (err) { next(err); }
};

// ─── Pending Tenant Applications (Two-Way Confirmation Workflow) ─────────────

export const getPendingApplications = async (req, res, next) => {
  try {
    const ownerId = oid(req);
    const owner = await User.findByPk(ownerId, { attributes: ['boardingHouseName'] });

    // 1. Fetch from TenantApplications table
    let applications = await TenantApplication.findAll({
      where: {
        [Op.or]: [
          { ownerId },
          ...(owner?.boardingHouseName ? [{ boardingHouseName: { [Op.like]: owner.boardingHouseName } }] : [])
        ]
      },
      order: [['createdAt', 'DESC']]
    });

    // 2. Backward compatibility: also check User table for tenants who selected this BH
    if (owner?.boardingHouseName) {
      const pendingTenantUsers = await User.findAll({
        where: {
          accountType: 'tenant',
          selectedBoardingHouse: { [Op.like]: owner.boardingHouseName },
        },
        attributes: ['id', 'fullName', 'email', 'contactNumber', 'profilePicture', 'selectedBoardingHouse', 'applicationStatus', 'emailVerified', 'createdAt'],
      });

      for (const u of pendingTenantUsers) {
        const hasApp = applications.some(a => a.tenantId === u.id);
        if (!hasApp) {
          // Synthesize an application in DB
          try {
            const created = await TenantApplication.create({
              tenantId: u.id,
              ownerId: ownerId,
              boardingHouseName: owner.boardingHouseName,
              status: u.applicationStatus === 'approved' ? 'confirmed' : 'pending_owner',
              message: 'Registered with selected boarding house'
            });
            applications.unshift(created);
          } catch (e) {}
        }
      }
    }

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
        validIdPicture: tenantUser ? tenantUser.validIdPicture : '',
        boardingHouseName: app.boardingHouseName,
        requestedRoomType: app.requestedRoomType || 'Any',
        message: app.message,
        status: app.status,
        roomId: app.roomId,
        monthlyRent: app.monthlyRent,
        moveInDate: app.moveInDate,
        ownerNotes: app.ownerNotes,
        acceptedAt: app.acceptedAt,
        confirmedAt: app.confirmedAt,
        createdAt: app.createdAt,
        room
      };
    }));

    res.json({ data: enriched });
  } catch (err) { next(err); }
};

export const acceptTenantApplication = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const ownerId = oid(req);
    const { roomId, monthlyRent, moveInDate, notes, applicationId } = req.body;

    const tenantUser = await User.findOne({
      where: { id: userId, accountType: 'tenant' },
    });
    if (!tenantUser) return res.status(404).json({ error: 'Tenant user not found.' });

    const owner = await User.findByPk(ownerId, { attributes: ['id', 'fullName', 'boardingHouseName'] });

    // Find or create the TenantApplication record
    let app = null;
    if (applicationId) {
      app = await TenantApplication.findOne({ where: { id: applicationId, ownerId } });
    }
    if (!app) {
      app = await TenantApplication.findOne({
        where: {
          tenantId: userId,
          ownerId,
          status: { [Op.in]: ['pending_owner', 'accepted_by_owner'] }
        },
        order: [['createdAt', 'DESC']]
      });
    }
    if (!app) {
      app = await TenantApplication.create({
        tenantId: userId,
        ownerId,
        boardingHouseName: owner?.boardingHouseName || `${owner?.fullName}'s Boarding House`,
        status: 'pending_owner'
      });
    }

    // Update the application status to 'accepted_by_owner' (Awaiting tenant confirmation back!)
    app.status = 'accepted_by_owner';
    app.roomId = roomId ? parseInt(roomId, 10) : null;
    app.monthlyRent = monthlyRent ? Number(monthlyRent) : 0;
    app.moveInDate = moveInDate || new Date();
    app.ownerNotes = notes || null;
    app.acceptedAt = new Date();
    await app.save();

    // Approve tenant account immediately so features unlock upon owner acceptance
    tenantUser.applicationStatus = 'approved';
    if (owner?.boardingHouseName) {
      tenantUser.selectedBoardingHouse = owner.boardingHouseName;
    }
    await tenantUser.save();

    // Create or activate OwnerTenant record
    let ot = await OwnerTenant.findOne({
      where: {
        ownerId,
        [Op.or]: [
          ...(tenantUser.email ? [{ email: tenantUser.email }] : []),
          ...(tenantUser.contactNumber ? [{ contactNumber: tenantUser.contactNumber }] : []),
          ...(tenantUser.fullName ? [{ fullName: tenantUser.fullName }] : [])
        ]
      }
    });

    if (ot) {
      ot.status = 'active';
      if (roomId) ot.roomId = parseInt(roomId, 10);
      if (monthlyRent) ot.monthlyRent = Number(monthlyRent);
      if (moveInDate) ot.moveInDate = moveInDate;
      await ot.save();
    } else {
      ot = await OwnerTenant.create({
        ownerId,
        roomId: roomId ? parseInt(roomId, 10) : null,
        fullName: tenantUser.fullName,
        email: tenantUser.email,
        contactNumber: tenantUser.contactNumber,
        monthlyRent: monthlyRent ? Number(monthlyRent) : 0,
        moveInDate: moveInDate || new Date(),
        status: 'active'
      });
    }

    if (roomId) {
      await OwnerRoom.update({ status: 'occupied' }, { where: { id: roomId, ownerId } });
    }

    // Send notification to tenant to review and accept back
    await BarangayNotification.create({
      userId: tenantUser.id,
      title: '🎉 Boarding House Landlord Accepted Your Application!',
      body: `Congratulations! ${owner?.boardingHouseName || owner?.fullName || 'The Landlord'} has accepted your application! Please open your Tenant Portal and click "Accept & Confirm" to finalize your room tenancy.`,
      type: 'application_offered',
      isRead: false,
    }).catch(() => {});

    // Notify owner
    await OwnerNotification.create({
      ownerId,
      title: '✅ Rental Offer Sent to Tenant',
      body: `You accepted ${tenantUser.fullName}'s application for ${app.boardingHouseName}. Waiting for the tenant to confirm back on their portal.`,
      type: 'tenant_offer_sent',
    }).catch(() => {});

    await audit(req, 'accept_tenant_application', 'TenantApplication', app.id, {
      tenantUserId: userId,
      monthlyRent,
      roomId
    });

    res.status(200).json({
      success: true,
      data: app,
      message: `Rental offer sent to ${tenantUser.fullName}! The tenant must now accept back on their dashboard to complete confirmation.`
    });
  } catch (err) { next(err); }
};

export const declineTenantApplication = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const ownerId = oid(req);

    const tenantUser = await User.findOne({ where: { id: userId, accountType: 'tenant' } });
    if (!tenantUser) return res.status(404).json({ error: 'Tenant user not found.' });

    const owner = await User.findByPk(ownerId, { attributes: ['boardingHouseName', 'fullName'] });

    // Update TenantApplication status to 'declined_by_owner'
    const app = await TenantApplication.findOne({
      where: {
        tenantId: userId,
        ownerId,
        status: { [Op.in]: ['pending_owner', 'accepted_by_owner'] }
      },
      order: [['createdAt', 'DESC']]
    });

    if (app) {
      app.status = 'declined_by_owner';
      await app.save();
    }

    // Send notification to tenant
    await BarangayNotification.create({
      userId: tenantUser.id,
      title: 'Boarding House Application Update',
      body: `${owner?.boardingHouseName || owner?.fullName || 'The Landlord'} was unable to accept your application at this time. You may browse and apply to other boarding houses on DormMap.`,
      type: 'application_declined',
      isRead: false,
    }).catch(() => {});

    await OwnerNotification.create({
      ownerId,
      title: '❌ Tenant Application Declined',
      body: `You have declined ${tenantUser.fullName}'s rental application.`,
      type: 'tenant_declined',
    }).catch(() => {});

    res.json({ success: true, message: 'Tenant application declined.' });
  } catch (err) { next(err); }
};

