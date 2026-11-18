const invalidSetup = message => Object.assign(new Error(message), { status: 422 });

export const PAYMENT_QR_FIELDS = Object.freeze({ GCash: 'gcashQrCode', 'QR Ph': 'qrPhCode' });
export const RENT_PAYMENT_METHODS = ['Cash', ...Object.keys(PAYMENT_QR_FIELDS)];
export const usesPaymentQr = method => Object.hasOwn(PAYMENT_QR_FIELDS, method);

export function ownerPaymentQr(owner, method = 'GCash') {
  const qr = owner?.[PAYMENT_QR_FIELDS[method]];
  return typeof qr === 'string' && /^\/(?:uploads\/[\w.-]+|documents\/[a-f0-9-]{36}\/[\w.-]+)$/.test(qr) ? qr : null;
}

export function ownerPaymentConfig(owner) {
  let configured;
  try { configured = JSON.parse(owner?.paymentMethods); } catch { /* Legacy profile. */ }
  const accepted = RENT_PAYMENT_METHODS.filter(method => Array.isArray(configured) && configured.includes(method));
  const selectedMethods = accepted.length ? accepted : ['Cash', ...Object.keys(PAYMENT_QR_FIELDS).filter(method => ownerPaymentQr(owner, method))];
  const qrCodes = Object.fromEntries(selectedMethods.filter(usesPaymentQr).map(method => [method, ownerPaymentQr(owner, method)]));
  return {
    selectedMethods,
    methods: selectedMethods.filter(method => !usesPaymentQr(method) || qrCodes[method]),
    qrCodes,
    gcashQrCode: qrCodes.GCash || null
  };
}

export function validatePaymentMethods(value, hasQr, { requireQr = true } = {}) {
  const methods = RENT_PAYMENT_METHODS.filter(method => [].concat(value || []).includes(method));
  if (!methods.length) throw invalidSetup('Select at least one accepted payment method.');
  const missingQr = requireQr && methods.find(method => usesPaymentQr(method) &&
    !(typeof hasQr === 'boolean' ? method === 'GCash' && hasQr : hasQr?.[method]));
  if (missingQr) throw invalidSetup(`Upload your ${missingQr} QR code when accepting ${missingQr}.`);
  return methods;
}
