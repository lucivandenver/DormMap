export const requireSuperAdmin = (req, res, next) => {
  if (req.session?.accountType !== 'super_admin' || !req.session?.userId) {
    return res.status(403).json({ error: 'BPLO Super Admin access is required.' });
  }
  next();
};
