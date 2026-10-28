import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { listBoardingHouses, getBoardingHouse, createBoardingHouse, updateBoardingHouse } from '../controllers/boardingHouse.controller.js';

const router = Router();

router.get('/', authenticate, listBoardingHouses);
router.get('/:id', authenticate, getBoardingHouse);
router.post('/', authenticate, authorize('owner', 'super_admin', 'barangay_official'), createBoardingHouse);
router.put('/:id', authenticate, authorize('owner', 'super_admin', 'barangay_official'), updateBoardingHouse);

export { router as boardingHouseRoutes };