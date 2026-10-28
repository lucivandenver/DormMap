/**
 * Utility functions for generating unique Payment References and Receipt Numbers
 */

export const generatePaymentReference = (billingMonthStr) => {
  const cleanMonth = (billingMonthStr || new Date().toISOString().slice(0, 7)).replace('-', '');
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `DM-RENT-${cleanMonth}-${randomSuffix}`;
};

export const generateReceiptNumber = (billingMonthStr) => {
  const cleanMonth = (billingMonthStr || new Date().toISOString().slice(0, 7)).replace('-', '');
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `REC-${cleanMonth}-${randomSuffix}`;
};
