import bcrypt from 'bcrypt';
import { User, sequelize } from '../models/userModel.js';
import { BoardingHouse, OwnerRoom } from '../models/ownerModels.js';
import { fail, offerMoveInDate, ownerLock, saveTenant } from './occupancyService.js';
import { createTenantApplication, registrationApplicationDetails } from './tenantApplicationService.js';
import { reservationFields, reservationTransaction } from './tenantReservationService.js';

export const validWalkInPassword = value => typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;

async function temporaryHash(password) {
  if (!validWalkInPassword(password)) fail('Use a temporary password of at least 8 characters and at most 72 bytes.');
  return bcrypt.hash(password, 12);
}

export async function createWalkInTenant(ownerId, body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const contact = typeof body.contactNumber === 'string' ? body.contactNumber.trim() : '';
  if (!fullName || fullName.length > 255 || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a tenant name and a valid email address.');
  if (contact.length > 24) fail('Enter a valid contact number.');
  if (!['assign', 'reserve'].includes(body.mode)) fail('Choose whether to assign or reserve the room.');
  if (!/^[1-9]\d*$/.test(String(body.roomId || ''))) fail('Choose an available room or bedspace.');
  const moveInDate = offerMoveInDate(body.moveInDate);
  const password = await temporaryHash(body.temporaryPassword);

  return sequelize.transaction(body.mode === 'reserve' ? reservationTransaction : {}, async transaction => {
    const owner = await ownerLock(ownerId, transaction);
    if (owner.isArchived || owner.isSuspended || owner.publicMapUnregistered || !['approved', 'approved_barangay'].includes(owner.applicationStatus)) fail('An approved owner account is required.', 403);
    if (await User.findOne({ where: { email }, attributes: ['id'], transaction })) fail('That email already has an account. Ask the tenant to use their own login and send an inquiry.', 409);
    const room = await OwnerRoom.findOne({ where: { id: body.roomId, ownerId }, transaction });
    const house = room?.boardingHouseId && await BoardingHouse.findOne({ where: { id: room.boardingHouseId, ownerId, approvalStatus: 'approved' }, transaction });
    if (!house || room.status !== 'available' || !room.availableSlots) fail('Choose an available room from an approved branch.', 409);

    const user = await User.create({ fullName, email, password, contactNumber: contact || null,
      accountType: 'tenant', emailVerified: false, walkInOwnerId: ownerId, walkInPasswordPending: true,
      applicationStatus: body.mode === 'assign' ? 'approved' : 'pending_owner', selectedBoardingHouse: house.name
    }, { transaction });

    if (body.mode === 'reserve') {
      const details = await registrationApplicationDetails({ selectedBoardingHouse: `bh-${house.id}`, requestedRoomId: room.id }, transaction);
      const fields = await reservationFields(user, details, { ...body, reserveRoom: true, requestedRoomId: room.id }, transaction);
      const { application } = await createTenantApplication({ ...details, ...fields, tenantId: user.id, moveInDate,
        message: 'Walk-in reservation recorded by the owner.' }, { transaction });
      return { userId: user.id, applicationId: application.id };
    }

    const stay = await saveTenant(ownerId, null, {
      fullName, email, contactNumber: contact || null, roomId: room.id, moveInDate,
      monthlyRent: body.monthlyRent === '' || body.monthlyRent == null ? room.rentalPrice : body.monthlyRent,
      status: 'active'
    }, { transaction, trustedUserId: user.id });
    return { userId: user.id, stayId: stay.id };
  });
}

export async function editWalkInPassword(ownerId, userId, password) {
  const [updated] = await User.update({ password: await temporaryHash(password), resetPasswordToken: null, resetPasswordExpires: null }, {
    where: { id: userId, accountType: 'tenant', walkInOwnerId: ownerId, walkInPasswordPending: true, isArchived: false, isSuspended: false }
  });
  if (!updated) fail('The temporary password can only be changed by the originating owner before the tenant claims the account.', 409);
}
