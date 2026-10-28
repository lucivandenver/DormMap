import { User } from '../models/userModel.js';

export const requireBarangayOfficial = async (req, res, next) => {
  if (req.session?.accountType !== 'barangay' || !req.session?.userId) {
    // For API routes, return JSON; for page routes, redirect
    const isApi = req.path.startsWith('/api/');
    if (isApi) return res.status(403).json({ error: 'Barangay Official access is required.' });
    return res.redirect('/login');
  }

  // Check if this barangay account has no assigned barangay yet
  // (e.g. old Google OAuth accounts created before this flow was added)
  try {
    const user = await User.findByPk(req.session.userId, { attributes: ['barangay'] });
    if (!user?.barangay) {
      // Store pending user id so the completion page can update the record
      req.session.pendingBarangayUserId = req.session.userId;
      return res.redirect('/complete-barangay-profile');
    }
  } catch (err) {
    // On DB error, let the request proceed — the controller will handle it
    console.error('requireBarangayOfficial barangay check error:', err);
  }

  next();
};
