import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { User, Role, AuditLog } from '../models/index.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname });

const signToken = (user) => {
  return jwt.sign({ id: user.id, role: user.role.name }, process.env.JWT_SECRET || 'dormap-secret', {
    expiresIn: '12h',
  });
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email }, include: ['role', 'barangay'] });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    if (!user.is_active || !user.is_approved) {
      return res.status(403).json({ success: false, message: 'This account is pending approval or inactive.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    const token = signToken(user);
    await AuditLog.create({ user_id: user.id, action: 'login', resource_type: 'user', resource_id: user.id, ip_address: req.ip });

    res.json({ success: true, data: { token, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role.name, barangay: user.barangay?.name || null } } });
  } catch (error) {
    next(error);
  }
};

export const register = async (req, res, next) => {
  try {
    const { full_name, email, password, role, barangay_id, phone } = req.body;
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const roleRecord = await Role.findOne({ where: { name: role } });
    if (!roleRecord) {
      return res.status(400).json({ success: false, message: 'Invalid role selected.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ full_name, email, password: hashedPassword, phone, role_id: roleRecord.id, barangay_id: barangay_id || null, is_active: role === 'tenant' ? true : false, is_approved: role === 'tenant' ? true : false });
    await AuditLog.create({ user_id: user.id, action: 'register', resource_type: 'user', resource_id: user.id, ip_address: req.ip });

    res.status(201).json({ success: true, data: { id: user.id, email: user.email, role: roleRecord.name } });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res) => {
  res.status(200).json({ success: true, message: 'Refresh token not implemented.' });
};
