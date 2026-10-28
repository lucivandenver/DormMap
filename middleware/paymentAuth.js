import { Payment } from '../models/paymentModels.js';
import { User } from '../models/userModel.js';
export const requirePaymentUser = async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required.' });
    const user = await User.findByPk(req.session.userId);
    if (!user || user.isSuspended || user.isArchived) return res.status(403).json({ error: 'Account unavailable.' });
    req.currentUser = user; next();
  } catch (error) { next(error); }
};
export const requirePaymentOwnerOrTenant = async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user) return res.status(401).json({ error: 'Authentication required.' });
    const payment = await Payment.findOne({ where: req.params.paymentId ? { id: req.params.paymentId } : { internalReference: String(req.query.ref || '') } });
    if (!payment) return res.status(404).json({ error: 'Payment record not found.' });
    if (payment.tenantId !== user.id && payment.ownerId !== user.id && !['super_admin','bplo_admin'].includes(user.accountType)) return res.status(403).json({ error: 'This payment does not belong to your account.' });
    req.targetPayment = payment; next();
  } catch (error) { next(error); }
};
