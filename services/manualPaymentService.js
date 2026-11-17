import { ownerPaymentConfig } from './ownerPaymentConfig.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/db.js';
import { OwnerPayment } from '../models/ownerModels.js';
import { Payment } from '../models/paymentModels.js';
import { fail, ownerLock } from './occupancyService.js';
import { findActiveRental } from './rentalIdentityService.js';
import { storeReviewFile } from './reviewFileService.js';

export function manilaToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function validatePaidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value ||
    value < '1000-01-01' || value > manilaToday()) fail('Enter a valid payment date on or before today.');
  return value;
}

export function paymentReference(value) {
  const reference = typeof value === 'string' ? value.trim() : '';
  if (!reference || reference.length > 100 || /[\u0000-\u001f\u007f]/.test(reference)) fail('Enter a valid GCash reference number (up to 100 characters).');
  return reference;
}

export async function assertReferenceAvailable(bill, reference, transaction) {
  const conflict = await OwnerPayment.findOne({
    where: { ownerId: bill.ownerId, id: { [Op.ne]: bill.id }, [Op.or]: [
      { method: 'GCash', reference },
      { status: 'pending', submittedMethod: 'GCash', submittedReference: reference }
    ] },
    attributes: ['id'], transaction
  });
  if (conflict) fail('This GCash reference is already attached to another bill.', 409);
}

export async function assertNoOnlineCheckout(bill, transaction) {
  const active = await Payment.count({
    where: { tenantPaymentId: bill.id, status: { [Op.in]: ['PENDING', 'PROCESSING'] } },
    transaction
  });
  if (active) fail('A previous online checkout is still open for this bill. The owner must reconcile it before accepting another payment.', 409);
}

export async function submitRentPayment(user, id, fields, proof) {
  const activeRental = await findActiveRental(user);
  if (!activeRental) fail('No active tenancy found.', 404);
  return sequelize.transaction(async transaction => {
    const owner = await ownerLock(activeRental.ownerId, transaction);
    const rental = await findActiveRental(user, { transaction, lock: transaction.LOCK.UPDATE });
    if (rental?.id !== activeRental.id) fail('Your rental assignment changed. Refresh and try again.', 409);
    const bill = await OwnerPayment.findOne({
      where: { id, tenantId: rental.id, ownerId: owner.id }, transaction, lock: transaction.LOCK.UPDATE
    });
    if (!bill) fail('Bill not found.', 404);
    if (bill.status !== 'pending') fail('This bill has already been paid.', 409);
    if (bill.submittedMethod) fail('This payment was already submitted for owner review.', 409);
    await assertNoOnlineCheckout(bill, transaction);

    const method = fields.method;
    if (!ownerPaymentConfig(owner).methods.includes(method)) fail('Select a payment method accepted by your owner.');
    const date = validatePaidDate(fields.paidDate);
    const gcash = method === 'GCash';
    const reference = gcash ? paymentReference(fields.reference) : null;
    if (gcash && !proof) fail('Upload your GCash proof of payment.');
    if (gcash) await assertReferenceAvailable(bill, reference, transaction);
    const paymentProofUrl = gcash ? await storeReviewFile(proof, user.id, 'payment-proof', transaction) : null;
    return bill.update({
      submittedMethod: method, submittedPaidDate: date, submittedReference: reference, paymentProofUrl
    }, { transaction });
  });
}
