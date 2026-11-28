import nodemailer from 'nodemailer';

const defaultSender = 'bplobongabongmunicipality@gmail.com';
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

export function passwordResetDelivery() {
  const senderAddress = process.env.GMAIL_OAUTH_SENDER?.trim() || defaultSender;
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  return async ({ to, subject, text, html }) => {
    const signal = AbortSignal.timeout(12000);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }),
      signal
    });
    if (!tokenResponse.ok) throw Object.assign(new Error('Gmail OAuth failed.'), { code: 'GMAIL_OAUTH_FAILED' });
    const { access_token: accessToken } = await tokenResponse.json();
    if (!accessToken) throw Object.assign(new Error('Google did not return an access token.'), { code: 'GMAIL_OAUTH_FAILED' });

    const { message } = await composer.sendMail({
      from: { name: 'DormMap | BPLO Bongabong', address: senderAddress },
      to: { address: to },
      subject, text, html
    });
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderAddress)}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: message.toString('base64url') }),
      signal
    });
    if (!response.ok) throw Object.assign(new Error('Gmail could not send the email.'), { code: 'GMAIL_SEND_FAILED' });
  };
}
