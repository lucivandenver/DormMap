import { Message, User, AuditLog } from '../models/index.js';
import { Op } from 'sequelize';

export const listMessages = async (req, res, next) => {
  try {
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { sender_id: req.user.id },
          { recipient_id: req.user.id },
        ],
      },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'full_name', 'email'] },
        { model: User, as: 'recipient', attributes: ['id', 'full_name', 'email'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};

export const sendMessage = async (req, res, next) => {
  try {
    const message = await Message.create({ ...req.body, sender_id: req.user.id });
    await AuditLog.create({ user_id: req.user.id, action: 'send_message', resource_type: 'message', resource_id: message.id, ip_address: req.ip });
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
};

export const markMessageRead = async (req, res, next) => {
  try {
    const message = await Message.findByPk(req.params.id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    if (message.recipient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    await message.update({ is_read: true });
    res.json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
};