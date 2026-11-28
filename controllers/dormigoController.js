import { User } from '../models/userModel.js';
import { dormigoPortalPolicy } from '../services/dormigoPortalWorkflows.js';
import { processDormigoPortalChat } from '../services/dormigoPortalChat.js';
import { getDormigoQuestions } from '../services/dormigoQuestionsService.js';
import { processDormigoChat, fetchLiveDatabaseContext, SYSTEM_KNOWLEDGE } from '../services/dormigoAiService.js';

export const handleDormigoChat = async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const result = await processDormigoChat({ message, history: history || [] });

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error handling Dormigo chat:', error);
    return res.status(500).json({
      success: false,
      error: 'Dormigo encountered an error processing your request.',
      data: {
        reply: 'Dormigo is temporarily unavailable. Please try again or open the interactive map.',
        suggestions: ['View the map', 'Boarding houses in Poblacion'],
        actionCards: [{ title: 'Explore Map', link: '/#map', label: 'Open Map', icon: 'map' }]
      }
    });
  }
};

export const handleDormigoPortalChat = async (req, res, next) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
    return res.status(400).json({ success: false, error: 'Enter a question of up to 2,000 characters.' });
  }

  const userId = req.session?.userId;
  if (!userId) {
    return res.status(403).json({ success: false, error: 'Sign in to use your portal assistant.' });
  }

  try {
    const user = await User.findByPk(userId, { attributes: ['accountType', 'isArchived', 'isSuspended', 'applicationStatus', 'barangay', 'boardingHouseName', 'mapPin'] });
    const policy = dormigoPortalPolicy(user?.accountType);
    if (!policy || user.isArchived || user.isSuspended) {
      return res.status(403).json({ success: false, error: 'Portal assistant access is unavailable for this account.' });
    }

    const barangay = user.barangay;
    if (policy.scope === 'barangay' && (!barangay?.trim() || user.applicationStatus !== 'approved')) {
      return res.status(403).json({ success: false, error: 'An approved account with an assigned barangay is required.' });
    }
    if (policy.scope === 'owner' && (!barangay?.trim() || !user.boardingHouseName || !user.mapPin ||
      !['approved', 'approved_barangay', 'forwarded_to_bplo'].includes(user.applicationStatus))) {
      return res.status(403).json({ success: false, error: 'An approved owner account with a complete property profile is required.' });
    }

    const data = await processDormigoPortalChat(message, policy, { userId, barangay });
    return res.json({ success: true, data });
  } catch (error) { next(error); }
};

export const getDormigoSuggestions = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, suggestions: await getDormigoQuestions() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getDormigoKnowledge = async (req, res) => {
  try {
    const dbContext = await fetchLiveDatabaseContext();
    return res.json({
      success: true,
      knowledge: { ...SYSTEM_KNOWLEDGE, barangays: dbContext.barangays, schools: dbContext.schools.map(school => school.name) },
      liveData: dbContext
    });
  } catch (error) {
    return res.status(503).json({ success: false, error: 'Live DormMap records are unavailable.' });
  }
};
