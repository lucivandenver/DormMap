import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { listMapBoardingHouses } from '../controllers/map.controller.js';

const router = Router();

router.get('/boarding-houses', authenticate, listMapBoardingHouses);

export { router as mapRoutes };