import { Op, Transaction } from 'sequelize';
import { positivePaymentAmount } from './paymentAmounts.js';
import { storeReviewFile } from './reviewFileService.js';
import { User } from '../models/userModel.js';
import { BoardingHouse, OwnerRoom, OwnerPayment, OwnerTenant } from '../models/ownerModels.js';
import { TenantApplication } from '../models/tenantModels.js';
import { ownerPaymentConfig, usesPaymentQr } from './ownerPaymentConfig.js';

export const reservationRequested = body => body.reserveRoom === 'on' || body.reserveRoom === true;
export const reservationTransaction = { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED };

function reject(message, status = 422) {
  throw Object.assign(new Error(message), { status });
}

export function reservationStatus(application) {
  if (!application.reservationRoomId) return null;
  if (application.status === 'pending_owner') return 'pending';
  if (application.status === 'accepted_by_owner') return 'reserved';
  if (['confirmed', 'tenancy_ended'].includes(application.status)) return 'completed';
  return 'closed';
}

export async function getReservationQuote(houseKey, roomId, { transaction, ownerId } = {}) {
  const houseId = /^bh-([1-9]\d*)$/.exec(String(houseKey || ''))?.[1];
  if (!houseId || !/^[1-9]\d*$/.test(String(roomId || ''))) reject('Choose an available room or bedspace to reserve.');
  const houseFilter = { id: houseId, approvalStatus: 'approved', ...(ownerId ? { ownerId } : {}) };
  const location = await BoardingHouse.findOne({ where: houseFilter, transaction });
  if (!location) reject('This boarding house is unavailable for reservations.', 404);
  const lock = transaction ? { lock: transaction.LOCK.UPDATE } : {};
  const owner = await User.findOne({ where: {
    id: location.ownerId, accountType: 'boarding_house_owner', isArchived: false, isSuspended: false, publicMapUnregistered: false,
    applicationStatus: { [Op.in]: ['approved', 'approved_barangay'] }
  }, transaction, ...lock });
  if (!owner) reject('This boarding house is unavailable for reservations.', 404);
  const house = transaction ? await BoardingHouse.findOne({ where: { ...houseFilter, ownerId: owner.id }, transaction, ...lock }) : location;
  if (!house) reject('This boarding house is unavailable for reservations.', 404);
  const room = await OwnerRoom.findOne({ where: { id: roomId, ownerId: owner.id,
    boardingHouseId: house.id }, transaction, ...lock });
  if (!room || room.status !== 'available' || !room.availableSlots) reject('This room or slot is no longer available.', 409);
  const fallback = room.rentalBasis === 'room' ? house.rentPerRoom ?? owner.rentPerRoom : house.rentPerHead ?? owner.rentPerHead;
  const monthlyRent = Number(room.rentalPrice) || Number(fallback);
  const fee = Math.round(Math.round(monthlyRent * 100) / 10) / 100;
  if (!Number.isFinite(fee) || fee <= 0) reject('Ask the owner to set a monthly rate before reserving this room.');
  const payment = ownerPaymentConfig(owner);
  if (!payment.methods.length) reject('The owner has no configured reservation payment method.');
  return { owner, house, room, monthlyRent, fee, payment };
}

export async function assertReservationReferenceAvailable(ownerId, method, reference, transaction) {
  const conflicting = await TenantApplication.findOne({ where: { ownerId, reservationMethod: method,
    reservationReference: reference, [Op.or]: [{ status: 'pending_owner' }, { reservationApprovedAt: { [Op.ne]: null } }] },
  attributes: ['id'], transaction });
  if (conflicting) reject(`This ${method} reference is already attached to a reservation.`, 409);
}

export async function reservationFields(user, details, body, transaction) {
  if (!reservationRequested(body)) return {};
  const quote = await getReservationQuote(`bh-${details?.boardingHouseId}`, body.requestedRoomId, { transaction, ownerId: details?.ownerId });
  if (Math.round(Number(body.reservationFee) * 100) !== Math.round(quote.fee * 100)) reject('The reservation fee changed. Check the updated quote before submitting.', 409);
  const existing = await TenantApplication.findOne({ where: { tenantId: user.id, reservationRoomId: { [Op.ne]: null },
    status: { [Op.in]: ['pending_owner', 'accepted_by_owner'] } }, attributes: ['id'], transaction });
  if (existing) reject('You already have an open reservation request. Close it before requesting another.', 409);
  const activeStay = await OwnerTenant.count({ where: { status: 'active',
    [Op.or]: [{ tenantUserId: user.id }, { tenantUserId: null, email: user.email }] }, transaction });
  if (activeStay) reject('Record move-out from your current stay before reserving a room.', 409);
  const method = body.reservationMethod;
  if (!quote.payment.methods.includes(method)) reject('Choose a payment method accepted by this property.');
  let reference = null;
  if (usesPaymentQr(method)) {
    reference = typeof body.reservationReference === 'string' ? body.reservationReference.trim() : '';
    if (method === 'GCash' ? !/^\d{13}$/.test(reference) : !/^[a-z0-9]{1,100}$/i.test(reference)) {
      reject(method === 'GCash' ? 'Enter the 13-digit GCash reference number.' : 'Enter the letters or numbers from your QR Ph reference.');
    }
    await assertReservationReferenceAvailable(quote.owner.id, method, reference, transaction);
    const bill = await OwnerPayment.findOne({ where: { ownerId: quote.owner.id, [Op.or]: [
      { method, reference }, { status: 'pending', submittedMethod: method, submittedReference: reference,
        [Op.or]: [{ reviewStatus: { [Op.ne]: 'declined' } }, { reviewStatus: null }] }
    ] }, attributes: ['id'], transaction });
    if (bill) reject(`This ${method} reference is already attached to a rent payment.`, 409);
  }
  const submittedAmount = body.reservationPaidAmount === undefined ? quote.fee : positivePaymentAmount(body.reservationPaidAmount);
  return { reservationRoomId: quote.room.id, reservationFee: quote.fee, reservationRent: quote.monthlyRent,
    reservationMethod: method, reservationReference: reference, reservationSubmittedAmount: submittedAmount };
}

export async function storeReservationProof(userId, reservation, body, proof, transaction) {
  if (!reservation.reservationRoomId) return null;
  if (usesPaymentQr(reservation.reservationMethod) && body.reservationPaidAmount !== undefined && !proof) {
    reject('Upload your reservation proof of payment.');
  }
  return storeReviewFile(proof, userId, 'reservation-proof', transaction);
}
