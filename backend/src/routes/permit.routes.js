import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { listPermits, getPermit, createPermit, updatePermit } from '../controllers/permit.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', authorize('super_admin', 'barangay_official', 'owner'), listPermits);
router.get('/:id', authorize('super_admin', 'barangay_official', 'owner'), getPermit);
router.post('/', authorize('super_admin', 'barangay_official'), createPermit);
router.put('/:id', authorize('super_admin', 'barangay_official'), updatePermit);

export { router as permitRoutes };