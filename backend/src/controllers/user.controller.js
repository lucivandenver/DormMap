import { User, Role, Barangay, AuditLog } from '../models/index.js';

export const getUsers = async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      include: ['role', 'barangay'],
    });
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

export const getUser = async (req, res, next) => {
  try {
    if (req.user.role.name !== 'super_admin' && req.user.role.name !== 'barangay_official' && req.user.id !== Number(req.params.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ['password'] }, include: ['role', 'barangay'] });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    if (req.user.role.name !== 'super_admin' && req.user.id !== Number(req.params.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const allowedFields = req.user.role.name === 'super_admin'
      ? ['full_name', 'email', 'phone', 'profile_picture', 'barangay_id', 'is_active', 'is_approved', 'approved_by', 'approved_at', 'role_id']
      : ['full_name', 'email', 'phone', 'profile_picture'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedFields.includes(key)));
    await user.update(updates);
    await AuditLog.create({ user_id: req.user.id, action: 'update_user', resource_type: 'user', resource_id: user.id, ip_address: req.ip });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await user.destroy();
    await AuditLog.create({ user_id: req.user.id, action: 'delete_user', resource_type: 'user', resource_id: user.id, ip_address: req.ip });
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    next(error);
  }
};
