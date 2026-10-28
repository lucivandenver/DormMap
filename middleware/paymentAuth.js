import { Payment } from '../models/paymentModels.js';

export const requirePaymentOwnerOrTenant = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const { paymentId } = req.params;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (paymentId) {
      const payment = await Payment.findByPk(paymentId);
      if (!payment) {
        return res.status(404).json({ error: 'Payment record not found.' });
      }

      const isTenant = payment.tenantId === user.id;
      const isOwner = payment.ownerId === user.id;
      const isAdmin = user.accountType === 'bplo_admin' || user.accountType === 'super_admin';

      if (!isTenant && !isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden: You do not have permission to access this payment record.' });
      }

      req.targetPayment = payment;
    }

    next();
  } catch (err) {
    next(err);
  }
};
