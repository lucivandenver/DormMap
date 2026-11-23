import { Op } from 'sequelize';
import { sequelize, User } from '../models/userModel.js';
import { TenantApplication } from '../models/tenantModels.js';
import { BoardingHouse, OwnerRoom, OwnerInquiry, OwnerMessage, OwnerNotification } from '../models/ownerModels.js';

const activeStatuses = ['confirmed', 'accepted_by_owner', 'pending_owner'];

export async function findApplicationProperty(selection, options = {}) {
  const owners = { accountType: 'boarding_house_owner', isArchived: false, isSuspended: false,
    publicMapUnregistered: false, applicationStatus: { [Op.in]: ['approved', 'approved_barangay'] } };
  if (typeof selection !== 'string' || !selection.trim()) return {};
  const key = /^(bh|owner)-(\d+)$/.exec(selection);
  if (key?.[1] === 'owner') {
    const owner = await User.findOne({ where: { ...owners, id: key[2] }, ...options });
    if (owner && !await BoardingHouse.count({ where: { ownerId: owner.id }, ...options })) return { owner };
    return {};
  }
  const houses = await BoardingHouse.findAll({
    where: { ...(key ? { id: key[2] } : { name: selection }), approvalStatus: 'approved' }, ...options
  });
  const eligible = houses.length ? await User.findAll({
    where: { ...owners, id: houses.map(house => house.ownerId) }, ...options
  }) : [];
  const matches = houses.filter(house => eligible.some(owner => owner.id === house.ownerId));
  if (matches.length > 1) return {};
  if (matches.length === 1) return { house: matches[0], owner: eligible.find(owner => owner.id === matches[0].ownerId) };

  if (key) return {};
  const legacyOwners = await User.findAll({ where: { ...owners, boardingHouseName: selection }, limit: 2, ...options });
  return legacyOwners.length === 1 ? { owner: legacyOwners[0] } : {};
}

const registrationError = message => Object.assign(new Error(message), { status: 422 });

export const isTenantGender = gender => gender === 'male' || gender === 'female';

export async function registrationApplicationDetails({ selectedBoardingHouse, requestedRoomId, requestedRoomType }, transaction) {
  if (!selectedBoardingHouse && !requestedRoomId) return null;
  const { house, owner } = await findApplicationProperty(selectedBoardingHouse, { transaction });
  const boardingHouseName = house?.name || owner?.boardingHouseName;
  if (!boardingHouseName) throw registrationError('Select an approved boarding house from the current listings.');

  let preferredRoomLabel = null;
  let roomType = typeof requestedRoomType === 'string' ? requestedRoomType.trim().slice(0, 255) : '';
  if (requestedRoomId !== undefined && requestedRoomId !== '') {
    const id = Number(requestedRoomId);
    if (typeof requestedRoomId !== 'string' || !/^\d+$/.test(requestedRoomId) || !Number.isSafeInteger(id) || id < 1) {
      throw registrationError('Select an available room from this boarding house.');
    }
    const boardingHouseId = house?.isPrimary ? { [Op.or]: [house.id, null] } : house?.id ?? null;
    const room = await OwnerRoom.findOne({
      where: { id, ownerId: owner.id, boardingHouseId, status: 'available', availableSlots: { [Op.gt]: 0 } },
      attributes: ['roomNumber', 'floor', 'roomType'], transaction
    });
    if (!room) throw registrationError('That room is no longer available at this boarding house. Choose another room or continue without a preference.');
    roomType = room.roomType;
    preferredRoomLabel = [`Room ${room.roomNumber}`, room.floor, room.roomType].filter(Boolean).join(' · ');
  }
  return { ownerId: owner.id, boardingHouseId: house?.id || null, boardingHouseName, requestedRoomType: roomType || null, preferredRoomLabel };
}

export function createRegistrationInquiry(user, details, transaction) {
  return createTenantApplication({
    ...details, tenantId: user.id, status: 'pending_owner',
    message: 'Submitted during tenant registration.'
  }, { transaction });
}

export function notifyRegistrationInquiry(user, { ownerId, boardingHouseName }) {
  return Promise.allSettled([
    OwnerInquiry.create({ ownerId, clientName: user.fullName, clientEmail: user.email, clientPhone: user.contactNumber,
      status: 'new', message: `Tenant application submitted for ${boardingHouseName}.` }),
    OwnerNotification.create({ ownerId, title: 'New tenant application',
      body: `${user.fullName} applied for a room at ${boardingHouseName}.`, type: 'tenant_application', link: '#tenants' }),
    OwnerMessage.create({ ownerId, senderId: user.id, recipientId: ownerId,
      subject: `Application inquiry for ${boardingHouseName}`,
      message: `Hello! I submitted a rental application for ${boardingHouseName}.`, isRead: false })
  ]);
}

export async function createTenantApplication(values, { legacy = false, transaction } = {}) {
  const create = async transaction => {
    await User.findByPk(values.tenantId, { transaction, lock: transaction.LOCK.UPDATE });
    const applications = await TenantApplication.findAll({
      where: { tenantId: values.tenantId, ownerId: values.ownerId,
        ...(legacy ? {} : { status: { [Op.in]: activeStatuses } }) },
      transaction, order: [['id', 'ASC']]
    });
    const existing = activeStatuses.map(status => applications.find(app => app.status === status)).find(Boolean) || applications[0];
    if (existing) return { application: existing, created: false };
    const application = await TenantApplication.create(values, { transaction });
    return { application, created: true };
  };
  return transaction ? create(transaction) : sequelize.transaction(create);
}

export async function closeDuplicatePendingApplications(applications) {
  const groups = new Map();
  for (const app of applications) {
    if (!activeStatuses.includes(app.status)) continue;
    const key = `${app.ownerId}:${app.tenantId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(app);
  }
  const closed = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => activeStatuses.indexOf(a.status) - activeStatuses.indexOf(b.status) || a.id - b.id);
    for (const app of group.slice(1)) {
      if (app.status !== 'pending_owner') continue;
      await TenantApplication.update({ status: 'duplicate_closed' }, {
        where: { id: app.id, status: 'pending_owner' }
      });
      closed.add(app.id);
    }
  }
  return applications.filter(app => app.status !== 'duplicate_closed' && !closed.has(app.id));
}
