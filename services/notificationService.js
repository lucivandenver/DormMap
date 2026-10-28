import { OwnerNotification } from '../models/ownerModels.js';
import { BarangayNotification } from '../models/adminModels.js';

let ioInstance = null;

export const setSocketIOInstance = (io) => {
  ioInstance = io;
};

export const sendPaymentNotification = async ({
  tenantId,
  ownerId,
  title,
  body,
  type = 'payment',
  link = '#payments'
}) => {
  try {
    // 1. Notify Owner
    if (ownerId) {
      await OwnerNotification.create({
        ownerId,
        title,
        body,
        type,
        isRead: false,
        link
      }).catch(() => {});

      if (ioInstance) {
        ioInstance.to(`owner_${ownerId}`).emit('notification', {
          title,
          body,
          type,
          link,
          createdAt: new Date()
        });
      }
    }

    // 2. Notify Tenant
    if (tenantId) {
      await BarangayNotification.create({
        userId: tenantId,
        title,
        body,
        type,
        isRead: false,
        link
      }).catch(() => {});

      if (ioInstance) {
        ioInstance.to(`tenant_${tenantId}`).emit('notification', {
          title,
          body,
          type,
          link,
          createdAt: new Date()
        });
      }
    }
  } catch (err) {
    console.error('[Notification Service Error]', err.message);
  }
};
