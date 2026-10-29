import { floorNumber, floorLabel, ROOM_TYPES } from './roomPlanService.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { BoardingHouse, OwnerRoom, OwnerTenant, OwnerPayment } from '../models/ownerModels.js';
import { TenantApplication } from '../models/tenantModels.js';

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
    if (occupied + room.reservedSlots > room.capacity) fail('Room capacity cannot be lower than its active tenants and reserved slots.');
    const availableSlots = room.status === 'maintenance' ? 0 : room.rentalBasis === 'room' && (occupants.length || room.reservedSlots > 0) ? 0 : room.capacity - occupied - room.reservedSlots;
    await room.update({ availableSlots, status: room.status === 'maintenance' ? 'maintenance' : availableSlots ? 'available' : 'occupied' }, { transaction });
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
    if (desired !== null && desired > capacity - active) fail('Available slots exceed the unoccupied capacity.');
    values.reservedSlots = desired === null || (values.rentalBasis === 'room' && room && (occupants.length || room.reservedSlots > 0) && desired === 0) ? room?.reservedSlots || 0 : capacity - active - desired;
    const status = body.status ?? room?.status ?? 'available';
    if (!['available','occupied','maintenance'].includes(status)) fail('Invalid room status.');
    values.status = status === 'maintenance' ? status : 'available';
    for (const key of ['furnished','aircon']) if (body[key] !== undefined) values[key] = body[key] === true || body[key] === 'true';
    const saved = room ? await room.update(values, { transaction }) : await OwnerRoom.create({ ...values, ownerId }, { transaction });
    await syncOccupancy(ownerId, [saved.id], transaction);
    return saved.reload({ transaction });
  });
}
export async function saveTenant(ownerId, id, body, { transaction: suppliedTransaction, trustedUserId = null } = {}) {
  const run = async transaction => {
    await ownerLock(ownerId, transaction);
    const tenant = id ? await OwnerTenant.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE }) : null;
    if (id && !tenant) fail('Tenant not found.', 404);
    const oldRoomId = tenant?.roomId;
    const values = pick(body, ['fullName','email','contactNumber','emergencyContact','emergencyPhone','moveInDate','moveOutDate','contractStart','contractEnd','notes']);
    if (!(values.fullName ?? tenant?.fullName)?.trim()) fail('Tenant name is required.');
    values.status = body.status ?? tenant?.status ?? 'active';
    if (!['active','moved_out','inactive','evicted'].includes(values.status)) fail('Invalid tenant status.');
    values.roomId = body.roomId === undefined ? tenant?.roomId || null : body.roomId ? integer(body.roomId, 1, 'Room') : null;
    values.occupantCount = integer(body.occupantCount ?? tenant?.occupantCount ?? 1, 1, 'Household occupants');
    if (values.occupantCount > 100) fail('Household occupants cannot exceed 100.');
    values.monthlyRent = money(body.monthlyRent ?? tenant?.monthlyRent ?? 0);
    // The ledger controls balance; a public form cannot inject IDs, owner IDs, or payment balances.
    if (trustedUserId) values.tenantUserId = trustedUserId;
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
        if (room.status === 'maintenance' || (room.rentalBasis === 'room' && others.length) || count + values.occupantCount + room.reservedSlots > room.capacity) fail('This room has no available capacity for these occupants.', 409);
        if (room.rentalBasis === 'bed') {
          const taken = new Set(others.map(tenant => tenant.bedNumber).filter(Boolean));
          values.bedNumber = body.bedNumber ? integer(body.bedNumber, 1, 'Bed number') : tenant?.roomId === room.id && tenant?.bedNumber || Array.from({ length: room.capacity }, (_,i) => i+1).find(n => !taken.has(n));
          if (!values.bedNumber || values.bedNumber > room.capacity || taken.has(values.bedNumber)) fail('This bed number is unavailable.', 409);
        } else values.bedNumber = null;
      }
    }
    for (const key of ['moveInDate','moveOutDate','contractStart','contractEnd']) if (values[key] === '') values[key] = null;
    if (values.email) values.email = values.email.trim().toLowerCase();
    const email = values.email ?? tenant?.email;
    if (email && values.status === 'active' && await OwnerTenant.findOne({ where: { ownerId, email, status: 'active', ...(id ? { id: { [Op.ne]: id } } : {}) }, transaction })) fail('This tenant already has an active record with this owner.', 409);
    if (!trustedUserId && !tenant?.tenantUserId && email) {
      const account = await User.findOne({ where: { email, accountType: 'tenant' }, transaction });
      if (account && await TenantApplication.findOne({ where: { tenantId: account.id, ownerId, status: 'confirmed' }, transaction })) values.tenantUserId = account.id;
    }
    const saved = tenant ? await tenant.update(values, { transaction }) : await OwnerTenant.create({ ...values, ownerId }, { transaction });
    await syncOccupancy(ownerId, [oldRoomId, saved.roomId], transaction);
    if (saved.tenantUserId) {
      const room = saved.roomId ? await ownedRoom(ownerId, saved.roomId, transaction) : null;
      const house = room ? await BoardingHouse.findByPk(room.boardingHouseId, { transaction }) : null;
      await TenantApplication.update({ roomId: saved.roomId, boardingHouseId: house?.id || null, boardingHouseName: house?.name || 'Boarding House', monthlyRent: saved.monthlyRent, status: values.status === 'active' ? 'confirmed' : 'cancelled_by_tenant' }, { where: { ownerId, tenantId: saved.tenantUserId, status: 'confirmed' }, transaction });
      await User.update({ selectedBoardingHouse: values.status === 'active' ? house?.name || null : null }, { where: { id: saved.tenantUserId }, transaction });
    }
    return saved;
  };
  return suppliedTransaction ? run(suppliedTransaction) : sequelize.transaction(run);
}
export async function removeRoom(ownerId, id) {
  return sequelize.transaction(async transaction => {
    await ownerLock(ownerId, transaction); const room = await ownedRoom(ownerId, id, transaction);
    if (await OwnerTenant.count({ where: { ownerId, roomId: id }, transaction }) || await TenantApplication.count({ where: { ownerId, roomId: id }, transaction }) || await OwnerPayment.count({ where: { ownerId, roomId: id }, transaction })) fail('This room has tenant, application, or billing history. Use maintenance status instead.', 409);
    const { Payment } = await import('../models/paymentModels.js');
    if (await Payment.count({ where: { ownerId, roomId: id }, transaction })) fail('This room has online payment history. Use maintenance status instead.', 409);
    await room.destroy({ transaction }); await syncOccupancy(ownerId, [], transaction);
  });
}

export async function offerApplication(ownerId, tenantUserId, body) {
  return sequelize.transaction(async transaction => {
    await ownerLock(ownerId, transaction);
    const app = await TenantApplication.findOne({ where: { ownerId, tenantId: tenantUserId, ...(body.applicationId ? { id: body.applicationId } : {}), status: { [Op.in]: ['pending_owner','accepted_by_owner'] } }, order: [['createdAt','DESC']], transaction, lock: transaction.LOCK.UPDATE });
    if (!app) fail('No pending application from this tenant to this owner.', 404);
    if (!body.roomId) fail('Choose a room to offer.');
    const room = await ownedRoom(ownerId, body.roomId, transaction);
    if (app.boardingHouseId && app.boardingHouseId !== room.boardingHouseId) fail('Offer a room in the boarding house the tenant applied to.');
    await syncOccupancy(ownerId, [room.id], transaction);
    await room.reload({ transaction });
    if (!room.availableSlots || room.status === 'maintenance') fail('This room is full or unavailable.', 409);
    const house = await BoardingHouse.findByPk(room.boardingHouseId, { transaction });
    if (house?.approvalStatus !== 'approved') fail('This branch must be approved before offering rooms.');
    const occupantCount = integer(body.occupantCount || 1, 1, 'Household occupants');
    if (occupantCount > room.capacity || (room.rentalBasis === 'bed' && occupantCount !== 1)) fail('The offered household size does not match this room.');
    await app.update({ occupantCount, status: 'accepted_by_owner', roomId: room.id, boardingHouseId: house.id, boardingHouseName: house.name, monthlyRent: money(body.monthlyRent ?? Number(room.rentalPrice)*(room.rentalBasis === 'person' ? occupantCount : 1)), moveInDate: body.moveInDate || null, ownerNotes: String(body.notes || '').slice(0,2000), acceptedAt: new Date() }, { transaction });
    return app;
  });
}
export async function confirmOffer(userId, applicationId) {
  const initial = await TenantApplication.findOne({ where: { id: applicationId, tenantId: userId } });
  if (!initial) fail('Application not found.', 404);
  return sequelize.transaction(async transaction => {
    const owner = await ownerLock(initial.ownerId, transaction);
    if (owner.isSuspended || owner.isArchived || owner.publicMapUnregistered || !['approved','approved_barangay'].includes(owner.applicationStatus)) fail('This establishment is not currently eligible for tenancy.');
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const app = await TenantApplication.findByPk(applicationId, { transaction, lock: transaction.LOCK.UPDATE });
    if (app.status === 'confirmed') return app;
    const branch = app.boardingHouseId ? await BoardingHouse.findByPk(app.boardingHouseId, { transaction }) : null;
    if (branch?.approvalStatus !== 'approved') fail('This branch is not currently approved.');
    if (app.status !== 'accepted_by_owner') fail('This offer is not available for confirmation.');
    const otherActive = await OwnerTenant.findOne({ where: { tenantUserId: userId, status: 'active' }, transaction });
    if (otherActive) fail('You already have an active tenancy. Arrange move-out before confirming another.', 409);
    const existing = await OwnerTenant.findOne({ where: { ownerId: app.ownerId, email: user.email }, transaction });
    await saveTenant(app.ownerId, existing?.id, { occupantCount: app.occupantCount || 1, fullName: user.fullName, email: user.email, contactNumber: user.contactNumber, roomId: app.roomId, monthlyRent: app.monthlyRent, moveInDate: app.moveInDate || new Date().toISOString().slice(0,10), status: 'active' }, { transaction, trustedUserId: userId });
    await app.update({ status: 'confirmed', confirmedAt: new Date() }, { transaction });
    await user.update({ selectedBoardingHouse: app.boardingHouseName, applicationStatus: 'approved' }, { transaction });
    await TenantApplication.update({ status: 'cancelled_by_tenant' }, { where: { tenantId: userId, id: { [Op.ne]: app.id }, status: { [Op.in]: ['pending_owner','accepted_by_owner'] } }, transaction });
    return app;
  });
}
export async function removeTenant(ownerId, id) {
  return sequelize.transaction(async transaction => {
    await ownerLock(ownerId, transaction);
    const tenant = await OwnerTenant.findOne({ where: { id, ownerId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!tenant) fail('Tenant not found.', 404);
    const { Payment } = await import('../models/paymentModels.js');
    if (await OwnerPayment.count({ where: { ownerId, tenantId: id }, transaction }) || await Payment.count({ where: { ownerId, ownerTenantId: id }, transaction }) || tenant.tenantUserId) fail('This tenant has linked history. Change status to moved_out instead of deleting.', 409);
    const roomId = tenant.roomId;
    await tenant.destroy({ transaction }); await syncOccupancy(ownerId, [roomId], transaction);
  });
}
