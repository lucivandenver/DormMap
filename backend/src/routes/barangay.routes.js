import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { listBarangays, getBarangay, createBarangay, updateBarangay } from '../controllers/barangay.controller.js';

const router = Router();

router.get('/', authenticate, listBarangays);
router.get('/:id', authenticate, getBarangay);
router.post('/', authenticate, authorize('super_admin'), createBarangay);
router.put('/:id', authenticate, authorize('super_admin'), updateBarangay);

export { router as barangayRoutes };
