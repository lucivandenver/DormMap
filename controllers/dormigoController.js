import { processDormigoChat, fetchLiveDatabaseContext, SYSTEM_KNOWLEDGE } from '../services/dormigoAiService.js';

export const handleDormigoChat = async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const userContext = req.user ? {
      id: req.user.id,
      name: req.user.fullName,
      accountType: req.user.accountType,
      barangay: req.user.barangay
    } : { accountType: 'guest' };

    const result = await processDormigoChat({
      message,
      userContext,
      history: history || []
    });

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
        reply: 'Paumanhin, nagkaroon ng sandaling aberya. Subukan muling magtanong o tingnan ang aming interactive map!',
        suggestions: ['Tingnan ang Mapa', 'Boarding houses sa Poblacion'],
        actionCards: [{ title: 'Explore Map', link: '/#map', label: 'Buksan ang Mapa', icon: 'map' }]
      }
    });
  }
};

export const getDormigoSuggestions = async (req, res) => {
  try {
    const dbContext = await fetchLiveDatabaseContext();
    const suggestions = [
      `🏡 ${dbContext.totalHouses} Boarding houses sa Bongabong`,
      '📍 Boarding houses malapit sa MinSU',
      '💰 Available rooms under ₱2,000',
      '💳 Paano magbayad gamit ang GCash?',
      '🛡️ Paano ma-verify ng BPLO ang dorm?'
    ];
    return res.json({ success: true, suggestions, dbSummary: { totalHouses: dbContext.totalHouses, totalRooms: dbContext.totalRoomsAvailable } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getDormigoKnowledge = async (req, res) => {
  try {
    const dbContext = await fetchLiveDatabaseContext();
    return res.json({
      success: true,
      knowledge: SYSTEM_KNOWLEDGE,
      liveData: dbContext
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
