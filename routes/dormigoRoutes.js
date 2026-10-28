import express from 'express';
import { handleDormigoChat, getDormigoSuggestions, getDormigoKnowledge } from '../controllers/dormigoController.js';

const router = express.Router();

router.post('/chat', handleDormigoChat);
router.get('/suggestions', getDormigoSuggestions);
router.get('/knowledge', getDormigoKnowledge);

export default router;
