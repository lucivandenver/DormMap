import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { listTenants, getTenant, createTenant, updateTenant } from '../controllers/tenant.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', authorize('super_admin', 'barangay_official', 'owner'), listTenants);
router.get('/:id', authorize('super_admin', 'barangay_official', 'owner', 'tenant'), getTenant);
router.post('/', authorize('owner'), createTenant);
router.put('/:id', authorize('owner', 'super_admin', 'barangay_official'), updateTenant);

export { router as tenantRoutes };