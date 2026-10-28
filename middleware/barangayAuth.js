import { User } from '../models/userModel.js';

export const requireBarangayOfficial = async (req, res, next) => {
  const isApi = req.path.startsWith('/api/');
  if (req.session?.accountType !== 'barangay' || !req.session?.userId) {
    if (isApi) return res.status(403).json({ error: 'Barangay Official access is required.' });
    return res.redirect('/login');
  }
  try {
    const user = await User.findByPk(req.session.userId);
    if (!user || user.accountType !== 'barangay' || user.isArchived) {
      if (isApi) return res.status(403).json({ error: 'Account unavailable.' });
      return res.redirect('/login');
    }
    if (!user.barangay) {
      if (isApi) return res.status(403).json({ error: 'Complete your barangay profile first.' });
      req.session.pendingBarangayUserId = user.id;
      return res.redirect('/complete-barangay-profile');
    }
    if (user.applicationStatus !== 'approved' || user.isSuspended) {
      if (isApi) return res.status(403).json({ error: 'BPLO approval is required before accessing the barangay dashboard.' });
      return res.status(403).render('accountApproval', {
        title: 'DormMap', status: user.isSuspended ? 'suspended' : user.applicationStatus,
        reviewNote: user.applicationReviewNote, barangay: user.barangay,
      });
    }
    next();
  } catch (error) {
    console.error('Barangay authorization check failed:', error);
    return res.status(503).send('Unable to verify account approval. Please try again.');
  }
};
