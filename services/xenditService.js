import 'dotenv/config';

const XENDIT_SECRET_KEY = process.env.XENDIT_SECRET_KEY || '';
const XENDIT_WEBHOOK_TOKEN = process.env.XENDIT_WEBHOOK_TOKEN || '';
const XENDIT_API_BASE_URL = process.env.XENDIT_API_BASE_URL || 'https://api.xendit.co';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

/**
 * Creates a GCash Payment Request via Xendit official Payments API (/v3/payment_requests)
 */
export const createGcashPayment = async ({
  reference,
  amount,
  description,
  successReturnUrl,
  failureReturnUrl
}) => {
  const isDummyKey = !XENDIT_SECRET_KEY || XENDIT_SECRET_KEY.includes('dummy_key') || XENDIT_SECRET_KEY.includes('your_xendit_secret_key');

  const authHeader = `Basic ${Buffer.from(`${XENDIT_SECRET_KEY}:`).toString('base64')}`;

  const payload = {
    reference_id: reference,
    currency: 'PHP',
    amount: Number(amount),
    country: 'PH',
    payment_method: {
      type: 'EWALLET',
      reusability: 'ONE_TIME_USE',
      ewallet: {
        channel_code: 'GCASH',
        channel_properties: {
          success_return_url: successReturnUrl || `${APP_BASE_URL}/payments/processing?ref=${reference}`,
          failure_return_url: failureReturnUrl || `${APP_BASE_URL}/payments/failure?ref=${reference}`
        }
      }
    },
    description: description || `DormMap Rent Payment - ${reference}`
  };

  if (isDummyKey) {
    // Development sandbox simulation mode if Xendit secret key has not been inserted yet
    console.log('[Xendit Service] Using Sandbox Simulation Mode (insert your real XENDIT_SECRET_KEY in .env for live API calls)');
    return {
      id: `pr_sim_${Date.now()}`,
      reference_id: reference,
      status: 'REQUIRES_ACTION',
      actions: [
        {
          action: 'AUTH',
          url: `${APP_BASE_URL}/payments/processing?ref=${reference}&simulated=true`
        }
      ]
    };
  }

  try {
    const response = await fetch(`${XENDIT_API_BASE_URL}/v3/payment_requests`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[Xendit API Error]', data);
      throw new Error(data.message || data.error_code || 'Xendit Payment Request creation failed.');
    }

    return data;
  } catch (err) {
    console.error('[Xendit Service Exception]', err.message);
    throw err;
  }
};

/**
 * Retrieves authoritative payment status from Xendit API
 */
export const getXenditPaymentStatus = async (paymentRequestId) => {
  if (!paymentRequestId || paymentRequestId.startsWith('pr_sim_')) {
    return { status: 'PENDING', isSimulated: true };
  }

  const authHeader = `Basic ${Buffer.from(`${XENDIT_SECRET_KEY}:`).toString('base64')}`;

  try {
    const response = await fetch(`${XENDIT_API_BASE_URL}/v3/payment_requests/${paymentRequestId}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to retrieve Xendit payment status');
    }

    return data;
  } catch (err) {
    console.error('[Xendit getPaymentStatus Error]', err.message);
    throw err;
  }
};

/**
 * Verifies incoming Xendit Webhook signature / callback token
 */
export const verifyWebhookToken = (req) => {
  const callbackToken = req.headers['x-callback-token'] || req.headers['x-webhook-token'];
  
  // If webhook token is set in .env, verify it strictly
  if (XENDIT_WEBHOOK_TOKEN && XENDIT_WEBHOOK_TOKEN !== 'your_xendit_webhook_verification_token_here') {
    return callbackToken === XENDIT_WEBHOOK_TOKEN;
  }

  // During local development fallback if token isn't configured yet
  return true;
};
