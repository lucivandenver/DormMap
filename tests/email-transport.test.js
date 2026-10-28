import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

test('updated mailer still builds verification messages without sending email', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const result = await transport.sendMail({
    from: 'DormMap <sender@example.test>',
    to: 'tenant@example.test',
    subject: 'Verify your DormMap account',
    html: '<p><a href="https://example.test/verify-email?token=test">Verify account</a></p>',
  });
  assert.deepEqual(result.envelope.to, ['tenant@example.test']);
  assert.match(result.message.toString(), /Verify your DormMap account/);
  transport.close();
});
