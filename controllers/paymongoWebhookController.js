import { verifyPaymongoWebhookSignature } from '../services/paymongoService.js';
import { handlePaymongoWebhookPayload } from '../services/paymentService.js';

export const handlePaymongoWebhook = async (req, res) => {
  try {
    // 1. Verify PayMongo Webhook Signature
    const isValid = verifyPaymongoWebhookSignature(req);
    if (!isValid) {
      console.warn('[PayMongo Webhook Warning] Rejected webhook with invalid signature header.');
      return res.status(401).json({ error: 'Unauthorized webhook request.' });
    }

    const payload = req.body;
    console.log('[PayMongo Webhook Received]', JSON.stringify(payload).substring(0, 200));

    // 2. Process Webhook Payload with Idempotency & Database Transactions
    const result = await handlePaymongoWebhookPayload(payload);

    // 3. Return 200 OK to PayMongo
    res.status(200).json({
      status: 'SUCCESS',
      message: 'Webhook processed by DorMap System.',
      result
    });
  } catch (err) {
    console.error('[PayMongo Webhook Handler Error]', err.message);
    res.status(500).json({ error: 'Internal server error processing webhook.' });
  }
};
