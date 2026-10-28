import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { User } from '../models/index.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname });

export const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.split(' ')[1] : null;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dormap-secret');
    const user = await User.findByPk(payload.id, { include: ['role', 'barangay'] });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token expired or invalid.' });
  }
};

export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role?.name)) {
      return res.status(403).json({ success: false, message: 'Forbidden: insufficient privileges.' });
    }
    next();
  };
};
