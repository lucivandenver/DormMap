const invalidSetup = message => Object.assign(new Error(message), { status: 422 });

export const RENT_PAYMENT_METHODS = ['Cash', 'GCash'];

export function ownerPaymentQr(owner) {
  const qr = owner?.gcashQrCode;
  return typeof qr === 'string' && /^\/(?:uploads\/[\w.-]+|documents\/[a-f0-9-]{36}\/[\w.-]+)$/.test(qr) ? qr : null;
}

export function ownerPaymentConfig(owner) {
  let configured;
  try { configured = JSON.parse(owner?.paymentMethods); } catch { /* Legacy profile. */ }
  const gcashQrCode = ownerPaymentQr(owner);
  const accepted = RENT_PAYMENT_METHODS.filter(method => Array.isArray(configured) && configured.includes(method));
  const methods = accepted.length ? accepted : gcashQrCode ? ['Cash', 'GCash'] : ['Cash'];
  return {
    methods: methods.filter(method => method !== 'GCash' || gcashQrCode),
    gcashQrCode: methods.includes('GCash') ? gcashQrCode : null
  };
}

export function validatePaymentMethods(value, hasQr) {
  const methods = RENT_PAYMENT_METHODS.filter(method => [].concat(value || []).includes(method));
  if (!methods.length) throw invalidSetup('Select at least one accepted payment method.');
  if (methods.includes('GCash') && !hasQr) throw invalidSetup('Upload your GCash QR code when accepting GCash.');
  return methods;
}
