import { Router } from 'express';
import { body } from 'express-validator';
import { login, register, refreshToken } from '../controllers/auth.controller.js';
import { validateRequest } from '../middleware/validator.middleware.js';

const router = Router();

router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required.'),
  body('password').isLength({ min: 6 }).withMessage('Password is required.'),
], validateRequest, login);

router.post('/register', [
  body('full_name').notEmpty().withMessage('Full name is required.'),
  body('email').isEmail().withMessage('Valid email is required.'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  body('role').isIn(['barangay_official', 'owner', 'tenant']).withMessage('Invalid role.'),
], validateRequest, register);

router.post('/refresh', refreshToken);

export { router as authRoutes };
