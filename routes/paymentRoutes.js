import express from 'express';
import { requireTenantUser } from '../middleware/tenantAuth.js';
import { requireSuperAdmin } from '../middleware/adminAuth.js';
import { requirePaymentUser, requirePaymentOwnerOrTenant } from '../middleware/paymentAuth.js';
import { validatePaymentCreation } from '../validators/paymentValidator.js';
import {
  createGcashPayment,
  getLandlordGcashInfo,
  getPaymentStatus,
  getTenantPayments,
  getOwnerPayments,
  downloadReceipt,
  renderProcessingPage,
  renderSuccessPage,
  renderFailurePage,
  renderGcashPortal,
  authorizePortalPayment,
  seedDemoAccounts
} from '../controllers/paymentController.js';
import { handlePaymongoWebhook } from '../controllers/paymongoWebhookController.js';

const router = express.Router();

// ─── Demo Seeding Endpoint ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO_SEED === 'true') {
  router.post('/seed-demo', requireSuperAdmin, seedDemoAccounts);
} else {
  router.all('/seed-demo', (req, res) => res.status(404).json({ error: 'Not found.' }));
}

// ─── Public PayMongo Webhook Endpoint ─────────────────────────────────────────
router.post('/paymongo/webhook', handlePaymongoWebhook);
router.post('/xendit/webhook', handlePaymongoWebhook); // Legacy fallback route

// ─── Payment Result Pages ───────────────────────────────────────────────────
router.get('/page/processing', renderProcessingPage);
router.get('/page/success', renderSuccessPage);
router.get('/page/failure', renderFailurePage);
router.get('/page/gcash-portal', renderGcashPortal);

router.use(requirePaymentUser);

// ─── Authenticated Tenant Routes ──────────────────────────────────────────────
router.get('/landlord-gcash', requireTenantUser, getLandlordGcashInfo);
router.post('/gcash/create', requireTenantUser, validatePaymentCreation, createGcashPayment);
router.post('/gcash/authorize-portal', requireTenantUser, authorizePortalPayment);
router.get('/tenant/list', requireTenantUser, getTenantPayments);

// ─── Authenticated Owner Routes ───────────────────────────────────────────────
router.get('/owner/list', (req, res, next) => req.currentUser.accountType === 'boarding_house_owner' ? next() : res.status(403).json({ error: 'Owner access required.' }), getOwnerPayments);

// ─── Common Protected Routes ─────────────────────────────────────────────────
router.get('/:paymentId/status', requirePaymentOwnerOrTenant, getPaymentStatus);
router.get('/status/by-ref', requirePaymentOwnerOrTenant, getPaymentStatus);
router.get('/:paymentId/receipt/download', requirePaymentOwnerOrTenant, downloadReceipt);

export default router;
