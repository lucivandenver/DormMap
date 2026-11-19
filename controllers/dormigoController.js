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
