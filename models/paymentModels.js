import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { User } from './userModel.js';
import { OwnerRoom, OwnerTenant, OwnerPayment } from './ownerModels.js';

export const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tenantId: { type: DataTypes.INTEGER, allowNull: false },
  ownerId: { type: DataTypes.INTEGER, allowNull: false },
  roomId: { type: DataTypes.INTEGER, allowNull: true },
  tenantPaymentId: { type: DataTypes.INTEGER, allowNull: true }, // Linked to OwnerPayment record
  billingMonth: { type: DataTypes.STRING, allowNull: false }, // e.g. "2026-08"
  billingYear: { type: DataTypes.INTEGER, allowNull: false },
  internalReference: { type: DataTypes.STRING, allowNull: false, unique: true }, // e.g. DM-RENT-202608-000001
  paymongoCheckoutId: { type: DataTypes.STRING, allowNull: true },
  paymongoPaymentId: { type: DataTypes.STRING, allowNull: true },
  paymentMethod: { type: DataTypes.STRING, allowNull: false, defaultValue: 'GCASH' },
  paymentChannel: { type: DataTypes.STRING, allowNull: false, defaultValue: 'GCASH' },
  currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PHP' },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  baseAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  penaltyAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  status: {
    type: DataTypes.ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'),
    allowNull: false,
    defaultValue: 'PENDING'
  },
  checkoutUrl: { type: DataTypes.TEXT, allowNull: true },
  successReturnUrl: { type: DataTypes.TEXT, allowNull: true },
  failureReturnUrl: { type: DataTypes.TEXT, allowNull: true },
  failureCode: { type: DataTypes.STRING, allowNull: true },
  failureReason: { type: DataTypes.TEXT, allowNull: true },
  paidAt: { type: DataTypes.DATE, allowNull: true },
  expiresAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'Payments',
  timestamps: true
});

export const PaymentWebhook = sequelize.define('PaymentWebhook', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  eventType: { type: DataTypes.STRING, allowNull: false },
  paymongoEventId: { type: DataTypes.STRING, allowNull: true },
  paymentId: { type: DataTypes.INTEGER, allowNull: true },
  paymongoPaymentId: { type: DataTypes.STRING, allowNull: true },
  payload: { type: DataTypes.JSON, allowNull: false },
  processed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  processedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'PaymentWebhooks',
  timestamps: true
});

export const PaymentReceipt = sequelize.define('PaymentReceipt', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  paymentId: { type: DataTypes.INTEGER, allowNull: false },
  receiptNumber: { type: DataTypes.STRING, allowNull: false, unique: true }, // e.g. REC-202608-000001
  tenantId: { type: DataTypes.INTEGER, allowNull: false },
  ownerId: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paymentMethod: { type: DataTypes.STRING, allowNull: false, defaultValue: 'GCash Online' },
  billingPeriod: { type: DataTypes.STRING, allowNull: false },
  paidAt: { type: DataTypes.DATE, allowNull: false },
  receiptFile: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'PaymentReceipts',
  timestamps: true
});

export const PaymentAuditLog = sequelize.define('PaymentAuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  paymentId: { type: DataTypes.INTEGER, allowNull: true },
  userId: { type: DataTypes.INTEGER, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: 'PaymentAuditLogs',
  timestamps: true
});

// Relationships
Payment.belongsTo(User, { as: 'tenant', foreignKey: 'tenantId' });
Payment.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });
Payment.belongsTo(OwnerRoom, { as: 'room', foreignKey: 'roomId' });
Payment.belongsTo(OwnerPayment, { as: 'tenantPayment', foreignKey: 'tenantPaymentId' });
Payment.hasOne(PaymentReceipt, { foreignKey: 'paymentId' });
PaymentReceipt.belongsTo(Payment, { foreignKey: 'paymentId' });

export const ensurePaymentSchema = async () => {
  await Payment.sync();
  await PaymentWebhook.sync();
  await PaymentReceipt.sync();
  await PaymentAuditLog.sync();

  const queryInterface = sequelize.getQueryInterface();
  const paymentAdditions = {
    paymongoCheckoutId: { type: DataTypes.STRING, allowNull: true },
    paymongoPaymentId: { type: DataTypes.STRING, allowNull: true },
    checkoutUrl: { type: DataTypes.TEXT, allowNull: true },
    successReturnUrl: { type: DataTypes.TEXT, allowNull: true },
    failureReturnUrl: { type: DataTypes.TEXT, allowNull: true },
    failureCode: { type: DataTypes.STRING, allowNull: true },
    failureReason: { type: DataTypes.TEXT, allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true }
  };

  try {
    const paymentCols = await queryInterface.describeTable('Payments');
    for (const [name, definition] of Object.entries(paymentAdditions)) {
      if (!paymentCols[name]) {
        await queryInterface.addColumn('Payments', name, definition);
      }
    }
  } catch (err) {
    console.error('Error ensuring Payments schema:', err.message);
  }

  const webhookAdditions = {
    paymongoEventId: { type: DataTypes.STRING, allowNull: true },
    paymongoPaymentId: { type: DataTypes.STRING, allowNull: true }
  };

  try {
    const webhookCols = await queryInterface.describeTable('PaymentWebhooks');
    for (const [name, definition] of Object.entries(webhookAdditions)) {
      if (!webhookCols[name]) {
        await queryInterface.addColumn('PaymentWebhooks', name, definition);
      }
    }
  } catch (err) {
    console.error('Error ensuring PaymentWebhooks schema:', err.message);
  }
};
