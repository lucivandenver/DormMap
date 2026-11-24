import { randomUUID } from 'node:crypto';
import { positivePaymentAmount, rentBillTotal } from './paymentAmounts.js';
import { User } from '../models/userModel.js';
import { BarangayNotification } from '../models/adminModels.js';
import { ownerPaymentConfig, usesPaymentQr } from './ownerPaymentConfig.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/db.js';
import { OwnerNotification, OwnerPayment } from '../models/ownerModels.js';
import { Payment } from '../models/paymentModels.js';
import { fail, ownerLock } from './occupancyService.js';
import { findActiveRental } from './rentalIdentityService.js';
import { storeReviewFile } from './reviewFileService.js';
import { assertReservationReferenceAvailable } from './tenantReservationService.js';

export function manilaToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function validatePaidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value ||
    value < '1000-01-01' || value > manilaToday()) fail('Enter a valid payment date on or before today.');
  return value;
}

export function paymentReference(value, method = 'GCash') {
  const reference = typeof value === 'string' ? value.trim() : '';
  if (!reference || reference.length > 100 || /[\u0000-\u001f\u007f]/.test(reference)) fail(`Enter a valid ${method} reference number (up to 100 characters).`);
  return reference;
}

export async function assertReferenceAvailable(bill, method, reference, transaction) {
  await assertReservationReferenceAvailable(bill.ownerId, method, reference, transaction);
  const conflict = await OwnerPayment.findOne({
    where: { ownerId: bill.ownerId, id: { [Op.ne]: bill.id }, [Op.or]: [
      { method, reference },
      { status: 'pending', submittedMethod: method, submittedReference: reference,
        [Op.or]: [{ reviewStatus: { [Op.ne]: 'declined' } }, { reviewStatus: null }] }
    ] },
    attributes: ['id'], transaction
  });
  if (conflict) fail(`This ${method} reference is already attached to another bill.`, 409);
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
    if (bill.submittedMethod && bill.reviewStatus !== 'declined') fail('This payment was already submitted for owner review.', 409);

    const method = fields.method;
    if (!ownerPaymentConfig(owner).methods.includes(method)) fail('Select a payment method accepted by your owner.');
    const date = validatePaidDate(fields.paidDate);
    const submittedAmount = fields.amountPaid === undefined ? rentBillTotal(bill) : positivePaymentAmount(fields.amountPaid);
    const qrPayment = usesPaymentQr(method);
    if (method === 'GCash' && (typeof fields.reference !== 'string' || !/^[0-9]{13}$/.test(fields.reference.trim()))) {
      fail('Enter the 13-digit GCash reference number.');
    }
    const reference = qrPayment ? paymentReference(fields.reference, method) : null;
    if (qrPayment && !proof) fail(`Upload your ${method} proof of payment.`);
    if (qrPayment) await assertReferenceAvailable(bill, method, reference, transaction);
    const paymentProofUrl = qrPayment ? await storeReviewFile(proof, user.id, 'payment-proof', transaction) : null;
    const submissionNotes = paymentNotes(fields.notes);
    await bill.update({
      submissionId: randomUUID(), submissionNotes, reviewStatus: 'submitted', reviewDate: null, reviewNotes: null,
      submittedMethod: method, submittedPaidDate: date, submittedReference: reference, submittedAmount, paymentProofUrl
    }, { transaction });
    await OwnerNotification.create({
      ownerId: owner.id, title: 'Rent payment submitted',
      body: `${user.fullName} submitted a ${method === 'Cash' ? 'Cash on Hand' : method} payment for ${bill.month || bill.dueDate}. Open Payments to review the details.`,
      type: 'payment_submitted', link: '#payments'
    }, { transaction });
    return bill;
  });
}

export function paymentNotes(value, required = false) {
  const notes = typeof value === 'string' ? value.trim() : '';
  if (notes.length > 2000) fail('Keep payment notes within 2,000 characters.');
  if (required && !notes) fail('Enter a reason so the tenant knows why the payment was declined.');
  return notes || null;
}

export function assertCurrentSubmission(bill, fields) {
  if (Object.hasOwn(fields, 'submissionId') && (fields.submissionId || null) !== (bill.submissionId || null)) {
    fail('The payment submission changed. Close this review and open it again.', 409);
  }
}

export async function notifyPaymentReview(bill, tenant, decision, transaction) {
  let tenantId = tenant.tenantUserId;
  if (!tenantId && tenant.email) {
    const account = await User.findOne({
      where: { accountType: 'tenant', email: tenant.email.trim().toLowerCase() }, transaction
    });
    if (account && (await findActiveRental(account, { transaction }))?.id === tenant.id) tenantId = account.id;
  }
  if (!tenantId) return;
  const confirmed = decision === 'confirmed';
  await BarangayNotification.create({
    userId: tenantId,
    title: confirmed ? 'Rent payment confirmed' : 'Rent payment declined',
    body: `Your payment for ${bill.month || bill.dueDate} was ${decision} on ${bill.reviewDate}.${bill.reviewNotes ? ' Owner notes: ' + bill.reviewNotes : ''}${confirmed ? '' : ' Review the notes and submit your payment details again.'}`,
    type: confirmed ? 'payment_confirmed' : 'payment_declined', link: '#payments'
  }, { transaction });
}

// Tenant submissions can be received while an older checkout is open.
// Settlement still requires the old checkout to be closed by the provider.
export async function prepareManualConfirmation(ownerId, id, fields) {
  const bill = await OwnerPayment.findOne({ where: { id, ownerId } });
  if (!bill) fail('Bill not found.', 404);
  assertCurrentSubmission(bill, fields);
  if (bill.status === 'paid') return;
  if (fields.amountPaid !== undefined) positivePaymentAmount(fields.amountPaid);
  if (bill.reviewStatus === 'declined') fail('Wait for the tenant to submit updated payment details.', 409);
  const checkouts = await Payment.findAll({
    where: { tenantPaymentId: bill.id, ownerId, status: { [Op.in]: ['PENDING', 'PROCESSING'] } }
  });
  if (!checkouts.length) return;
  const { expireUnpaidPaymongoCheckout } = await import('./paymongoService.js');
  const { handlePaymongoWebhookPayload } = await import('./paymentService.js');
  for (const checkout of checkouts) {
    if (!checkout.paymongoCheckoutId) fail('Review the previous online checkout before confirming this payment.', 409);
    try {
      await expireUnpaidPaymongoCheckout(checkout.paymongoCheckoutId);
    } catch {
      fail('Payment details are saved. Sync the previous checkout under Previous online checkouts, then review this payment again.', 409);
    }
    await handlePaymongoWebhookPayload({ data: { attributes: {
      type: 'checkout_session.expired', data: { id: checkout.paymongoCheckoutId }
    } } });
  }
}
