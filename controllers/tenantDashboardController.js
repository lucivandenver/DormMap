import { confirmOffer } from '../services/occupancyService.js';
import { listTenantDorms } from '../services/dormListingService.js';
import { Op, fn, col } from 'sequelize';
import bcrypt from 'bcrypt';
import { User } from '../models/userModel.js';
import { Announcement, BarangayNotification } from '../models/adminModels.js';
import {
  BoardingHouse, OwnerRoom, OwnerTenant, OwnerPayment,
  OwnerMessage, OwnerNotification, OwnerActivityLog, OwnerInquiry
} from '../models/ownerModels.js';
import { MaintenanceRequest, TenantDocument, TenantApplication } from '../models/tenantModels.js';

import { findActiveRental } from '../services/rentalIdentityService.js';
const getTenantRecord = findActiveRental;
async function propertyOwnerView(owner, room) {
  if (!owner) return null;
  const result = owner.get({ plain: true });
  const house = room?.boardingHouseId ? await BoardingHouse.findOne({ where: { id: room.boardingHouseId, ownerId: owner.id } }) : null;
  if (house) Object.assign(result, { boardingHouseName: house.name, boardingHouseAddress: house.address, barangay: house.barangay, boardingHousePicture: house.picture, boardingHouseLatitude: house.latitude, boardingHouseLongitude: house.longitude, amenities: house.amenities, houseRules: house.houseRules, description: house.description });
  return result;
}


// ─── Render Page ─────────────────────────────────────────────────────────────

export const tenantDashboardPage = (req, res) => {
  res.render('tenantDashboard', {
    title: 'DormMap | Tenant Portal',
    userName: req.session.userName || 'Tenant',
    userEmail: req.currentUser?.email || '',
    profilePicture: req.currentUser?.profilePicture || '',
    userId: req.session.userId || req.currentUser?.id || 0,
  });
};

// ─── Overview & Analytics Cards ──────────────────────────────────────────────

export const overview = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const tenantRec = await getTenantRecord(user);

    let room = null;
    let owner = null;
    let payments = [];
    let maintenanceList = [];
    let announcements = [];
    let unreadCount = 0;

    if (tenantRec) {
      if (tenantRec.roomId) {
        room = await OwnerRoom.findByPk(tenantRec.roomId);
      }
      if (tenantRec.ownerId) {
        owner = await User.findByPk(tenantRec.ownerId, {
          attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'profilePicture', 'houseRules', 'amenities', 'boardingHousePicture']
        });
      }
      payments = await OwnerPayment.findAll({
        where: { tenantId: tenantRec.id },
        order: [['dueDate', 'DESC']]
      });
      maintenanceList = await MaintenanceRequest.findAll({
        where: { tenantId: user.id },
        order: [['createdAt', 'DESC']]
      });
    }

    // Owner announcements & general announcements
    announcements = await Announcement.findAll({
      where: { isPublished: true },
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    // Unread messages count
    unreadCount = await OwnerMessage.count({
      where: { recipientId: user.id, isRead: false }
    });

    const today = new Date();

    // Payment statistics calculation
    const pendingPayment = payments.find(p => p.status === 'pending');
    const monthlyRentAmount = tenantRec?.monthlyRent ? Number(tenantRec.monthlyRent) : (room?.rentalPrice ? Number(room.rentalPrice) : 0);
    const outstandingBalance = tenantRec?.balance ? Number(tenantRec.balance) : payments.filter(p => p.status === 'pending').reduce((sum, p) => sum + Number(p.amount) + Number(p.penalty || 0), 0);
    const nextDueDate = pendingPayment ? pendingPayment.dueDate : (tenantRec?.contractEnd || 'N/A');
    const paymentStatus = pendingPayment ? (new Date(pendingPayment.dueDate) < today ? 'overdue' : 'pending') : 'up_to_date';

    // 6-Month Payment History Chart Data
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'short' });
      const paid = payments.filter(p => p.status === 'paid' && p.month === key).reduce((s, p) => s + Number(p.amount), 0);
      const pending = payments.filter(p => p.status === 'pending' && p.month === key).reduce((s, p) => s + Number(p.amount), 0);
      months.push({ label, paid, pending, month: key });
    }

    // Monthly Expenses Chart Data
    const expenseBreakdown = [
      { category: 'Monthly Rent', amount: monthlyRentAmount },
      { category: 'Penalties & Fees', amount: payments.reduce((s, p) => s + Number(p.penalty || 0), 0) },
      { category: 'Paid Total', amount: payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount) + Number(p.penalty || 0), 0) }
    ];

    // Fetch tenant applications
    let applications = await TenantApplication.findAll({
      where: { tenantId: user.id },
      order: [['createdAt', 'DESC']]
    });

    // If tenant selected a boarding house previously but has no TenantApplication row, create one retroactively
    if (applications.length === 0 && user.selectedBoardingHouse) {
      let matchedOwner = await User.findOne({
        where: {
          accountType: 'boarding_house_owner',
          [Op.or]: [
            { boardingHouseName: user.selectedBoardingHouse },
            { name: user.selectedBoardingHouse }
          ]
        }
      });
      const initialStatus = (tenantRec || user.applicationStatus === 'approved') ? 'confirmed' : 'pending_owner';
      const createdApp = await TenantApplication.create({
        tenantId: user.id,
        ownerId: matchedOwner ? matchedOwner.id : (tenantRec?.ownerId || 0),
        boardingHouseName: user.selectedBoardingHouse,
        requestedRoomType: user.preferredLocation || null,
        message: 'Initial profile application',
        status: initialStatus
      });
      applications = [createdApp];
    }

    // Attach owner details to applications
    const enrichedApplications = await Promise.all(applications.map(async (app) => {
      let appOwner = null;
      if (app.ownerId) {
        appOwner = await User.findByPk(app.ownerId, {
          attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'profilePicture', 'boardingHousePicture', 'barangay']
        });
      }
      let appRoom = null;
      if (app.roomId) {
        appRoom = await OwnerRoom.findByPk(app.roomId, {
          attributes: ['id', 'roomNumber', 'roomType', 'rentalPrice']
        });
      }
      return {
        ...app.get({ plain: true }),
        owner: appOwner ? appOwner.get({ plain: true }) : null,
        room: appRoom ? appRoom.get({ plain: true }) : null,
      };
    }));

    const hasConfirmedApp = enrichedApplications.some(a => a.status === 'confirmed');
    const hasAcceptedApp = enrichedApplications.some(a => a.status === 'accepted_by_owner');

    // Tenant is accepted/unlocked if:
    // 1. A confirmed application exists, OR
    // 2. An owner has accepted an application (offer received/accepted), OR
    // 3. Active OwnerTenant record exists, OR
    // 4. user.applicationStatus is 'approved'
    const isAcceptedOrConfirmed = hasConfirmedApp || hasAcceptedApp || (tenantRec && tenantRec.status === 'active') || user.applicationStatus === 'approved';
    const isPending = !isAcceptedOrConfirmed;

    // Self-heal: ensure user.applicationStatus is approved in DB if already accepted/confirmed
    if (isAcceptedOrConfirmed && user.applicationStatus !== 'approved') {
      user.applicationStatus = 'approved';
      if (!user.selectedBoardingHouse && enrichedApplications[0]?.boardingHouseName) {
        user.selectedBoardingHouse = enrichedApplications[0].boardingHouseName;
      }
      await user.save().catch(() => {});
    }


    // Fallback load room and owner if not loaded yet
    if (!room && tenantRec?.roomId) {
      room = await OwnerRoom.findByPk(tenantRec.roomId);
    }
    if (!owner && tenantRec?.ownerId) {
      owner = await User.findByPk(tenantRec.ownerId, {
        attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'profilePicture', 'houseRules', 'amenities', 'boardingHousePicture']
      });
    }

    res.json({
      isPending,
      pendingBoardingHouse: user.selectedBoardingHouse || (enrichedApplications[0]?.boardingHouseName || 'Target Boarding House'),
      applications: enrichedApplications,
      applicationStats: {
        total: enrichedApplications.length,
        pending: enrichedApplications.filter(a => a.status === 'pending_owner').length,
        offered: enrichedApplications.filter(a => a.status === 'accepted_by_owner').length,
        confirmed: enrichedApplications.filter(a => a.status === 'confirmed').length,
        cancelled: enrichedApplications.filter(a => a.status === 'cancelled_by_tenant' || a.status === 'declined_by_owner').length,
      },
      cards: {
        currentRoom: room ? `Room ${room.roomNumber} (${room.roomType})` : (isPending ? 'Pending Acceptance' : 'Not Assigned'),
        monthlyRent: monthlyRentAmount || (tenantRec?.monthlyRent ? Number(tenantRec.monthlyRent) : (room?.rentalPrice ? Number(room.rentalPrice) : 0)),
        paymentStatus: isPending ? 'pending_approval' : paymentStatus,
        outstandingBalance,
        nextDueDate: isPending ? 'Awaiting Owner Approval' : nextDueDate,
        totalPayments: payments.length,
        pendingMaintenance: maintenanceList.filter(m => m.status === 'pending' || m.status === 'in_progress').length,
        unreadMessages: unreadCount,
      },
      room: room ? room.get({ plain: true }) : null,
      owner: await propertyOwnerView(owner, room),
      tenantRecord: tenantRec ? tenantRec.get({ plain: true }) : null,
      charts: {
        paymentHistory: months,
        expenseBreakdown
      },
      recentPayments: payments.slice(0, 5),
      recentMaintenance: maintenanceList.slice(0, 5),
      announcements: announcements.map(a => a.get({ plain: true }))
    });
  } catch (err) { next(err); }
};

// ─── My Room Module ──────────────────────────────────────────────────────────

export const getMyRoom = async (req, res, next) => {
  try {
    const user = req.currentUser;
    let tenantRec = await getTenantRecord(user);

    if (!tenantRec) {
      const app = await TenantApplication.findOne({
        where: { tenantId: user.id, status: { [Op.in]: ['confirmed', 'accepted_by_owner'] } },
        order: [['createdAt', 'DESC']]
      });
      if (app) {
        const room = app.roomId ? await OwnerRoom.findByPk(app.roomId) : null;
        const owner = app.ownerId ? await User.findByPk(app.ownerId, {
          attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'profilePicture', 'houseRules', 'amenities', 'boardingHousePicture', 'boardingHouseLatitude', 'boardingHouseLongitude', 'operatingHours']
        }) : null;
        return res.json({
          hasRoom: !!room,
          tenantRecord: { monthlyRent: app.monthlyRent, moveInDate: app.moveInDate },
          room: room ? room.get({ plain: true }) : null,
          boardingHouse: await propertyOwnerView(owner, room),
        });
      }
      return res.json({
        hasRoom: false,
        message: 'You have not been assigned to a room yet by your boarding house owner.'
      });
    }

    const room = tenantRec.roomId ? await OwnerRoom.findByPk(tenantRec.roomId) : null;
    const owner = tenantRec.ownerId ? await User.findByPk(tenantRec.ownerId, {
      attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'profilePicture', 'houseRules', 'amenities', 'boardingHousePicture', 'boardingHouseLatitude', 'boardingHouseLongitude', 'operatingHours']
    }) : null;

    res.json({
      hasRoom: Boolean(room),
      tenantRecord: tenantRec.get({ plain: true }),
      room: room ? room.get({ plain: true }) : null,
      boardingHouse: await propertyOwnerView(owner, room),
    });
  } catch (err) { next(err); }
};

// ─── Payment History Module ──────────────────────────────────────────────────

export const getPaymentHistory = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const tenantRec = await getTenantRecord(user);

    if (!tenantRec) {
      return res.json({ payments: [], totalPaid: 0, totalBalance: 0 });
    }

    const { search = '', status = 'all' } = req.query;
    const where = { tenantId: tenantRec.id };

    if (status !== 'all') where.status = status;

    const payments = await OwnerPayment.findAll({
      where,
      order: [['dueDate', 'DESC']]
    });

    const totalPaid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount) + Number(p.penalty || 0), 0);
    const totalBalance = payments.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount) + Number(p.penalty || 0), 0);

    res.json({
      payments,
      totalPaid,
      totalBalance,
      tenantRecord: tenantRec
    });
  } catch (err) { next(err); }
};

// ─── Rental Information Module ───────────────────────────────────────────────

export const getRentalInformation = async (req, res, next) => {
  try {
    const user = req.currentUser;
    let tenantRec = await getTenantRecord(user);

    if (!tenantRec) {
      const app = await TenantApplication.findOne({
        where: { tenantId: user.id, status: { [Op.in]: ['confirmed', 'accepted_by_owner'] } },
        order: [['createdAt', 'DESC']]
      });
      if (app) {
        const owner = app.ownerId ? await User.findByPk(app.ownerId, {
          attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'houseRules', 'amenities', 'operatingHours', 'boardingHousePicture', 'barangay']
        }) : null;
        const room = app.roomId ? await OwnerRoom.findByPk(app.roomId) : null;
        return res.json({
          info: {
            tenant: { monthlyRent: app.monthlyRent, contractStart: app.moveInDate || 'Active' },
            room,
            owner
          }
        });
      }
      return res.json({ info: null, message: 'No rental agreement found for your account.' });
    }

    const owner = await User.findByPk(tenantRec.ownerId, {
      attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'houseRules', 'amenities', 'operatingHours', 'boardingHousePicture', 'barangay']
    });

    const room = tenantRec.roomId ? await OwnerRoom.findByPk(tenantRec.roomId) : null;

    res.json({
      info: {
        tenant: tenantRec,
        room,
        owner,
      }
    });
  } catch (err) { next(err); }
};

// ─── Maintenance Requests Module ─────────────────────────────────────────────

export const getMaintenanceRequests = async (req, res, next) => {
  try {
    const requests = await MaintenanceRequest.findAll({
      where: { tenantId: req.currentUser.id },
      order: [['createdAt', 'DESC']]
    });
    res.json({ requests });
  } catch (err) { next(err); }
};

export const createMaintenanceRequest = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const tenantRec = await getTenantRecord(user);

    const { title, description, category, priority } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and detailed description are required.' });
    }

    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const newRequest = await MaintenanceRequest.create({
      tenantId: user.id,
      ownerId: tenantRec?.ownerId || 0,
      roomId: tenantRec?.roomId || null,
      title,
      description,
      category: category || 'general',
      priority: priority || 'medium',
      photos: photoUrl,
      status: 'pending'
    });

    // Send notification to owner if linked
    if (tenantRec?.ownerId) {
      await OwnerNotification.create({
        ownerId: tenantRec.ownerId,
        title: '🔧 New Maintenance Request',
        body: `Tenant ${user.fullName} submitted a maintenance request: "${title}"`,
        type: 'maintenance',
        link: '#maintenance'
      }).catch(() => {});
    }

    res.status(201).json({ message: 'Maintenance request submitted successfully.', request: newRequest });
  } catch (err) { next(err); }
};

// ─── Messaging Module (Messenger-Style Multi-Conversation) ───────────────────

export const getConversations = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { search = '' } = req.query;

    // 1. Find all messages involving this tenant
    const messages = await OwnerMessage.findAll({
      where: {
        [Op.or]: [{ senderId: user.id }, { recipientId: user.id }]
      },
      order: [['createdAt', 'DESC']]
    });

    // 2. Find all applications of this tenant
    const applications = await TenantApplication.findAll({
      where: { tenantId: user.id },
      order: [['createdAt', 'DESC']]
    });

    const ownerIdSet = new Set();
    messages.forEach(m => {
      if (m.senderId === user.id) ownerIdSet.add(m.recipientId);
      if (m.recipientId === user.id) ownerIdSet.add(m.senderId);
    });
    applications.forEach(a => {
      if (a.ownerId) ownerIdSet.add(a.ownerId);
    });

    // If user has a selected boarding house, add that owner as well
    if (user.selectedBoardingHouse) {
      const bhOwner = await User.findOne({
        where: {
          accountType: 'boarding_house_owner',
          [Op.or]: [
            { boardingHouseName: user.selectedBoardingHouse },
            { name: user.selectedBoardingHouse }
          ]
        }
      });
      if (bhOwner) ownerIdSet.add(bhOwner.id);
    }

    const tenantRec = await getTenantRecord(user);
    if (tenantRec?.ownerId) ownerIdSet.add(tenantRec.ownerId);

    const ownerIds = Array.from(ownerIdSet).filter(Boolean);
    if (ownerIds.length === 0) {
      return res.json({ conversations: [] });
    }

    const owners = await User.findAll({
      where: {
        id: { [Op.in]: ownerIds },
        accountType: 'boarding_house_owner'
      },
      attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'profilePicture', 'contactNumber', 'barangay']
    });

    // Build conversations list
    let conversations = owners.map(o => {
      const ownerMsgs = messages.filter(m =>
        (m.senderId === o.id && m.recipientId === user.id) ||
        (m.senderId === user.id && m.recipientId === o.id)
      );
      const lastMsg = ownerMsgs[0] || null;
      const unreadCount = ownerMsgs.filter(m => m.senderId === o.id && m.recipientId === user.id && !m.isRead).length;
      const app = applications.find(a => a.ownerId === o.id);

      return {
        ownerId: o.id,
        ownerName: o.fullName,
        boardingHouseName: o.boardingHouseName || 'Boarding House',
        address: o.boardingHouseAddress || o.barangay || '',
        profilePicture: o.profilePicture || null,
        contactNumber: o.contactNumber || null,
        lastMessage: lastMsg ? lastMsg.message : (app ? `Applied for stay (${app.status.replace(/_/g, ' ')})` : 'Inquiry conversation opened'),
        lastMessageTime: lastMsg ? lastMsg.createdAt : (app ? app.createdAt : null),
        lastMessageIsMe: lastMsg ? lastMsg.senderId === user.id : false,
        unreadCount,
        applicationStatus: app ? app.status : null,
        applicationId: app ? app.id : null,
      };
    });

    // Sort by latest message or application time descending (Messenger style)
    conversations.sort((a, b) => {
      const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return timeB - timeA;
    });

    // Search filter (by owner name or boarding house name)
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      conversations = conversations.filter(c =>
        c.ownerName.toLowerCase().includes(q) ||
        c.boardingHouseName.toLowerCase().includes(q)
      );
    }

    res.json({ conversations });
  } catch (err) { next(err); }
};

export const getMessages = async (req, res, next) => {
  try {
    const user = req.currentUser;
    let targetOwnerId = req.query.ownerId ? parseInt(req.query.ownerId, 10) : null;

    if (!targetOwnerId) {
      // Find latest conversation partner
      const lastMsg = await OwnerMessage.findOne({
        where: { [Op.or]: [{ senderId: user.id }, { recipientId: user.id }] },
        order: [['createdAt', 'DESC']]
      });
      if (lastMsg) {
        targetOwnerId = lastMsg.senderId === user.id ? lastMsg.recipientId : lastMsg.senderId;
      }
    }

    if (!targetOwnerId) {
      const tenantRec = await getTenantRecord(user);
      if (tenantRec?.ownerId) targetOwnerId = tenantRec.ownerId;
    }

    if (!targetOwnerId && user.selectedBoardingHouse) {
      const ownerUser = await User.findOne({
        where: {
          accountType: 'boarding_house_owner',
          [Op.or]: [
            { boardingHouseName: user.selectedBoardingHouse },
            { name: user.selectedBoardingHouse }
          ]
        }
      });
      if (ownerUser) targetOwnerId = ownerUser.id;
    }

    if (!targetOwnerId) {
      const app = await TenantApplication.findOne({
        where: { tenantId: user.id },
        order: [['createdAt', 'DESC']]
      });
      if (app?.ownerId) targetOwnerId = app.ownerId;
    }

    if (!targetOwnerId) {
      return res.json({ messages: [], owner: null });
    }

    const owner = await User.findByPk(targetOwnerId, {
      attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'profilePicture', 'contactNumber', 'barangay']
    });

    if (!owner) {
      return res.json({ messages: [], owner: null });
    }

    const messages = await OwnerMessage.findAll({
      where: {
        [Op.or]: [
          { senderId: user.id, recipientId: owner.id },
          { senderId: owner.id, recipientId: user.id }
        ]
      },
      order: [['createdAt', 'ASC']]
    });

    // Mark messages from this owner as read
    await OwnerMessage.update({ isRead: true }, {
      where: { senderId: owner.id, recipientId: user.id, isRead: false }
    });

    // Get current application with this owner
    const application = await TenantApplication.findOne({
      where: { tenantId: user.id, ownerId: owner.id },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      messages,
      owner: owner.get({ plain: true }),
      application: application ? application.get({ plain: true }) : null
    });
  } catch (err) { next(err); }
};

export const sendMessage = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { message, subject, ownerId: bodyOwnerId } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty.' });
    }

    let ownerId = bodyOwnerId ? parseInt(bodyOwnerId, 10) : null;
    if (!ownerId) {
      const tenantRec = await getTenantRecord(user);
      ownerId = tenantRec?.ownerId;
    }
    if (!ownerId && user.selectedBoardingHouse) {
      const ownerUser = await User.findOne({
        where: {
          accountType: 'boarding_house_owner',
          [Op.or]: [
            { boardingHouseName: user.selectedBoardingHouse },
            { name: user.selectedBoardingHouse }
          ]
        }
      });
      if (ownerUser) ownerId = ownerUser.id;
    }
    if (!ownerId) {
      const app = await TenantApplication.findOne({
        where: { tenantId: user.id },
        order: [['createdAt', 'DESC']]
      });
      if (app?.ownerId) ownerId = app.ownerId;
    }

    if (!ownerId) {
      return res.status(400).json({ error: 'Please select a landlord to start messaging.' });
    }

    const newMessage = await OwnerMessage.create({
      ownerId: ownerId,
      senderId: user.id,
      recipientId: ownerId,
      message: message.trim(),
      subject: subject || 'Tenant Inquiry Message',
      isRead: false
    });

    await OwnerNotification.create({
      ownerId: ownerId,
      title: '💬 New Message from Tenant',
      body: `${user.fullName}: "${message.trim().substring(0, 60)}..."`,
      type: 'message',
      link: '#messages'
    }).catch(() => {});

    res.status(201).json({ message: 'Message sent successfully.', newMessage });
  } catch (err) { next(err); }
};

// ─── Tenant Applications & Browse Boarding Houses ────────────────────────────

export const getApplications = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const applications = await TenantApplication.findAll({
      where: { tenantId: user.id },
      order: [['createdAt', 'DESC']]
    });

    const enriched = await Promise.all(applications.map(async (app) => {
      let appOwner = null;
      if (app.ownerId) {
        appOwner = await User.findByPk(app.ownerId, {
          attributes: ['id', 'fullName', 'boardingHouseName', 'boardingHouseAddress', 'contactNumber', 'email', 'profilePicture', 'boardingHousePicture', 'barangay']
        });
      }
      let appRoom = null;
      if (app.roomId) {
        appRoom = await OwnerRoom.findByPk(app.roomId, {
          attributes: ['id', 'roomNumber', 'roomType', 'rentalPrice']
        });
      }
      return {
        ...app.get({ plain: true }),
        owner: appOwner ? appOwner.get({ plain: true }) : null,
        room: appRoom ? appRoom.get({ plain: true }) : null,
      };
    }));

    res.json({ applications: enriched });
  } catch (err) { next(err); }
};

export const browseBoardingHouses = async (req, res, next) => {
  try {
    const boardingHouses = await listTenantDorms(req.currentUser.id, req.query);
    res.json({ boardingHouses });
  } catch (error) { next(error); }
};

export const applyBoardingHouse = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { ownerId, boardingHouseName, requestedRoomType, message, establishmentId } = req.body;

    if (!ownerId || !boardingHouseName) {
      return res.status(400).json({ error: 'Owner ID and Boarding House Name are required.' });
    }

    const owner = await User.findByPk(ownerId);
    if (!owner) {
      return res.status(404).json({ error: 'Boarding house owner not found.' });
    }

    if (owner.accountType !== 'boarding_house_owner' || owner.isSuspended || owner.isArchived || owner.publicMapUnregistered || !['approved','approved_barangay'].includes(owner.applicationStatus)) return res.status(422).json({ error: 'Applications are available only for approved, registered establishments.' });
    if (establishmentId && !await BoardingHouse.findOne({ where: { id: establishmentId, ownerId: owner.id, approvalStatus: 'approved' } })) return res.status(422).json({ error: 'This boarding house does not belong to the selected owner.' });

    if (!establishmentId) {
      const houses = await BoardingHouse.findAll({ where: { ownerId: owner.id } });
      if (houses.length && !houses.some(house => house.name === boardingHouseName && house.approvalStatus === 'approved')) return res.status(422).json({ error: 'Select an approved property from the current listings.' });
      if (!houses.length && boardingHouseName !== owner.boardingHouseName) return res.status(422).json({ error: 'The selected property does not match this owner.' });
    }

    const selectedHouse = establishmentId ? await BoardingHouse.findOne({ where: { id: establishmentId, ownerId: owner.id, approvalStatus: 'approved' } }) : await BoardingHouse.findOne({ where: { ownerId: owner.id, name: boardingHouseName, approvalStatus: 'approved' } });

    // Check existing applications
    const existing = await TenantApplication.findOne({
      where: {
        tenantId: user.id,
        ownerId: owner.id,
        boardingHouseName: boardingHouseName,
        status: { [Op.in]: ['pending_owner', 'accepted_by_owner', 'confirmed'] }
      }
    });

    if (existing) {
      if (existing.status === 'confirmed') {
        return res.status(400).json({ error: 'You are already confirmed as an active tenant for this boarding house!' });
      }
      if (existing.status === 'accepted_by_owner') {
        return res.status(400).json({ error: 'This owner has already accepted your application! Please accept back on your dashboard to finalize.' });
      }
      return res.status(400).json({ error: 'You already have an active pending inquiry/application for this boarding house.' });
    }

    const roomTypeInfo = requestedRoomType ? ` (Requested Room: ${requestedRoomType})` : '';
    const application = await TenantApplication.create({
      tenantId: user.id,
      ownerId: owner.id,
      boardingHouseId: selectedHouse?.id || null,
      boardingHouseName,
      requestedRoomType: requestedRoomType || null,
      message: message || `Inquired/Applied via DormMap Browse. Contact: ${user.contactNumber || 'N/A'}, Gender: ${user.gender || 'N/A'}${roomTypeInfo}`,
      status: 'pending_owner'
    });

    // Create OwnerInquiry
    await OwnerInquiry.create({
      ownerId: owner.id,
      clientName: user.fullName,
      clientEmail: user.email,
      clientPhone: user.contactNumber,
      message: `Tenant inquiry/application for ${boardingHouseName}${roomTypeInfo}. Note: ${message || 'None'}. Contact: ${user.contactNumber || 'N/A'}, Gender: ${user.gender || 'N/A'}`,
      status: 'new'
    }).catch(() => {});

    // Create OwnerNotification
    await OwnerNotification.create({
      ownerId: owner.id,
      title: '🏠 New Tenant Application Pending',
      body: `${user.fullName} inquired/applied for ${boardingHouseName}${roomTypeInfo}. Review & accept tenant in your portal.`,
      type: 'tenant_application',
      link: '#tenants'
    }).catch(() => {});

    // Create conversation message
    await OwnerMessage.create({
      ownerId: owner.id,
      senderId: user.id,
      recipientId: owner.id,
      subject: `Inquiry - ${boardingHouseName}`,
      message: message ? `Hello! ${message}` : `Hello! I submitted an inquiry/application for ${boardingHouseName}${roomTypeInfo}. Looking forward to your response!`,
      isRead: false
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: `Application submitted successfully for ${boardingHouseName}! It is now awaiting owner approval.`,
      application
    });
  } catch (err) { next(err); }
};

export const confirmApplication = async (req, res, next) => {
  try {
    const application = await confirmOffer(req.currentUser.id, req.params.id);
    await OwnerNotification.create({ ownerId: application.ownerId, title: 'Tenancy confirmed', body: `${req.currentUser.fullName} confirmed the room offer for ${application.boardingHouseName}.`, type: 'tenant_confirmed' });
    res.json({ success: true, message: 'Tenancy confirmed. Your room assignment and available slots have been updated.' });
  } catch (error) { next(error); }
};

export const cancelApplication = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { id } = req.params;

    const app = await TenantApplication.findOne({
      where: { id, tenantId: user.id }
    });

    if (!app) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    if (app.status === 'confirmed') return res.status(409).json({ error: 'Contact your owner to record move-out from an active tenancy.' });
    app.status = 'cancelled_by_tenant';
    await app.save();

    // Notify owner
    await OwnerNotification.create({
      ownerId: app.ownerId,
      title: '❌ Tenant Cancelled Application',
      body: `${user.fullName} has cancelled/declined their application for ${app.boardingHouseName}.`,
      type: 'tenant_cancelled',
      link: '#tenants'
    }).catch(() => {});

    res.json({ success: true, message: 'Application cancelled successfully.' });
  } catch (err) { next(err); }
};

// ─── Documents Module ────────────────────────────────────────────────────────

export const getDocuments = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const tenantRec = await getTenantRecord(user);

    const docs = await TenantDocument.findAll({
      where: { tenantId: user.id },
      order: [['createdAt', 'DESC']]
    });

    res.json({ documents: docs });
  } catch (err) { next(err); }
};

export const uploadDocument = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const tenantRec = await getTenantRecord(user);

    const { title, docType, description } = req.body;
    if (!title || !req.file) {
      return res.status(400).json({ error: 'Document title and file are required.' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const fileSize = `${(req.file.size / 1024).toFixed(1)} KB`;

    const doc = await TenantDocument.create({
      tenantId: user.id,
      ownerId: tenantRec?.ownerId || null,
      title,
      docType: docType || 'other',
      fileUrl,
      fileSize,
      description
    });

    res.status(201).json({ message: 'Document uploaded successfully.', document: doc });
  } catch (err) { next(err); }
};

// ─── Notifications Module ───────────────────────────────────────────────────

export const getNotifications = async (req, res, next) => {
  try {
    const notifications = await BarangayNotification.findAll({
      where: { userId: req.currentUser.id },
      order: [['createdAt', 'DESC']]
    });
    res.json({ notifications });
  } catch (err) { next(err); }
};

// ─── Announcements Module ───────────────────────────────────────────────────

export const getAnnouncements = async (req, res, next) => {
  try {
    const announcements = await Announcement.findAll({
      where: { isPublished: true },
      order: [['createdAt', 'DESC']]
    });
    res.json({ announcements });
  } catch (err) { next(err); }
};

// ─── Profile & Settings Module ───────────────────────────────────────────────

export const getProfile = async (req, res, next) => {
  try {
    const user = req.currentUser;
    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        contactNumber: user.contactNumber,
        gender: user.gender,
        profilePicture: user.profilePicture,
        barangay: user.barangay,
      }
    });
  } catch (err) { next(err); }
};

export const updateProfile = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { fullName, contactNumber, gender } = req.body;

    if (fullName) user.fullName = fullName;
    if (contactNumber !== undefined) user.contactNumber = contactNumber;
    if (gender !== undefined) user.gender = gender;

    if (req.file) {
      user.profilePicture = `/uploads/${req.file.filename}`;
    }

    await user.save();
    req.session.userName = user.fullName;

    res.json({ message: 'Profile updated successfully.', user });
  } catch (err) { next(err); }
};

export const changePassword = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please enter current and new passwords.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New password and confirm password do not match.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect current password.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password changed successfully.' });
  } catch (err) { next(err); }
};
