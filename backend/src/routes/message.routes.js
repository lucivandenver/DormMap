import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { listMessages, sendMessage, markMessageRead } from '../controllers/message.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', listMessages);
router.post('/', sendMessage);
router.put('/:id/read', markMessageRead);

export { router as messageRoutes };