import test from 'node:test';
import assert from 'node:assert/strict';
import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { OwnerPayment, OwnerTenant, OwnerNotification } from '../models/ownerModels.js';
import { BarangayNotification } from '../models/adminModels.js';
import { Payment } from '../models/paymentModels.js';
import { submitRentPayment, manilaToday } from '../services/manualPaymentService.js';
import { markPaid, returnPaymentSubmission } from '../controllers/ownerDashboardController.js';

function setup(t, { onlineCheckout = false, hasSubmission = false } = {}) {
  const today = manilaToday();
  const owner = { id: 2, paymentMethods: '["GCash","Cash","QR Ph"]', gcashQrCode: '/uploads/qr.png', qrPhCode: '/uploads/qrph.png' };
  const user = { id: 3, fullName: 'Test Tenant', email: 'tenant@example.test' };
  const notifications = [];
  const ownerNotifications = [];
  const rental = {
    id: 4, ownerId: owner.id, tenantUserId: user.id, balance: 1100,
    async update(values) { Object.assign(this, values); return this; }
  };
  const bill = {
    id: 5, tenantId: rental.id, ownerId: owner.id, status: 'pending', amount: 1000, penalty: 100,
    month: '2099-01', dueDate: '2099-01-10',
    ...(hasSubmission ? { submissionId: 'submission-one', submittedMethod: 'GCash', reviewStatus: 'submitted',
      submittedPaidDate: today, submittedReference: '123456789', paymentProofUrl: '/documents/proof/payment-proof.png' } : {}),
    async update(values) { Object.assign(this, values); return this; }
  };
  let sequence = Promise.resolve();
  t.mock.method(sequelize, 'transaction', fn => {
    const next = sequence.then(() => fn({ LOCK: { UPDATE: 'UPDATE' } }));
    sequence = next.catch(() => {});
    return next;
  });
  t.mock.method(User, 'findOne', async () => owner);
  t.mock.method(OwnerTenant, 'findAll', async () => [rental]);
  t.mock.method(OwnerTenant, 'findOne', async () => rental);
  t.mock.method(OwnerPayment, 'findOne', async ({ where }) => Object.hasOwn(where, 'tenantId') || typeof where.id !== 'object' ? bill : null);
  t.mock.method(Payment, 'count', async () => Number(onlineCheckout));
  t.mock.method(Payment, 'findAll', async () => onlineCheckout ? [{ id: 10, paymongoCheckoutId: null }] : []);
  t.mock.method(sequelize.models.ReviewFile, 'create', async values => values);
  t.mock.method(BarangayNotification, 'create', async values => { notifications.push(values); });
  t.mock.method(OwnerNotification, 'create', async values => { ownerNotifications.push(values); });
  return { today, user, rental, bill, notifications, ownerNotifications };
}

async function request(controller, body) {
  let result;
  await controller({ session: { userId: 2 }, params: { id: 5 }, body }, {
    json(value) { result = value; }
  }, error => { throw error; });
  return result;
}

test('tenant saves proof and notes for QR Ph while a previous checkout is pending', async t => {
  const { user, today, bill, rental, ownerNotifications } = setup(t, { onlineCheckout: true });
  await assert.rejects(submitRentPayment(user, bill.id, {
    method: 'QR Ph', reference: 'QR9AB3', paidDate: today
  }), /Upload your QR Ph proof/);
  const result = await submitRentPayment(user, bill.id, {
    method: 'QR Ph', reference: 'QR9AB3', paidDate: today, notes: 'Advance rent'
  }, { originalname: 'proof.jpg', mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
  assert.equal(result.submittedMethod, 'QR Ph');
  assert.equal(result.status, 'pending');
  assert.equal(result.reviewStatus, 'submitted');
  assert.equal(result.submissionNotes, 'Advance rent');
  assert.equal(result.submittedReference, 'QR9AB3');
  assert.match(result.paymentProofUrl, /^\/documents\//);
  assert.equal(rental.balance, 1100);
  assert.equal(ownerNotifications.length, 1);
  assert.equal(Payment.count.mock.callCount(), 0);
  assert.equal(Payment.findAll.mock.callCount(), 0);
});

test('confirming an open online checkout cannot settle the manual submission', async t => {
  const { today, bill, notifications, rental } = setup(t, { onlineCheckout: true, hasSubmission: true });
  await assert.rejects(request(markPaid, {
    submissionId: bill.submissionId, confirmedDate: today, method: 'GCash', reference: bill.submittedReference
  }), /previous online checkout/);
  assert.equal(bill.status, 'pending');
  assert.equal(bill.reviewStatus, 'submitted');
  assert.equal(rental.balance, 1100);
  assert.equal(notifications.length, 0);
});

test('confirmation saves the selected date and sends one notification on retries', async t => {
  const { bill, rental, notifications } = setup(t, { hasSubmission: true });
  bill.submittedMethod = 'QR Ph';
  const body = { submissionId: bill.submissionId, confirmedDate: '2026-01-15', notes: 'Payment verified.' };
  await Promise.all([request(markPaid, body), request(markPaid, body)]);
  assert.equal(bill.status, 'paid');
  assert.equal(bill.reviewStatus, 'confirmed');
  assert.equal(bill.reviewDate, '2026-01-15');
  assert.equal(bill.paidDate, '2026-01-15');
  assert.equal(bill.method, 'QR Ph');
  assert.equal(bill.reference, '123456789');
  assert.equal(rental.balance, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].userId, 3);
  assert.equal(notifications[0].type, 'payment_confirmed');
  assert.match(notifications[0].body, /Payment verified/);
});

test('decline requires notes, keeps proof, notifies the tenant and permits resubmission', async t => {
  const { today, user, bill, rental, notifications } = setup(t, { hasSubmission: true });
  await assert.rejects(request(returnPaymentSubmission, {
    submissionId: bill.submissionId, confirmedDate: today, notes: '  '
  }), /reason/);
  assert.equal(notifications.length, 0);
  const previousId = bill.submissionId;
  const body = { submissionId: previousId, confirmedDate: today, notes: 'The reference is incomplete.' };
  await request(returnPaymentSubmission, body);
  await request(returnPaymentSubmission, body);
  assert.equal(bill.reviewStatus, 'declined');
  assert.equal(bill.status, 'pending');
  assert.equal(bill.reviewNotes, body.notes);
  assert.equal(bill.paymentProofUrl, '/documents/proof/payment-proof.png');
  assert.equal(rental.balance, 1100);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'payment_declined');
  assert.match(notifications[0].body, /reference is incomplete/);

  await submitRentPayment(user, bill.id, { method: 'Cash', paidDate: today });
  assert.equal(bill.reviewStatus, 'submitted');
  assert.equal(bill.reviewNotes, null);
  assert.notEqual(bill.submissionId, previousId);
  await assert.rejects(request(returnPaymentSubmission, body), /submission changed/);
  await assert.rejects(request(markPaid, { ...body, method: 'Cash' }), /submission changed/);
  assert.equal(bill.reviewStatus, 'submitted');
  assert.equal(notifications.length, 1);
});
