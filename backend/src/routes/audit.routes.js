import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { listAuditLogs } from '../controllers/audit.controller.js';

const router = Router();

router.use(authenticate, authorize('super_admin'));
router.get('/', listAuditLogs);

export { router as auditRoutes };