import { findActiveRental } from './rentalIdentityService.js';
import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { OwnerTenant, OwnerRoom, OwnerPayment } from '../models/ownerModels.js';
import { Payment, PaymentWebhook, PaymentAuditLog } from '../models/paymentModels.js';
import { generatePaymentReference } from '../utils/paymentReference.js';
import { PAYMENT_STATUS } from '../utils/paymentStatus.js';
import { createPaymongoCheckoutSession } from './paymongoService.js';
import { createPaymentReceipt } from './receiptService.js';
import { sendPaymentNotification } from './notificationService.js';
import { emitToUser } from './websocketService.js';


/**
 * Initiates a GCash payment for tenant rent via PayMongo Checkout Session
 */
export const initiateRentPayment = async ({ user, billingMonth, tenantPaymentId }) => sequelize.transaction(async transaction => {
  await User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE });
  const tenantRec = await findActiveRental(user, { transaction });
  if (!tenantRec) throw new Error('No active rental record is linked to your account.');
  const owner = await User.findByPk(tenantRec.ownerId, { transaction });
  if (!owner || owner.isSuspended || owner.isArchived || owner.publicMapUnregistered || !['approved','approved_barangay'].includes(owner.applicationStatus)) throw new Error('This owner is not currently eligible for online rent collection.');
  const room = tenantRec.roomId ? await OwnerRoom.findOne({ where: { id: tenantRec.roomId, ownerId: owner.id }, transaction }) : null;
  if (tenantRec.roomId && !room) throw new Error('Your room assignment needs correction by the owner.');
  const month = billingMonth || new Date().toISOString().slice(0,7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid billing month (YYYY-MM).');
  let bill = null;
  if (tenantPaymentId) {
    bill = await OwnerPayment.findOne({ where: { id: tenantPaymentId, ownerId: owner.id, tenantId: tenantRec.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!bill) throw new Error('This billing record does not belong to your tenancy.');
    if (bill.status === 'paid') throw new Error('This billing record is already paid.');
    if (bill.month && bill.month !== month) throw new Error('The selected month does not match this bill.');
  }
  const baseAmount = Number(bill ? bill.amount : tenantRec.monthlyRent ?? room?.rentalPrice ?? 0);
  const penaltyAmount = Number(bill?.penalty || 0);
  const amount = Math.round((baseAmount + penaltyAmount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('A positive rent amount must be set by the owner.');
  const checkoutKey = bill ? `bill-${bill.id}` : `rent-${user.id}-${owner.id}-${month}`;
  let payment = await Payment.findOne({ where: { checkoutKey }, transaction, lock: transaction.LOCK.UPDATE });
  // Include pre-upgrade records so deployment cannot restart a settled charge.
  if (!payment) payment = await Payment.findOne({ where: { tenantId: user.id, ownerId: owner.id, billingMonth: month, ...(bill ? { tenantPaymentId: bill.id } : { tenantPaymentId: null }), status: ['PENDING','PROCESSING','SUCCEEDED'] }, transaction, lock: transaction.LOCK.UPDATE });
  if (payment?.status === 'SUCCEEDED') throw new Error('This rent charge has already been paid.');
  if (payment?.checkoutUrl && ['PENDING','PROCESSING'].includes(payment.status) ) return { payment, checkoutUrl: payment.checkoutUrl, isExisting: true };
  const reference = payment?.internalReference || generatePaymentReference(month);
  const baseUrl = (process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successReturnUrl = `${baseUrl}/payments/processing?ref=${reference}`;
  const failureReturnUrl = `${baseUrl}/payments/failure?ref=${reference}`;
  const session = await createPaymongoCheckoutSession({ reference, amount, description: `Rent for ${owner.boardingHouseName || 'Boarding House'} — ${month}`, billing: { name: user.fullName, email: user.email, phone: user.contactNumber || '' }, successReturnUrl, failureReturnUrl, metadata: { owner_id: owner.id, tenant_id: user.id, owner_tenant_id: tenantRec.id, billing_month: month } });
  if (!session.checkout_url || !session.id) throw new Error('Payment provider did not return a checkout session.');
  const values = { checkoutKey, ownerTenantId: tenantRec.id, tenantId: user.id, ownerId: owner.id, roomId: tenantRec.roomId, tenantPaymentId: bill?.id || null, billingMonth: month, billingYear: Number(month.slice(0,4)), internalReference: reference, paymongoCheckoutId: session.id, paymentMethod: 'GCASH', paymentChannel: 'GCASH', currency: 'PHP', amount, baseAmount, penaltyAmount, status: 'PENDING', checkoutUrl: session.checkout_url, successReturnUrl, failureReturnUrl, expiresAt: null };
  payment = payment ? await payment.update(values, { transaction }) : await Payment.create(values, { transaction });
  await PaymentAuditLog.create({ paymentId: payment.id, userId: user.id, action: 'PAYMENT_CREATED', metadata: { reference, amount } }, { transaction });
  return { payment, checkoutUrl: payment.checkoutUrl, isExisting: false };
});

/**
 * Handles Webhooks from PayMongo with Idempotency Protection & Transactions
 */
export const handlePaymongoWebhookPayload = async payload => {
  const event = payload?.data?.attributes;
  const eventType = event?.type;
  const session = event?.data;
  if (!['checkout_session.payment.paid','checkout_session.expired','checkout_session.payment.failed'].includes(eventType)) return { success: true, ignored: true };
  if (!session?.id) throw new Error('Missing checkout session identifier.');
  const attributes = session.attributes || {};
  const outcome = await sequelize.transaction(async transaction => {
    const payment = await Payment.findOne({ where: { paymongoCheckoutId: session.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!payment) throw new Error('Checkout session is not yet linked. Retry the webhook.');
    if (attributes.reference_number && attributes.reference_number !== payment.internalReference) throw new Error('Checkout reference mismatch.');
    const webhook = await PaymentWebhook.create({ eventType, paymongoEventId: payload.data.id || null, paymentId: payment.id, payload, processed: false }, { transaction });
    if (payment.status === 'SUCCEEDED') {
      await webhook.update({ processed: true, processedAt: new Date() }, { transaction });
      return { payment, duplicate: true };
    }
    if (eventType === 'checkout_session.payment.paid') {
      const paid = attributes.payments?.find(item => item.attributes?.status === 'paid') || attributes.payments?.[0];
      const paidAmount = Number(paid?.attributes?.amount);
      if (!paid?.id || paid?.attributes?.status !== 'paid' || !Number.isInteger(paidAmount) || paidAmount !== Math.round(Number(payment.amount)*100) || paid.attributes.currency !== 'PHP') throw new Error('Paid amount, currency, or status does not match this charge.');
      const tenantUser = await User.findByPk(payment.tenantId, { transaction });
      const tenant = payment.ownerTenantId ? await OwnerTenant.findOne({ where: { id: payment.ownerTenantId, ownerId: payment.ownerId }, transaction, lock: transaction.LOCK.UPDATE }) : await findActiveRental(tenantUser, { transaction, lock: transaction.LOCK.UPDATE });
      if (!tenant || tenant.ownerId !== payment.ownerId) throw new Error('The payment tenancy cannot be reconciled.');
      let bill = payment.tenantPaymentId ? await OwnerPayment.findOne({ where: { id: payment.tenantPaymentId, ownerId: payment.ownerId, tenantId: tenant.id }, transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (payment.tenantPaymentId && !bill) throw new Error('The linked bill is missing.');
      const paidAt = new Date();
      if (bill && bill.status === 'paid' && bill.reference !== payment.internalReference) throw new Error('This bill was settled through another payment; manual reconciliation is required.');
      if (bill) await bill.update({ status: 'paid', paidDate: paidAt, method: 'GCash Online', reference: payment.internalReference }, { transaction });
      else {
        bill = await OwnerPayment.create({ ownerId: payment.ownerId, tenantId: tenant.id, roomId: payment.roomId, amount: payment.baseAmount, penalty: payment.penaltyAmount, dueDate: paidAt, paidDate: paidAt, status: 'paid', method: 'GCash Online', reference: payment.internalReference, month: payment.billingMonth }, { transaction });
        payment.tenantPaymentId = bill.id;
      }
      await tenant.update({ balance: Math.max(0, Number(tenant.balance)-Number(payment.amount)) }, { transaction });
      await payment.update({ status: 'SUCCEEDED', paidAt, paymongoPaymentId: paid.id, tenantPaymentId: bill.id, ownerTenantId: tenant.id }, { transaction });
      await createPaymentReceipt({ payment, transaction });
    } else {
      await payment.update({ status: eventType.endsWith('expired') ? 'EXPIRED' : 'FAILED', failureReason: 'Payment provider reported an unsuccessful checkout.' }, { transaction });
    }
    await webhook.update({ processed: true, processedAt: new Date() }, { transaction });
    return { payment, duplicate: false };
  });
  if (!outcome.duplicate && outcome.payment.status === 'SUCCEEDED') {
    const payment = outcome.payment;
    emitToUser(payment.tenantId, 'payment_completed', { paymentId: payment.id, amount: payment.amount, status: payment.status });
    emitToUser(payment.ownerId, 'payment_completed', { paymentId: payment.id, amount: payment.amount, status: payment.status });
    await sendPaymentNotification({ tenantId: payment.tenantId, ownerId: payment.ownerId, title: 'Rent payment received', body: `GCash payment ${payment.internalReference} for ${payment.billingMonth} has been reconciled.`, type: 'payment_success', link: '#payments' }).catch(error => console.error('Payment notification failed:', error.message));
  }
  return { success: true, status: outcome.payment.status, duplicate: outcome.duplicate };
};

// Export alias for backward compatibility if imported elsewhere
export const handleXenditWebhookPayload = handlePaymongoWebhookPayload;

/**
 * Retrieves the landlord's custom GCash account details for a given tenant.
 * Uses the tenant's OwnerTenant record to find their specific owner.
 */
export const getLandlordGcashDetails = async (user) => {
  const tenantRec = await findActiveRental(user);

  if (!tenantRec) {
    throw new Error('No active rental record found for your tenant account.');
  }

  const owner = await User.findByPk(tenantRec.ownerId, {
    attributes: ['id', 'fullName', 'boardingHouseName', 'contactNumber', 'gcashNumber', 'gcashName', 'gcashQrCode']
  });

  if (!owner) {
    throw new Error('Boarding house owner record not found.');
  }

  return {
    ownerId: owner.id,
    ownerName: owner.fullName,
    boardingHouseName: owner.boardingHouseName,
    contactNumber: owner.contactNumber,
    gcashNumber: owner.gcashNumber || '',
    gcashName: owner.gcashName || '',
    gcashQrCode: owner.gcashQrCode || null
  };
};

