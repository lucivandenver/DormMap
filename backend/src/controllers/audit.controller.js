import { AuditLog, User } from '../models/index.js';

export const listAuditLogs = async (req, res, next) => {
  try {
    const logs = await AuditLog.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'full_name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
};