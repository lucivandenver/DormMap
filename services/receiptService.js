import { PaymentReceipt } from '../models/paymentModels.js';
import { generateReceiptNumber } from '../utils/paymentReference.js';

export const createPaymentReceipt = async ({
  payment,
  tenant,
  owner,
  room,
  transaction
}) => {
  const existingReceipt = await PaymentReceipt.findOne({ where: { paymentId: payment.id }, transaction });
  if (existingReceipt) return existingReceipt;

  const receiptNumber = generateReceiptNumber(payment.billingMonth);
  const receiptFileUrl = `/api/payments/${payment.id}/receipt/download`;

  const receipt = await PaymentReceipt.create({
    paymentId: payment.id,
    receiptNumber,
    tenantId: payment.tenantId,
    ownerId: payment.ownerId,
    amount: payment.amount,
    paymentMethod: 'GCash Online',
    billingPeriod: payment.billingMonth,
    paidAt: payment.paidAt || new Date(),
    receiptFile: receiptFileUrl
  }, { transaction });

  return receipt;
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const generateReceiptHtml = ({ receipt, payment, tenant, owner, room }) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Official Receipt - ${escapeHtml(receipt.receiptNumber)}</title>
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; color: #1e293b; background: #f8fafc; }
        .receipt-card { max-width: 650px; margin: 0 auto; background: #ffffff; padding: 40px; border-radius: 20px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
        .header { display: flex; justify-content: space-between; align-items: center; border-b: 2px solid #023020; padding-bottom: 20px; margin-bottom: 25px; }
        .brand { font-size: 24px; font-weight: 900; color: #023020; letter-spacing: -0.5px; }
        .badge { background: #dcfce7; color: #166534; padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .section { margin-bottom: 20px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
        .value { font-size: 14px; font-weight: 600; color: #0f172a; }
        .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .table th { background: #f1f5f9; padding: 10px 14px; font-size: 11px; font-weight: 700; text-align: left; color: #475569; }
        .table td { padding: 12px 14px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .total-box { background: #ecfdf5; border: 1px solid #a7f3d0; padding: 20px; border-radius: 14px; text-align: right; margin-top: 25px; }
        .total-title { font-size: 12px; font-weight: 700; color: #065f46; text-transform: uppercase; }
        .total-amount { font-size: 28px; font-weight: 900; color: #023020; margin-top: 4px; }
        .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="receipt-card">
        <div class="header">
          <div>
            <div class="brand">DormMap</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Official Rental Payment Receipt</div>
          </div>
          <div class="badge">Paid via GCash</div>
        </div>

        <div class="grid section">
          <div>
            <div class="label">Receipt Number</div>
            <div class="value">${escapeHtml(receipt.receiptNumber)}</div>
          </div>
          <div>
            <div class="label">Transaction Reference</div>
            <div class="value">${escapeHtml(payment.internalReference)}</div>
          </div>
        </div>

        <div class="grid section">
          <div>
            <div class="label">Tenant Name</div>
            <div class="value">${escapeHtml(tenant?.fullName || 'Tenant')}</div>
            <div style="font-size: 12px; color: #64748b;">${escapeHtml(tenant?.email || '')}</div>
          </div>
          <div>
            <div class="label">Boarding House / Owner</div>
            <div class="value">${escapeHtml(owner?.boardingHouseName || owner?.fullName || 'Boarding House Owner')}</div>
            <div style="font-size: 12px; color: #64748b;">Room ${escapeHtml(room?.roomNumber || 'Assigned')}</div>
          </div>
        </div>

        <table class="table">
          <thead>
            <tr>
              <th>Description / Billing Period</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Monthly Rent - Period: <strong>${escapeHtml(payment.billingMonth)}</strong></td>
              <td style="text-align: right;">₱${Number(payment.baseAmount).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
            </tr>
            ${payment.penaltyAmount > 0 ? `
            <tr>
              <td>Late Penalty Charge</td>
              <td style="text-align: right; color: #dc2626;">₱${Number(payment.penaltyAmount).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <div class="total-box">
          <div class="total-title">Total Amount Paid</div>
          <div class="total-amount">₱${Number(payment.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
          <div style="font-size: 11px; color: #047857; margin-top: 4px;">Payment Date: ${new Date(receipt.paidAt).toLocaleString()}</div>
        </div>

        <div class="footer">
          This is an electronically generated official receipt issued by DormMap Payment Gateway System.
        </div>
      </div>
    </body>
    </html>
  `;
};
