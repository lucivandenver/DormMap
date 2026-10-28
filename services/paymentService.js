import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { OwnerTenant, OwnerRoom, OwnerPayment } from '../models/ownerModels.js';
import { Payment, PaymentWebhook, PaymentAuditLog } from '../models/paymentModels.js';
import { generatePaymentReference } from '../utils/paymentReference.js';
import { PAYMENT_STATUS } from '../utils/paymentStatus.js';
import { createPaymongoCheckoutSession, getPaymongoCheckoutStatus } from './paymongoService.js';
import { createPaymentReceipt } from './receiptService.js';
import { sendPaymentNotification } from './notificationService.js';
import { emitToUser } from './websocketService.js';

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

/**
 * Initiates a GCash payment for tenant rent via PayMongo Checkout Session
 */
export const initiateRentPayment = async ({ user, billingMonth, tenantPaymentId }) => {
  // 1. Get Tenant Record from MySQL to ensure authentic rent calculation (case-insensitive email match)
  const tenantRec = await OwnerTenant.findOne({
    where: {
      [sequelize.Sequelize.Op.or]: [
        sequelize.where(
          sequelize.fn('LOWER', sequelize.col('email')),
          user.email.toLowerCase().trim()
        ),
        ...(user.contactNumber ? [{ contactNumber: user.contactNumber }] : [])
      ],
      status: 'active'
    }
  });

  if (!tenantRec) {
    throw new Error('No active rental record found for your tenant account.');
  }

  // 2. Fetch room & owner details
  const room = tenantRec.roomId ? await OwnerRoom.findByPk(tenantRec.roomId) : null;
  const ownerId = tenantRec.ownerId;
  const owner = await User.findByPk(ownerId);

  if (!owner) {
    throw new Error('Boarding house owner record is missing.');
  }

  // 3. Find or compute payment obligation
  let baseAmount = Number(tenantRec.monthlyRent || room?.rentalPrice || 0);
  let penaltyAmount = 0;
  let targetTenantPayment = null;

  if (tenantPaymentId) {
    targetTenantPayment = await OwnerPayment.findByPk(tenantPaymentId);
    if (targetTenantPayment) {
      baseAmount = Number(targetTenantPayment.amount);
      penaltyAmount = Number(targetTenantPayment.penalty || 0);
    }
  }

  const totalAmount = baseAmount + penaltyAmount;
  if (totalAmount <= 0) {
    throw new Error('Invalid payment amount calculated.');
  }

  const currentMonth = billingMonth || new Date().toISOString().slice(0, 7);
  const currentYear = new Date().getFullYear();

  // 4. Idempotency Check: Check existing active payment
  const existingActivePayment = await Payment.findOne({
    where: {
      tenantId: user.id,
      billingMonth: currentMonth,
      status: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING, PAYMENT_STATUS.SUCCEEDED]
    }
  });

  if (existingActivePayment) {
    if (existingActivePayment.status === PAYMENT_STATUS.SUCCEEDED) {
      throw new Error(`Rent for ${currentMonth} has already been paid successfully!`);
    }

    // Only reuse existing URL if it is a genuine external PayMongo checkout session or GCash portal
    if (
      existingActivePayment.checkoutUrl &&
      existingActivePayment.checkoutUrl.startsWith('http') &&
      (existingActivePayment.checkoutUrl.includes('paymongo.com') || existingActivePayment.checkoutUrl.includes('gcash-portal'))
    ) {
      return {
        payment: existingActivePayment,
        checkoutUrl: existingActivePayment.checkoutUrl,
        isExisting: true
      };
    }
  }

  // 5. Generate internal payment reference
  const internalReference = existingActivePayment?.internalReference || generatePaymentReference(currentMonth);

  // 6. Define return URLs
  const successReturnUrl = `${APP_BASE_URL}/payments/processing?ref=${internalReference}`;
  const failureReturnUrl = `${APP_BASE_URL}/payments/failure?ref=${internalReference}`;

  // 7. Call PayMongo API service for fresh Checkout Session
  const paymongoSession = await createPaymongoCheckoutSession({
    reference: internalReference,
    amount: totalAmount,
    description: `Rent payment for ${owner.boardingHouseName || 'Boarding House'} (Owner: ${owner.fullName}${owner.gcashNumber ? ` - GCash: ${owner.gcashNumber}` : ''}) - Month: ${currentMonth}`,
    billing: {
      name: user.fullName || '',
      email: user.email || '',
      phone: user.contactNumber || ''
    },
    successReturnUrl,
    failureReturnUrl,
    metadata: {
      owner_id: owner.id,
      owner_name: owner.fullName || '',
      owner_gcash_number: owner.gcashNumber || '',
      owner_gcash_name: owner.gcashName || '',
      boarding_house: owner.boardingHouseName || '',
      tenant_id: user.id,
      tenant_name: user.fullName || ''
    }
  });

  const checkoutUrl = paymongoSession.checkout_url || successReturnUrl;

  // 8. If updating existing pending payment without URL
  if (existingActivePayment) {
    existingActivePayment.checkoutUrl = checkoutUrl;
    existingActivePayment.paymongoCheckoutId = paymongoSession.id || null;
    await existingActivePayment.save();
    return { payment: existingActivePayment, checkoutUrl, isExisting: true };
  }

  // Save new Payment Record to MySQL
  const payment = await Payment.create({
    tenantId: user.id,
    ownerId: owner.id,
    roomId: tenantRec.roomId || null,
    tenantPaymentId: targetTenantPayment ? targetTenantPayment.id : null,
    billingMonth: currentMonth,
    billingYear: currentYear,
    internalReference,
    paymongoCheckoutId: paymongoSession.id || null,
    paymentMethod: 'GCASH',
    paymentChannel: 'GCASH',
    currency: 'PHP',
    amount: totalAmount,
    baseAmount,
    penaltyAmount,
    status: PAYMENT_STATUS.PENDING,
    checkoutUrl,
    successReturnUrl,
    failureReturnUrl,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 Hours expiry
  });

  // Audit Log
  await PaymentAuditLog.create({
    paymentId: payment.id,
    userId: user.id,
    action: 'PAYMENT_CREATED',
    metadata: { internalReference, totalAmount, checkoutUrl, paymongoCheckoutId: paymongoSession.id }
  }).catch(() => {});

  return { payment, checkoutUrl, isExisting: false };
};

/**
 * Handles Webhooks from PayMongo with Idempotency Protection & Transactions
 */
export const handlePaymongoWebhookPayload = async (payload) => {
  const eventAttributes = payload?.data?.attributes || {};
  const eventType = eventAttributes.type || payload.event || payload.type || 'checkout_session.payment.paid';
  const innerData = eventAttributes.data || payload.data || payload;
  const innerAttributes = innerData.attributes || {};

  const referenceId = innerAttributes.reference_number || innerAttributes.reference_id || innerAttributes.external_id;
  const paymongoCheckoutId = innerData.id;
  const paymongoPaymentId = innerAttributes.payments?.[0]?.id || innerData.id;

  // Log raw webhook
  const webhookRecord = await PaymentWebhook.create({
    eventType,
    paymongoEventId: payload.data?.id || null,
    paymongoPaymentId,
    payload,
    processed: false
  });

  if (!referenceId && !paymongoCheckoutId) {
    return { success: false, reason: 'Missing reference_number or checkout session ID in webhook payload' };
  }

  // Find DormMap payment
  const payment = await Payment.findOne({
    where: {
      [sequelize.Sequelize.Op.or]: [
        ...(referenceId ? [{ internalReference: referenceId }] : []),
        ...(paymongoCheckoutId ? [{ paymongoCheckoutId }] : []),
        ...(paymongoPaymentId ? [{ paymongoPaymentId }] : [])
      ]
    }
  });

  if (!payment) {
    return { success: false, reason: `No matching payment record for reference: ${referenceId || paymongoCheckoutId}` };
  }

  // Idempotency Check: Don't process already succeeded payments twice
  if (payment.status === PAYMENT_STATUS.SUCCEEDED && (eventType.includes('paid') || eventType.includes('succeeded') || eventType.includes('capture'))) {
    await webhookRecord.update({ processed: true, processedAt: new Date(), paymentId: payment.id });
    return { success: true, message: 'Payment already processed cleanly.' };
  }

  const transaction = await sequelize.transaction();

  try {
    const isSuccess = eventType.includes('paid') || eventType.includes('succeeded') || eventType.includes('capture') || innerAttributes.status === 'paid';
    const isFailure = eventType.includes('failed') || eventType.includes('failure') || innerAttributes.status === 'failed';
    const isExpired = eventType.includes('expired') || innerAttributes.status === 'expired';

    if (isSuccess) {
      payment.status = PAYMENT_STATUS.SUCCEEDED;
      payment.paidAt = new Date();
      payment.paymongoPaymentId = paymongoPaymentId;
      await payment.save({ transaction });

      // Update linked OwnerPayment record
      if (payment.tenantPaymentId) {
        await OwnerPayment.update(
          { status: 'paid', paidDate: new Date(), method: 'GCash Online', reference: payment.internalReference },
          { where: { id: payment.tenantPaymentId }, transaction }
        );
      } else {
        // Create new OwnerPayment entry if missing
        await OwnerPayment.create({
          ownerId: payment.ownerId,
          tenantId: payment.tenantId,
          roomId: payment.roomId,
          amount: payment.amount,
          dueDate: new Date(),
          paidDate: new Date(),
          status: 'paid',
          penalty: payment.penaltyAmount,
          method: 'GCash Online',
          reference: payment.internalReference,
          month: payment.billingMonth
        }, { transaction });
      }

      // Deduct balance from OwnerTenant
      const tenantRec = await OwnerTenant.findOne({ where: { ownerId: payment.ownerId } });
      if (tenantRec && tenantRec.balance > 0) {
        const newBalance = Math.max(0, Number(tenantRec.balance) - Number(payment.amount));
        await tenantRec.update({ balance: newBalance }, { transaction });
      }

      // Commit DB Transaction
      await transaction.commit();

      // Generate Receipt
      const tenant = await User.findByPk(payment.tenantId);
      const owner = await User.findByPk(payment.ownerId);
      const room = payment.roomId ? await OwnerRoom.findByPk(payment.roomId) : null;
      await createPaymentReceipt({ payment, tenant, owner, room });

      // Real-time Notifications
      await sendPaymentNotification({
        tenantId: payment.tenantId,
        ownerId: payment.ownerId,
        title: '✅ Rent Payment Successful',
        body: `${tenant?.fullName || 'Tenant'} successfully paid ₱${Number(payment.amount).toLocaleString('en-US', {minimumFractionDigits: 2})} via GCash for ${payment.billingMonth}.`,
        type: 'payment_success',
        link: '#payments'
      });

      // Emit Live WebSocket Events
      emitToUser(payment.tenantId, 'payment_completed', {
        paymentId: payment.id,
        amount: payment.amount,
        billingMonth: payment.billingMonth,
        reference: payment.internalReference,
        status: 'SUCCEEDED'
      });
      emitToUser(payment.ownerId, 'payment_completed', {
        paymentId: payment.id,
        tenantName: tenant?.fullName || 'Tenant',
        amount: payment.amount,
        billingMonth: payment.billingMonth,
        reference: payment.internalReference,
        status: 'SUCCEEDED'
      });

    } else if (isFailure || isExpired) {
      payment.status = isExpired ? PAYMENT_STATUS.EXPIRED : PAYMENT_STATUS.FAILED;
      payment.failureCode = innerAttributes.failure_code || 'PAYMENT_FAILED';
      payment.failureReason = innerAttributes.failure_reason || 'Payment could not be completed via GCash.';
      await payment.save({ transaction });

      await transaction.commit();

      const tenant = await User.findByPk(payment.tenantId);
      await sendPaymentNotification({
        tenantId: payment.tenantId,
        ownerId: payment.ownerId,
        title: '❌ Payment Unsuccessful',
        body: `Your GCash payment request (${payment.internalReference}) for ${payment.billingMonth} was ${isExpired ? 'expired' : 'unsuccessful'}. Please try again.`,
        type: 'payment_failed',
        link: '#payments'
      });
    } else {
      await transaction.rollback();
    }

    await webhookRecord.update({ processed: true, processedAt: new Date(), paymentId: payment.id });
    return { success: true, status: payment.status };
  } catch (err) {
    await transaction.rollback();
    console.error('[Webhook Transaction Error]', err);
    throw err;
  }
};

// Export alias for backward compatibility if imported elsewhere
export const handleXenditWebhookPayload = handlePaymongoWebhookPayload;

/**
 * Retrieves the landlord's custom GCash account details for a given tenant.
 * Uses the tenant's OwnerTenant record to find their specific owner.
 */
export const getLandlordGcashDetails = async (user) => {
  const tenantRec = await OwnerTenant.findOne({
    where: {
      [sequelize.Sequelize.Op.or]: [
        // Case-insensitive email match
        sequelize.where(
          sequelize.fn('LOWER', sequelize.col('email')),
          user.email.toLowerCase().trim()
        ),
        ...(user.contactNumber ? [{ contactNumber: user.contactNumber }] : [])
      ],
      status: 'active'
    }
  });

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

/**
 * Processes a direct GCash Portal payment completion
 */
export const processDirectGcashPayment = async ({ reference, gcashNumber }) => {
  return await handlePaymongoWebhookPayload({
    data: {
      id: `cs_gcash_${Date.now()}`,
      attributes: {
        type: 'checkout_session.payment.paid',
        status: 'paid',
        reference_number: reference,
        payments: [{ id: `pay_gcash_${Date.now()}` }]
      }
    }
  });
};

