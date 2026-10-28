import { initiateRentPayment, getLandlordGcashDetails, handlePaymongoWebhookPayload } from '../services/paymentService.js';
import { getPaymongoCheckoutStatus } from '../services/paymongoService.js';
import { Payment, PaymentReceipt } from '../models/paymentModels.js';
import { User } from '../models/userModel.js';
import { OwnerRoom } from '../models/ownerModels.js';
import { generateReceiptHtml } from '../services/receiptService.js';
import { PAYMENT_STATUS } from '../utils/paymentStatus.js';

export const getLandlordGcashInfo = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const details = await getLandlordGcashDetails(user);
    res.json({ landlordGcash: details, data: details });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const createGcashPayment = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { billingMonth, tenantPaymentId } = req.body;

    const result = await initiateRentPayment({
      user,
      billingMonth,
      tenantPaymentId
    });

    res.status(201).json({
      message: 'GCash Payment Request created successfully via PayMongo.',
      paymentId: result.payment.id,
      internalReference: result.payment.internalReference,
      amount: result.payment.amount,
      checkoutUrl: result.checkoutUrl,
      isExisting: result.isExisting
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const getPaymentStatus = async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const { ref } = req.query;

    let payment = null;
    if (paymentId && !isNaN(paymentId)) {
      payment = await Payment.findByPk(paymentId);
    } else if (ref) {
      payment = await Payment.findOne({ where: { internalReference: ref } });
    }

    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    // Reconciliation uses the same atomic path whether received by signed webhook
    // or retrieved directly from PayMongo with the server's secret key.
    if (['PENDING','PROCESSING'].includes(payment.status) && payment.paymongoCheckoutId) {
      try {
        const provider = await getPaymongoCheckoutStatus(payment.paymongoCheckoutId);
        if (provider.status === 'SUCCEEDED') {
          await handlePaymongoWebhookPayload({ data: { attributes: { type: 'checkout_session.payment.paid', data: { id: payment.paymongoCheckoutId, attributes: { reference_number: provider.reference, payments: provider.payments } } } } });
          await payment.reload();
        } else if (provider.status === 'EXPIRED') {
          await handlePaymongoWebhookPayload({ data: { attributes: { type: 'checkout_session.expired', data: { id: payment.paymongoCheckoutId, attributes: {} } } } });
          await payment.reload();
        }
      } catch (error) { console.error('Provider reconciliation pending:', error.message); }
    }
    const receipt = payment.status === PAYMENT_STATUS.SUCCEEDED
      ? await PaymentReceipt.findOne({ where: { paymentId: payment.id } })
      : null;

    res.json({
      status: payment.status,
      internalReference: payment.internalReference,
      amount: payment.amount,
      billingMonth: payment.billingMonth,
      paidAt: payment.paidAt,
      receiptNumber: receipt ? receipt.receiptNumber : null,
      receiptUrl: receipt ? `/api/payments/${payment.id}/receipt/download` : null
    });
  } catch (err) {
    next(err);
  }
};

export const getTenantPayments = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const payments = await Payment.findAll({
      where: { tenantId: user.id },
      include: [{ model: PaymentReceipt }],
      order: [['createdAt', 'DESC']]
    });

    res.json({ payments });
  } catch (err) {
    next(err);
  }
};

export const getOwnerPayments = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const payments = await Payment.findAll({
      where: { ownerId: user.id },
      include: [
        { model: User, as: 'tenant', attributes: ['id', 'fullName', 'email', 'contactNumber'] },
        { model: OwnerRoom, as: 'room', attributes: ['id', 'roomNumber', 'roomType'] },
        { model: PaymentReceipt }
      ],
      order: [['createdAt', 'DESC']]
    });

    const totalCollected = payments.filter(p => p.status === PAYMENT_STATUS.SUCCEEDED).reduce((s, p) => s + Number(p.amount), 0);
    const totalPending = payments.filter(p => p.status === PAYMENT_STATUS.PENDING || p.status === PAYMENT_STATUS.PROCESSING).reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      payments,
      summary: {
        totalCollected,
        totalPending,
        totalCount: payments.length,
        paidCount: payments.filter(p => p.status === PAYMENT_STATUS.SUCCEEDED).length,
        pendingCount: payments.filter(p => p.status === PAYMENT_STATUS.PENDING).length
      }
    });
  } catch (err) {
    next(err);
  }
};

export const downloadReceipt = async (req, res, next) => {
  try {
    const payment = req.targetPayment || await Payment.findByPk(req.params.paymentId);
    if (!payment) {
      return res.status(404).send('Payment not found.');
    }

    if (payment.status !== PAYMENT_STATUS.SUCCEEDED) {
      return res.status(400).send('Receipt is only available for verified successful payments.');
    }

    const receipt = await PaymentReceipt.findOne({ where: { paymentId: payment.id } });
    const tenant = await User.findByPk(payment.tenantId);
    const owner = await User.findByPk(payment.ownerId);
    const room = payment.roomId ? await OwnerRoom.findByPk(payment.roomId) : null;

    const html = generateReceiptHtml({ receipt: receipt || { receiptNumber: `REC-${payment.id}`, paidAt: payment.paidAt }, payment, tenant, owner, room });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    next(err);
  }
};

export const renderProcessingPage = async (req, res) => {
  const { ref } = req.query;
  res.render('paymentProcessing', {
    title: 'DormMap | Processing Payment',
    reference: ref || ''
  });
};

export const renderSuccessPage = async (req, res) => {
  const { ref } = req.query;
  res.render('paymentSuccess', {
    title: 'DormMap | Payment Successful',
    reference: ref || ''
  });
};

export const renderFailurePage = async (req, res) => {
  const { ref } = req.query;
  res.render('paymentFailure', {
    title: 'DormMap | Payment Unsuccessful',
    reference: ref || ''
  });
};

export const renderGcashPortal = async (req, res) => res.status(410).send('The legacy demo portal is disabled. Use the real PayMongo checkout from your tenant dashboard.');
export const authorizePortalPayment = async (req, res) => res.status(410).json({ error: 'Simulated GCash authorization is disabled. Only verified PayMongo payments can settle rent.' });

export const seedDemoAccounts = async (req, res) => {
  try {
    const bcrypt = await import('bcrypt');
    const { OwnerTenant } = await import('../models/ownerModels.js');
    const { ensurePaymentSchema } = await import('../models/paymentModels.js');
    await ensurePaymentSchema();
    const hashedPassword = await bcrypt.default.hash('password123', 10);

    // 1. Sample Owner
    let owner = await User.findOne({ where: { email: 'owner@dormmap.com' } });
    if (!owner) {
      owner = await User.create({
        fullName: 'Juan Landlord (Sample Owner)',
        email: 'owner@dormmap.com',
        password: hashedPassword,
        accountType: 'boarding_house_owner',
        emailVerified: true,
        applicationStatus: 'approved',
        boardingHouseName: 'Sunset Haven Boarding House',
        boardingHouseAddress: 'Poblacion',
        barangay: 'Poblacion',
        roomsAvailable: 5,
        contactNumber: '09171112222',
        gcashNumber: '09171112222',
        gcashName: 'Juan Landlord',
        mapPin: 'Lat 12.719200, Lon 121.471900',
        boardingHouseLatitude: '12.719200',
        boardingHouseLongitude: '121.471900'
      });
    } else {
      owner.password = hashedPassword;
      owner.gcashNumber = '09171112222';
      owner.gcashName = 'Juan Landlord';
      owner.emailVerified = true;
      await owner.save();
    }

    // 2. Sample Room
    let room = await OwnerRoom.findOne({ where: { ownerId: owner.id, roomNumber: 'Room 101' } });
    if (!room) {
      room = await OwnerRoom.create({
        ownerId: owner.id,
        roomNumber: 'Room 101',
        roomType: 'Single Deluxe',
        capacity: 2,
        availableSlots: 1,
        rentalPrice: 2500.00,
        status: 'occupied'
      });
    }

    // 3. Sample Tenant User
    let tenantUser = await User.findOne({ where: { email: 'tenant@dormmap.com' } });
    if (!tenantUser) {
      tenantUser = await User.create({
        fullName: 'Maria Santos (Sample Tenant)',
        email: 'tenant@dormmap.com',
        password: hashedPassword,
        accountType: 'tenant',
        emailVerified: true,
        applicationStatus: 'approved',
        selectedBoardingHouse: 'Sunset Haven Boarding House',
        contactNumber: '09183334444'
      });
    } else {
      tenantUser.password = hashedPassword;
      tenantUser.emailVerified = true;
      tenantUser.selectedBoardingHouse = 'Sunset Haven Boarding House';
      tenantUser.contactNumber = '09183334444';
      await tenantUser.save();
    }

    // 4. OwnerTenant Linkage
    let ownerTenant = await OwnerTenant.findOne({ where: { ownerId: owner.id, email: 'tenant@dormmap.com' } });
    if (!ownerTenant) {
      ownerTenant = await OwnerTenant.create({
        ownerId: owner.id,
        roomId: room.id,
        fullName: 'Maria Santos (Sample Tenant)',
        email: 'tenant@dormmap.com',
        contactNumber: '09183334444',
        monthlyRent: 2500.00,
        balance: 2500.00,
        moveInDate: new Date(),
        status: 'active'
      });
    } else {
      ownerTenant.balance = 2500.00;
      ownerTenant.monthlyRent = 2500.00;
      ownerTenant.roomId = room.id;
      ownerTenant.status = 'active';
      await ownerTenant.save();
    }

    // 5. Pending Payment Obligation
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { OwnerPayment } = await import('../models/ownerModels.js');
    let ownerPayment = await OwnerPayment.findOne({
      where: { ownerId: owner.id, tenantId: ownerTenant.id, month: currentMonth }
    });

    if (!ownerPayment) {
      ownerPayment = await OwnerPayment.create({
        ownerId: owner.id,
        tenantId: ownerTenant.id,
        roomId: room.id,
        amount: 2500.00,
        penalty: 0.00,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'pending',
        month: currentMonth
      });
    } else {
      ownerPayment.status = 'pending';
      ownerPayment.amount = 2500.00;
      await ownerPayment.save();
    }

    res.json({
      message: '✅ Sample Owner & Tenant Accounts ready for PayMongo GCash testing!',
      ownerAccount: {
        email: 'owner@dormmap.com',
        password: 'password123',
        boardingHouse: 'Sunset Haven Boarding House',
        gcashNumber: '09171112222',
        gcashName: 'Juan Landlord'
      },
      tenantAccount: {
        email: 'tenant@dormmap.com',
        password: 'password123',
        monthlyRent: '₱2,500.00',
        billingMonth: currentMonth
      }
    });
  } catch (err) {
    console.error('Seed demo error:', err);
    res.status(500).json({ error: err.message });
  }
};
