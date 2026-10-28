import { User } from '../models/userModel.js';
import { OwnerTenant } from '../models/ownerModels.js';

export const requireTenantUser = async (req, res, next) => {
  if (!req.session?.userId) {
    const isApi = req.path.startsWith('/api/');
    if (isApi) return res.status(401).json({ error: 'Authentication required. Please log in.' });
    return res.redirect('/login');
  }

  // Ensure role is tenant
  if (req.session.accountType !== 'tenant') {
    const isApi = req.path.startsWith('/api/');
    if (isApi) return res.status(403).json({ error: 'Access restricted to tenant accounts.' });
    return res.redirect('/dashboard');
  }

  try {
    const user = await User.findByPk(req.session.userId);
    if (!user || user.isArchived) {
      req.session.destroy(() => res.redirect('/login'));
      return;
    }

    if (user.isSuspended) {
      const isApi = req.path.startsWith('/api/');
      if (isApi) return res.status(403).json({ error: 'Your tenant account has been suspended.' });
      return res.render('tenantDashboard', {
        title: 'DormMap | Tenant Portal',
        userName: user.fullName,
        isSuspended: true,
      });
    }

    // Attach verified user to request
    req.currentUser = user;
    next();
  } catch (err) {
    console.error('requireTenantUser middleware error:', err);
    next(err);
  }
};
