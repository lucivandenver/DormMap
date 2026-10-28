import { verifyWebhookToken } from '../services/xenditService.js';
import { handleXenditWebhookPayload } from '../services/paymentService.js';

export const handleXenditWebhook = async (req, res) => {
  try {
    // 1. Verify Webhook Token / Callback Signature
    const isValid = verifyWebhookToken(req);
    if (!isValid) {
      console.warn('[Xendit Webhook Warning] Rejected webhook with invalid token header.');
      return res.status(401).json({ error: 'Unauthorized webhook request.' });
    }

    const payload = req.body;
    console.log('[Xendit Webhook Received]', JSON.stringify(payload).substring(0, 200));

    // 2. Process Webhook Payload with Idempotency & Database Transactions
    const result = await handleXenditWebhookPayload(payload);

    // 3. Return 200 OK to Xendit
    res.status(200).json({
      status: 'SUCCESS',
      message: 'Webhook processed by DormMap System.',
      result
    });
  } catch (err) {
    console.error('[Xendit Webhook Handler Error]', err.message);
    res.status(500).json({ error: 'Internal server error processing webhook.' });
  }
};
