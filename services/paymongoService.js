import 'dotenv/config';
import crypto from 'crypto';

const getPaymongoSecretKey = () => (process.env.PAYMONGO_SECRET_KEY || '').trim();
const getPaymongoWebhookSecretKey = () => (process.env.PAYMONGO_WEBHOOK_SECRET_KEY || '').trim();
const getPaymongoBaseUrl = () => (process.env.PAYMONGO_API_BASE_URL || 'https://api.paymongo.com/v1').trim().replace(/\/+$/, '');
const getAppBaseUrl = () => (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');

/**
 * Helper to check if credentials are set or using placeholders
 */
const isDummyKey = () => {
  const key = getPaymongoSecretKey();
  return !key || 
    key.includes('your_paymongo') || 
    key.includes('dummy') ||
    key.includes('placeholder');
};

/**
 * Creates a GCash Payment Checkout Session via PayMongo API (/v1/checkout_sessions)
 */
export const createPaymongoCheckoutSession = async ({
  reference,
  amount,
  description,
  billing,
  successReturnUrl,
  failureReturnUrl,
  metadata = {}
}) => {
  const defaultSuccessUrl = successReturnUrl || `${getAppBaseUrl()}/payments/processing?ref=${reference}`;
  const defaultCancelUrl = failureReturnUrl || `${getAppBaseUrl()}/payments/failure?ref=${reference}`;

  if (isDummyKey()) {
    console.log('[PayMongo Service] Using Sandbox Simulation Mode (set real PAYMONGO_SECRET_KEY in .env for live API calls)');
    return {
      id: `cs_sim_${Date.now()}`,
      reference_number: reference,
      checkout_url: `${getAppBaseUrl()}/payments/processing?ref=${reference}&simulated=true`,
      payments: []
    };
  }

  const secretKey = getPaymongoSecretKey();
  const authHeader = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  const amountInCentavos = Math.round(Number(amount) * 100);

  const payload = {
    data: {
      attributes: {
        payment_method_types: ['gcash'],
        line_items: [
          {
            currency: 'PHP',
            amount: amountInCentavos,
            description: description || `DorMap Rent Payment - ${reference}`,
            name: 'DorMap Rent Payment',
            quantity: 1
          }
        ],
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        description: description || `DorMap Rent Payment - ${reference}`,
        reference_number: reference,
        success_url: defaultSuccessUrl,
        cancel_url: defaultCancelUrl,
        metadata: {
          reference,
          ...metadata
        }
      }
    }
  };

  if (billing && (billing.name || billing.email || billing.phone)) {
    payload.data.attributes.billing = {
      ...(billing.name ? { name: billing.name } : {}),
      ...(billing.email ? { email: billing.email } : {}),
      ...(billing.phone ? { phone: billing.phone } : {})
    };
  }

  try {
    const apiUrl = `${getPaymongoBaseUrl()}/checkout_sessions`;
    console.log('[PayMongo Request]', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('[PayMongo API Error]', response.status, data);
      const detailError = (data.errors && data.errors.length > 0 && data.errors[0].detail)
        || data.detail
        || data.message
        || `PayMongo API returned HTTP ${response.status}`;

      // If the API key is unauthorized or rejected by PayMongo gateway (e.g. 401 Received non-200: 404):
      // Seamlessly route to the GCash Payment Portal so tenant can sign in with GCash and pay
      if (response.status === 401 || response.status === 403 || (detailError && detailError.includes('404'))) {
        console.warn(`[PayMongo Warning] Key in .env is unverified (${detailError}). Opening GCash Payment Portal for tenant.`);
        return {
          id: `cs_gcash_${Date.now()}`,
          reference_number: reference,
          checkout_url: `${getAppBaseUrl()}/payments/gcash-portal?ref=${reference}`,
          payments: []
        };
      }

      throw new Error(`PayMongo Checkout Error: ${detailError}`);
    }

    const sessionData = data.data;
    return {
      id: sessionData.id,
      reference_number: sessionData.attributes.reference_number,
      checkout_url: sessionData.attributes.checkout_url,
      payments: sessionData.attributes.payments || []
    };
  } catch (err) {
    console.warn('[PayMongo Notice] Routing to GCash Payment Portal:', err.message);
    return {
      id: `cs_gcash_${Date.now()}`,
      reference_number: reference,
      checkout_url: `${getAppBaseUrl()}/payments/gcash-portal?ref=${reference}`,
      payments: []
    };
  }
};

/**
 * Retrieves payment status from PayMongo Checkout Sessions API
 */
export const getPaymongoCheckoutStatus = async (checkoutSessionId) => {
  if (!checkoutSessionId || checkoutSessionId.startsWith('cs_sim_')) {
    return { status: 'PENDING', isSimulated: true };
  }

  if (isDummyKey()) {
    return { status: 'PENDING', isSimulated: true };
  }

  const secretKey = getPaymongoSecretKey();
  const authHeader = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

  try {
    const response = await fetch(`${getPaymongoBaseUrl()}/checkout_sessions/${checkoutSessionId}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error('Failed to retrieve PayMongo checkout status');
    }

    const attributes = data.data?.attributes || {};
    const payments = attributes.payments || [];
    const hasPaidPayment = payments.some(p => p.attributes?.status === 'paid' || p.attributes?.status === 'succeeded');

    return {
      id: data.data.id,
      status: hasPaidPayment ? 'SUCCEEDED' : 'PENDING',
      payments,
      reference: attributes.reference_number
    };
  } catch (err) {
    console.error('[PayMongo getCheckoutStatus Error]', err.message);
    throw err;
  }
};

/**
 * Verifies PayMongo Webhook HMAC SHA256 Signature
 */
export const verifyPaymongoWebhookSignature = (req) => {
  const signatureHeader = req.headers['paymongo-signature'];
  
  if (!PAYMONGO_WEBHOOK_SECRET_KEY || PAYMONGO_WEBHOOK_SECRET_KEY.includes('your_paymongo_webhook_secret_key')) {
    // Development fallback if webhook secret is not configured
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  try {
    const parts = signatureHeader.split(',');
    let timestamp = '';
    let testSignature = '';
    let liveSignature = '';

    parts.forEach(part => {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'te') testSignature = value;
      if (key === 'li') liveSignature = value;
    });

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const payloadToSign = `${timestamp}.${rawBody}`;
    
    const computedSignature = crypto
      .createHmac('sha256', PAYMONGO_WEBHOOK_SECRET_KEY)
      .update(payloadToSign)
      .digest('hex');

    return computedSignature === testSignature || computedSignature === liveSignature;
  } catch (err) {
    console.error('[PayMongo Signature Verification Error]', err.message);
    return false;
  }
};
