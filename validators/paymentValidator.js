export const validatePaymentCreation = (req, res, next) => {
  const { billingMonth } = req.body;

  if (billingMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
    return res.status(400).json({ error: 'Invalid billingMonth format. Expected format: YYYY-MM (e.g. 2026-08)' });
  }

  next();
};
