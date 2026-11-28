import express from 'express';
import { handleDormigoChat, handleDormigoPortalChat, getDormigoSuggestions, getDormigoKnowledge } from '../controllers/dormigoController.js';

const router = express.Router();

router.post('/chat', handleDormigoChat);
router.post('/portal-chat', handleDormigoPortalChat);
router.get('/suggestions', getDormigoSuggestions);
router.get('/knowledge', getDormigoKnowledge);

export default router;
