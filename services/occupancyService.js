import { ownerPaymentConfig, usesPaymentQr } from './ownerPaymentConfig.js';
import { floorNumber, floorLabel, ROOM_TYPES } from './roomPlanService.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { BoardingHouse, OwnerRoom, OwnerTenant, OwnerPayment, OwnerNotification } from '../models/ownerModels.js';
import { TenantApplication } from '../models/tenantModels.js';
import { BarangayNotification } from '../models/adminModels.js';

export const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
const pick = (body, fields) => Object.fromEntries(fields.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
const integer = (value, min, label) => { const n = Number(value); if (!Number.isInteger(n) || n < min) fail(`${label} must be an integer of at least ${min}.`); return n; };
const money = value => { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 99999999.99 || Math.abs(n*100-Math.round(n*100)) > 0.00001) fail('Rent must be a non-negative amount.'); return n; };
export async function ownerLock(ownerId, transaction) {
  const owner = await User.findOne({ where: { id: ownerId, accountType: 'boarding_house_owner' }, transaction, lock: transaction.LOCK.UPDATE });
  if (!owner) fail('Owner not found.', 404);
  return owner;
}
export async function ownedRoom(ownerId, id, transaction) {
  const room = await OwnerRoom.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!room) fail('Room does not belong to this owner.', 404);
  return room;
}
export async function syncOccupancy(ownerId, roomIds, transaction) {
  for (const id of [...new Set(roomIds.filter(Boolean))]) {
    const room = await ownedRoom(ownerId, id, transaction);
    const occupants = await OwnerTenant.findAll({ where: { ownerId, roomId: id, status: 'active' }, transaction });
    const occupied = occupants.reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0);
    const reservationSlots = await TenantApplication.count({ where: { ownerId, reservationRoomId: id, status: 'accepted_by_owner' }, transaction });
    const unavailable = occupied + room.reservedSlots + reservationSlots;
    if (unavailable > room.capacity) fail('Room capacity cannot be lower than its occupants and reserved slots.');
    const availableSlots = room.status === 'maintenance' || (room.rentalBasis === 'room' && unavailable > 0) ? 0 : room.capacity - unavailable;
    await room.update({ reservationSlots, availableSlots, status: room.status === 'maintenance' ? 'maintenance' : availableSlots ? 'available' : 'occupied' }, { transaction });
  }
  const roomsAvailable = await OwnerRoom.count({ where: { ownerId, status: 'available', availableSlots: { [Op.gt]: 0 } }, transaction });
  await User.update({ roomsAvailable }, { where: { id: ownerId }, transaction });
}
export async function saveRoom(ownerId, id, body) {
  return sequelize.transaction(async transaction => {
    await ownerLock(ownerId, transaction);
    const room = id ? await ownedRoom(ownerId, id, transaction) : null;
    const values = pick(body, ['roomNumber','roomType','floor','dimensions','genderPref','amenities','photos','description']);
    const capacity = integer(body.capacity ?? room?.capacity ?? 1, 1, 'Capacity');
    const occupants = room ? await OwnerTenant.findAll({ where: { ownerId, roomId: room.id, status: 'active' }, transaction }) : [];
    const active = occupants.reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0);
    const held = room?.reservationSlots || 0;
    if (capacity > 100) fail('Room capacity cannot exceed 100 occupants.');
    if (capacity < active) fail('Move tenants before reducing room capacity.');
    values.capacity = capacity;
    values.rentalPrice = money(body.rentalPrice ?? room?.rentalPrice ?? 0);
    values.boardingHouseId = body.boardingHouseId ? integer(body.boardingHouseId, 1, 'Property') : room?.boardingHouseId;
    if (!values.boardingHouseId) fail('Select a boarding house before adding a room.');
    const house = await BoardingHouse.findOne({ where: { id: values.boardingHouseId, ownerId }, transaction });
    if (!house) fail('Boarding house does not belong to this owner.', 404);
    const floor = floorNumber(body.floor ?? room?.floor ?? '1st Floor');
    if (!Number.isInteger(floor) || floor < 1 || floor > (house.floorCount || 50)) fail('Select a floor within this property’s floor count.');
    values.floor = floorLabel(floor);
    values.roomType = body.roomType || room?.roomType || (capacity === 1 ? 'Solo Room' : 'Shared Room');
    if (values.roomType === 'Solo Room' && capacity !== 1 && (!room || body.capacity !== undefined || body.roomType !== undefined)) fail('A solo room has one occupant. Choose Shared Room or Family Room for a larger capacity.');
    if (!ROOM_TYPES.includes(values.roomType) && values.roomType !== room?.roomType) fail('Choose a supported room type.');
    values.rentalBasis = body.rentalBasis || room?.rentalBasis || (values.roomType === 'Bedspace' ? 'bed' : 'person');
    if (!['bed','room','person'].includes(values.rentalBasis) || (values.roomType === 'Bedspace' && values.rentalBasis !== 'bed')) fail('Choose a valid price basis; bedspace is per bed.');
    values.bedCount = integer(body.bedCount || room?.bedCount || capacity, 1, 'Beds');
    if (values.bedCount > 100) fail('Physical beds cannot exceed 100.');
    if (values.rentalBasis === 'bed' && values.bedCount !== capacity) fail('Bedspace beds and occupant capacity must match.');
    if (values.rentalBasis === 'room' && occupants.length > 1) fail('Move or consolidate existing tenants before switching to a whole-room lease.');
    if (room && active && room.rentalBasis !== values.rentalBasis) fail('Move current tenants out before changing the rent basis.');
    if (room && active && values.boardingHouseId !== room.boardingHouseId) fail('Move active tenants out before moving this room to another house.');
    values.roomNumber = String(values.roomNumber ?? room?.roomNumber ?? '').trim();
    if (!values.roomNumber) fail('Room number is required.');
    const duplicate = await OwnerRoom.findOne({ where: { ownerId, boardingHouseId: values.boardingHouseId, floor: values.floor, roomNumber: values.roomNumber, ...(id ? { id: { [Op.ne]: id } } : {}) }, transaction });
    if (duplicate) fail('This room number already exists in the selected boarding house.', 409);
    if (values.rentalBasis === 'room' && occupants.length && Number(body.availableSlots) > 0) fail('Move the active household out before making this whole room available.');
    const desired = body.availableSlots === undefined || body.availableSlots === '' ? null : integer(body.availableSlots, 0, 'Available slots');
    if (desired !== null && desired > capacity - active - held) fail('Available slots exceed the unoccupied, unreserved capacity.');
    values.reservedSlots = desired === null || (values.rentalBasis === 'room' && room && (occupants.length || room.reservedSlots > 0 || held) && desired === 0) ? room?.reservedSlots || 0 : capacity - active - held - desired;
    const status = body.status ?? room?.status ?? 'available';
    if (held && (status === 'maintenance' || values.boardingHouseId !== room.boardingHouseId || values.rentalBasis !== room.rentalBasis)) {
      fail('Close this room’s confirmed reservations before moving it, changing its rent basis, or marking it for maintenance.', 409);
    }
    if (!['available','occupied','maintenance'].includes(status)) fail('Invalid room status.');
    values.status = status === 'maintenance' ? status : 'available';
    for (const key of ['furnished','aircon']) if (body[key] !== undefined) values[key] = body[key] === true || body[key] === 'true';
    const saved = room ? await room.update(values, { transaction }) : await OwnerRoom.create({ ...values, ownerId }, { transaction });
    await syncOccupancy(ownerId, [saved.id], transaction);
    return saved.reload({ transaction });
  });
}
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
const openApplications = ['pending_owner', 'accepted_by_owner'];

async function activeStay(user, transaction, exceptId) {
  return OwnerTenant.findOne({ where: {
    status: 'active',
    [Op.or]: [{ tenantUserId: user.id }, { tenantUserId: null, email: user.email }],
    ...(exceptId ? { id: { [Op.ne]: exceptId } } : {})
  }, transaction });
}

async function closeOtherOffers(userId, transaction, confirmedId) {
  await TenantApplication.update({ status: 'another_offer_accepted' }, { where: {
    tenantId: userId, status: { [Op.in]: openApplications },
    id: { [Op.ne]: confirmedId }
  }, transaction });
}

export async function saveTenant(ownerId, id, body, { transaction: suppliedTransaction, trustedUserId = null } = {}) {
  const previous = id ? await OwnerTenant.findOne({ where: { id, ownerId } }) : null;
  const linkedId = trustedUserId || previous?.tenantUserId;
  const email = String(body.email ?? previous?.email ?? '').trim().toLowerCase();
  const identity = linkedId ? { id: linkedId } : email ? { email } : null;
  const run = async transaction => {
    const account = identity ? await User.findOne({ where: { ...identity, accountType: 'tenant' }, transaction, lock: transaction.LOCK.UPDATE }) : null;
    await ownerLock(ownerId, transaction);
    const tenant = id ? await OwnerTenant.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE }) : null;
    if (id && !tenant) fail('Tenant not found.', 404);
    if (tenant?.archivedAt) fail('This tenant record has been archived.', 409);
    if (tenant?.tenantUserId && tenant.tenantUserId !== account?.id) fail('Tenant assignment changed. Refresh and try again.', 409);
    const oldRoomId = tenant?.roomId;
    const values = pick(body, ['fullName','email','contactNumber','emergencyContact','emergencyPhone','moveInDate','moveOutDate','contractStart','contractEnd','notes']);
    if (!(values.fullName ?? tenant?.fullName)?.trim()) fail('Tenant name is required.');
    values.status = body.status ?? tenant?.status ?? 'active';
    if (!['active','moved_out','inactive','evicted'].includes(values.status)) fail('Invalid tenant status.');
    const ending = tenant?.status === 'active' && values.status !== 'active';
    const returning = tenant && tenant.status !== 'active' && values.status === 'active';
    if (ending) {
      values.moveOutDate = offerMoveInDate(values.moveOutDate || today());
      if (values.moveOutDate > today() || (tenant.moveInDate && values.moveOutDate < tenant.moveInDate)) {
        fail('Move-out must be on or after move-in and cannot be in the future.');
      }
      values.moveOutRequestedDate = null;
    }
    if (returning) {
      values.moveInDate = offerMoveInDate(body.moveInDate);
      if (!values.moveInDate || values.moveInDate < today() || (tenant.moveOutDate && values.moveInDate < tenant.moveOutDate)) fail('Choose a new move-in date.');
      values.moveOutDate = null;
    }
    if (tenant && tenant.status !== 'active' && !returning) fail('This stay is already closed.', 409);
    if (account && values.status === 'active' && await activeStay(account, transaction, returning ? null : tenant?.id)) {
      fail('This tenant already has an active tenancy. Their current owner must record move-out first.', 409);
    }
    if (account && !trustedUserId && (!tenant || returning) && values.status === 'active' &&
        await TenantApplication.count({ where: { tenantId: account.id, status: { [Op.in]: openApplications } }, transaction })) {
      fail('This tenant has open inquiries or offers. Use the offer workflow so the tenant can confirm their choice.', 409);
    }
    values.roomId = body.roomId === undefined ? tenant?.roomId || null : body.roomId ? integer(body.roomId, 1, 'Room') : null;
    values.occupantCount = integer(body.occupantCount ?? tenant?.occupantCount ?? 1, 1, 'Household occupants');
    if (values.occupantCount > 100) fail('Household occupants cannot exceed 100.');
    values.monthlyRent = money(body.monthlyRent ?? tenant?.monthlyRent ?? 0);
    // The ledger controls balance; a public form cannot inject IDs, owner IDs, or payment balances.
    if (trustedUserId) values.tenantUserId = trustedUserId;
    if (!values.roomId || values.roomId !== oldRoomId) values.bedNumber = null;
    if (values.roomId) {
      const room = await ownedRoom(ownerId, values.roomId, transaction);
      if (values.status === 'active') {
        const others = await OwnerTenant.findAll({ where: { ownerId, roomId: room.id, status: 'active', ...(id ? { id: { [Op.ne]: id } } : {}) }, transaction });
        const count = others.reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0);
        const branch = await BoardingHouse.findByPk(room.boardingHouseId, { transaction });
        if (branch?.approvalStatus !== 'approved' && (!tenant || tenant.status !== 'active' || tenant.roomId !== room.id || values.occupantCount > Number(tenant.occupantCount || 1))) fail('This branch is not approved for new tenancy.');
        if (room.rentalBasis === 'bed' && values.occupantCount !== 1) fail('Each bedspace tenant occupies one bed. Add separate records for other bedspace tenants.');
        if (body.useReservedSlot === true || body.useReservedSlot === 'on') {
          const newlyLinked = tenant?.status === 'active' && tenant.roomId === room.id ? Math.max(0,values.occupantCount-Number(tenant.occupantCount || 1)) : values.occupantCount;
          if (!newlyLinked) fail('This tenant is already assigned. Uncheck the existing-occupant option.');
          if (room.reservedSlots < newlyLinked) fail('There are not enough owner-reported unavailable slots to link.');
          await room.update({ reservedSlots: room.reservedSlots-newlyLinked }, { transaction });
        }
        if (room.status === 'maintenance' || (room.rentalBasis === 'room' && (others.length || room.reservationSlots)) || count + values.occupantCount + room.reservedSlots + room.reservationSlots > room.capacity) fail('This room has no available capacity for these occupants.', 409);
        if (room.rentalBasis === 'bed') {
          const taken = new Set(others.map(tenant => tenant.bedNumber).filter(Boolean));
          values.bedNumber = body.bedNumber ? integer(body.bedNumber, 1, 'Bed number') : tenant?.roomId === room.id && tenant?.bedNumber || Array.from({ length: room.capacity }, (_,i) => i+1).find(n => !taken.has(n));
          if (!values.bedNumber || values.bedNumber > room.capacity || taken.has(values.bedNumber)) fail('This bed number is unavailable.', 409);
        } else values.bedNumber = null;
      }
    }
    for (const key of ['moveInDate','moveOutDate','contractStart','contractEnd']) if (values[key] === '') values[key] = null;
    if (values.email) values.email = values.email.trim().toLowerCase();
    if (account && tenant?.tenantUserId) values.email = account.email;
    if (email && values.status === 'active' && await OwnerTenant.findOne({ where: { ownerId, email, status: 'active', ...(id ? { id: { [Op.ne]: id } } : {}) }, transaction })) fail('This tenant already has an active record with this owner.', 409);
    if (account) values.tenantUserId = account.id;
    if (returning && !values.roomId) fail('Choose a room for the new stay.');
    if (ending) {
      values.roomId = oldRoomId;
      values.bedNumber = tenant.bedNumber;
      values.moveInDate = tenant.moveInDate;
    }
    if (tenant?.status === 'active' && values.status === 'active' && values.roomId !== oldRoomId) {
      values.roomTransfers = [...(tenant.roomTransfers || []), { fromRoomId: oldRoomId, toRoomId: values.roomId, date: today() }];
    }
    const saved = tenant && !returning ? await tenant.update(values, { transaction }) : await OwnerTenant.create({
      ...(returning ? pick(tenant, ['fullName','email','contactNumber','emergencyContact','emergencyPhone']) : {}),
      ...values, ownerId
    }, { transaction });
    await syncOccupancy(ownerId, [oldRoomId, saved.roomId], transaction);
    if (saved.tenantUserId && (ending || values.status === 'active')) {
      const room = saved.roomId ? await ownedRoom(ownerId, saved.roomId, transaction) : null;
      const house = room ? await BoardingHouse.findByPk(room.boardingHouseId, { transaction }) : null;
      await TenantApplication.update({ roomId: saved.roomId, boardingHouseId: house?.id || null, boardingHouseName: house?.name || 'Boarding House', monthlyRent: saved.monthlyRent, moveInDate: saved.moveInDate, status: ending ? 'tenancy_ended' : 'confirmed' }, { where: { ownerId, tenantId: saved.tenantUserId, status: 'confirmed' }, transaction });
      // A legacy duplicate can exist. Ending one stay should not erase the currently linked property.
      if (!ending || !await activeStay(account, transaction)) {
        await account.update({ selectedBoardingHouse: ending ? null : house?.name || null }, { transaction });
      }
      if (ending) {
        await BarangayNotification.create({ userId: account.id, title: 'Move-out recorded', body: `Your owner recorded move-out on ${saved.moveOutDate}. Your stay is available in Boarding House History.`, type: 'tenancy_ended' }, { transaction });
      }
    }
    return saved;
  };
  return suppliedTransaction ? run(suppliedTransaction) : sequelize.transaction(run);
}
export async function removeRoom(ownerId, id) {
  return sequelize.transaction(async transaction => {
    await ownerLock(ownerId, transaction); const room = await ownedRoom(ownerId, id, transaction);
    if (await OwnerTenant.count({ where: { ownerId, roomId: id }, transaction }) || await TenantApplication.count({ where: { ownerId, [Op.or]: [{ roomId: id }, { reservationRoomId: id }] }, transaction }) || await OwnerPayment.count({ where: { ownerId, roomId: id }, transaction })) fail('This room has tenant, application, or billing history. Use maintenance status instead.', 409);
    const { Payment } = await import('../models/paymentModels.js');
    if (await Payment.count({ where: { ownerId, roomId: id }, transaction })) fail('This room has online payment history. Use maintenance status instead.', 409);
    await room.destroy({ transaction }); await syncOccupancy(ownerId, [], transaction);
  });
}

function requireOwnerPaymentMethod(owner) {
  const payment = ownerPaymentConfig(owner);
  const missingMethod = payment.selectedMethods.find(method => usesPaymentQr(method) && !payment.qrCodes[method]);
  if (missingMethod) fail(`Upload your ${missingMethod} QR code in My Profile & Documents before accepting tenants.`);
  if (!payment.methods.length) fail('Configure an accepted rent payment method before accepting tenants.');
}

export function offerMoveInDate(value) {
  if (value == null || value === '') return null;
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail('Enter a valid move-in date.');
  }
  return value;
}

export async function offerApplication(ownerId, tenantUserId, body, { bulk = false, approveReservation = false } = {}) {
  const moveInDate = offerMoveInDate(body.moveInDate);
  return sequelize.transaction(async transaction => {
    const user = await User.findOne({ where: { id: tenantUserId, accountType: 'tenant' }, transaction, lock: transaction.LOCK.UPDATE });
    if (!user) fail('Tenant not found.', 404);
    const owner = await ownerLock(ownerId, transaction);
    requireOwnerPaymentMethod(owner);
    const app = await TenantApplication.findOne({ where: { ownerId, tenantId: tenantUserId, ...(body.applicationId ? { id: body.applicationId } : {}), status: { [Op.in]: ['pending_owner','accepted_by_owner'] } }, order: [['createdAt','DESC']], transaction, lock: transaction.LOCK.UPDATE });
    if (!app) fail('This inquiry is no longer pending or offered.', 409);
    if (app.reservationRoomId && !approveReservation) fail('Review the reservation payment before approving this request.', 409);
    if (approveReservation && !app.reservationRoomId) fail('Reservation request not found.', 404);
    if (approveReservation && app.reservationApprovedAt) return app;
    if (bulk && app.status === 'accepted_by_owner') fail('An offer has already been sent. Open Review to change it.', 409);
    if (await activeStay(user, transaction)) {
      throw Object.assign(new Error('This tenant already has an active tenancy. Their current owner must record move-out before you can send an offer.'), { status: 409, code: 'ACTIVE_TENANCY' });
    }
    const roomId = approveReservation ? app.reservationRoomId : body.roomId;
    if (!roomId) fail('Choose a room to offer.');
    const room = await ownedRoom(ownerId, roomId, transaction);
    if (app.boardingHouseId && app.boardingHouseId !== room.boardingHouseId) fail('Offer a room in the boarding house the tenant applied to.');
    await syncOccupancy(ownerId, [room.id], transaction);
    await room.reload({ transaction });
    if (!room.availableSlots || room.status === 'maintenance') fail('This room is full or unavailable.', 409);
    const house = await BoardingHouse.findByPk(room.boardingHouseId, { transaction });
    if (house?.approvalStatus !== 'approved') fail('This branch must be approved before offering rooms.');
    const occupantCount = approveReservation ? 1 : integer(body.occupantCount || 1, 1, 'Household occupants');
    if (occupantCount > room.availableSlots || (room.rentalBasis === 'bed' && occupantCount !== 1)) fail('The offered household size does not match this room.');
    if (bulk) {
      const outstanding = await TenantApplication.sum('occupantCount', {
        where: { ownerId, roomId: room.id, status: 'accepted_by_owner' }, transaction
      });
      if (outstanding && (room.rentalBasis === 'room' || Number(outstanding) + occupantCount > room.availableSlots)) {
        fail('This room has outstanding offers for its remaining space. Choose another room.', 409);
      }
    }
    const rate = Number(room.rentalPrice) * (room.rentalBasis === 'person' ? occupantCount : 1);
    const monthlyRent = money(approveReservation ? app.reservationRent : body.monthlyRent ?? rate);
    if (monthlyRent <= 0) fail('Enter a monthly total greater than zero in the Review form.');
    await app.update({ occupantCount, status: 'accepted_by_owner', roomId: room.id, boardingHouseId: house.id, boardingHouseName: house.name, monthlyRent, moveInDate, ownerNotes: String(body.notes || '').slice(0,2000), acceptedAt: new Date(),
      ...(approveReservation ? { reservationApprovedAt: new Date() } : {}) }, { transaction });
    if (approveReservation) await syncOccupancy(ownerId, [room.id], transaction);
    await BarangayNotification.create({ userId: app.tenantId, title: approveReservation ? 'Reservation approved' : 'Room offer received', body: `Review and confirm the offer for ${app.boardingHouseName} on your tenant dashboard.`, type: 'application_offered' }, { transaction });
    return app;
  });
}
export async function confirmOffer(userId, applicationId) {
  const initial = await TenantApplication.findOne({ where: { id: applicationId, tenantId: userId } });
  if (!initial) fail('Application not found.', 404);
  return sequelize.transaction(async transaction => {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const owner = await ownerLock(initial.ownerId, transaction);
    if (owner.isSuspended || owner.isArchived || owner.publicMapUnregistered || !['approved','approved_barangay'].includes(owner.applicationStatus)) fail('This establishment is not currently eligible for tenancy.');
    const app = await TenantApplication.findByPk(applicationId, { transaction, lock: transaction.LOCK.UPDATE });
    if (app.status === 'confirmed') return app;
    if (app.status !== 'accepted_by_owner') fail('This offer is no longer available for confirmation.', 409);
    requireOwnerPaymentMethod(owner);
    const branch = app.boardingHouseId ? await BoardingHouse.findByPk(app.boardingHouseId, { transaction }) : null;
    if (branch?.approvalStatus !== 'approved') fail('This branch is not currently approved.');
    if (await activeStay(user, transaction)) fail('You already have an active tenancy. Arrange move-out before confirming another.', 409);
    if (await TenantApplication.count({ where: { tenantId: userId, id: { [Op.ne]: app.id }, status: 'accepted_by_owner', reservationRoomId: { [Op.ne]: null } }, transaction })) {
      fail('Close your other approved reservation before confirming this offer.', 409);
    }
    if (app.reservationRoomId) {
      await app.update({ status: 'confirmed' }, { transaction });
      await syncOccupancy(app.ownerId, [app.reservationRoomId], transaction);
    }
    await saveTenant(app.ownerId, null, { occupantCount: app.occupantCount || 1, fullName: user.fullName, email: user.email, contactNumber: user.contactNumber, roomId: app.roomId, monthlyRent: app.monthlyRent, moveInDate: app.moveInDate || today(), status: 'active' }, { transaction, trustedUserId: userId });
    await app.update({ status: 'confirmed', confirmedAt: new Date() }, { transaction });
    await user.update({ selectedBoardingHouse: app.boardingHouseName, applicationStatus: 'approved' }, { transaction });
    await closeOtherOffers(userId, transaction, app.id);
    await OwnerNotification.create({ ownerId: app.ownerId, title: 'Tenancy confirmed', body: `${user.fullName} confirmed the room offer for ${app.boardingHouseName}.`, type: 'tenant_confirmed', link: '#tenants' }, { transaction });
    return app;
  });
}
export async function requestMoveOut(userId, value) {
  const date = offerMoveInDate(value);
  if (!date || date < today()) fail('Choose today or a future move-out date.');
  return sequelize.transaction(async transaction => {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const stay = await activeStay(user, transaction);
    if (!stay) fail('No current tenancy found.', 404);
    if (stay.moveInDate && date < stay.moveInDate) fail('Move-out cannot be before move-in.');
    if (stay.moveOutRequestedDate === date) return stay;
    await stay.update({ moveOutRequestedDate: date, tenantUserId: userId }, { transaction });
    await OwnerNotification.create({
      ownerId: stay.ownerId, title: 'Move-out requested', body: `${user.fullName} requested move-out on ${date}.`, type: 'tenant_move_out', link: '#tenants'
    }, { transaction });
    return stay;
  });
}
export async function removeTenant(ownerId, id) {
  return sequelize.transaction(async transaction => {
    await ownerLock(ownerId, transaction);
    const tenant = await OwnerTenant.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!tenant) fail('Tenant not found.', 404);
    if (tenant.archivedAt) fail('This tenant record has been archived.', 409);
    const { Payment } = await import('../models/paymentModels.js');
    if (await OwnerPayment.count({ where: { ownerId, tenantId: id }, transaction }) || await Payment.count({ where: { ownerId, ownerTenantId: id }, transaction }) || tenant.tenantUserId) fail('This tenant has linked history. Change status to moved_out instead of deleting.', 409);
    const roomId = tenant.roomId;
    await tenant.destroy({ transaction }); await syncOccupancy(ownerId, [roomId], transaction);
  });
}
