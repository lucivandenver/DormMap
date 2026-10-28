import { Barangay, AuditLog } from '../models/index.js';

export const listBarangays = async (req, res, next) => {
  try {
    const barangays = await Barangay.findAll();
    res.json({ success: true, data: barangays });
  } catch (error) {
    next(error);
  }
};

export const getBarangay = async (req, res, next) => {
  try {
    const barangay = await Barangay.findByPk(req.params.id);
    if (!barangay) return res.status(404).json({ success: false, message: 'Barangay not found.' });
    res.json({ success: true, data: barangay });
  } catch (error) {
    next(error);
  }
};

export const createBarangay = async (req, res, next) => {
  try {
    const barangay = await Barangay.create(req.body);
    await AuditLog.create({ user_id: req.user.id, action: 'create_barangay', resource_type: 'barangay', resource_id: barangay.id, ip_address: req.ip });
    res.status(201).json({ success: true, data: barangay });
  } catch (error) {
    next(error);
  }
};

export const updateBarangay = async (req, res, next) => {
  try {
    const barangay = await Barangay.findByPk(req.params.id);
    if (!barangay) return res.status(404).json({ success: false, message: 'Barangay not found.' });
    await barangay.update(req.body);
    await AuditLog.create({ user_id: req.user.id, action: 'update_barangay', resource_type: 'barangay', resource_id: barangay.id, ip_address: req.ip });
    res.json({ success: true, data: barangay });
  } catch (error) {
    next(error);
  }
};
