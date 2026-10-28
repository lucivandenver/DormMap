import { User } from '../models/userModel.js';

export const requireApprovedOwner = async (req, res, next) => {
  if (req.session?.accountType !== 'boarding_house_owner' || !req.session?.userId) {
    const isApi = req.path.startsWith('/api/');
    if (isApi) return res.status(403).json({ error: 'Boarding house owner access required.' });
    return res.redirect('/login');
  }

  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: ['applicationStatus', 'isSuspended', 'isArchived', 'boardingHouseName', 'barangay', 'mapPin'],
    });

    if (!user || user.isArchived) {
      return res.redirect('/login');
    }

    // If owner profile details are missing, enforce profile wizard completion first
    if (!user.boardingHouseName || !user.barangay || !user.mapPin) {
      req.session.pendingOwnerUserId = req.session.userId;
      return res.redirect('/complete-owner-profile');
    }

    if (user.isSuspended) {
      const isApi = req.path.startsWith('/api/');
      if (isApi) return res.status(403).json({ error: 'Your account has been suspended.' });
      return res.render('ownerDashboard', {
        title: 'DormMap | Owner Dashboard',
        userName: req.session.userName,
        pendingStatus: 'suspended',
      });
    }

    const approved = ['approved', 'approved_barangay', 'forwarded_to_bplo'];
    if (!approved.includes(user.applicationStatus)) {
      const isApi = req.path.startsWith('/api/');
      if (isApi) return res.status(403).json({ error: 'Your account is pending approval.' });
      return res.render('ownerDashboard', {
        title: 'DormMap | Owner Dashboard',
        userName: req.session.userName,
        pendingStatus: user.applicationStatus,
      });
    }

    next();
  } catch (err) {
    console.error('requireApprovedOwner error:', err);
    next();
  }
};
