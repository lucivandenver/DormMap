import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { getDashboardSummary, getPermitReport, getTenantReport } from '../controllers/report.controller.js';

const router = Router();

router.use(authenticate);
router.get('/summary', authorize('super_admin', 'barangay_official'), getDashboardSummary);
router.get('/permits', authorize('super_admin', 'barangay_official'), getPermitReport);
router.get('/tenants', authorize('super_admin', 'barangay_official', 'owner'), getTenantReport);

export { router as reportRoutes }; 