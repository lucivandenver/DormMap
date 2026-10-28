import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { getUsers, getUser, updateUser, deleteUser } from '../controllers/user.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', authorize('super_admin', 'barangay_official'), getUsers);
router.get('/:id', authorize('super_admin', 'barangay_official', 'owner', 'tenant'), getUser);
router.put('/:id', authorize('super_admin', 'barangay_official', 'owner', 'tenant'), updateUser);
router.delete('/:id', authorize('super_admin'), deleteUser);

export { router as userRoutes };
