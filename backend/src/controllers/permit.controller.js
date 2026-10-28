import { Permit, BoardingHouse, AuditLog } from '../models/index.js';

export const listPermits = async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role.name === 'owner') {
      where['$boardingHouse.owner_id$'] = req.user.id;
    }

    const permits = await Permit.findAll({
      where,
      include: [{ model: BoardingHouse, as: 'boardingHouse' }],
    });
    res.json({ success: true, data: permits });
  } catch (error) {
    next(error);
  }
};

export const getPermit = async (req, res, next) => {
  try {
    const permit = await Permit.findByPk(req.params.id, { include: [{ model: BoardingHouse, as: 'boardingHouse' }] });
    if (!permit) return res.status(404).json({ success: false, message: 'Permit not found.' });
    if (req.user.role.name === 'owner' && permit.boardingHouse.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    res.json({ success: true, data: permit });
  } catch (error) {
    next(error);
  }
};

export const createPermit = async (req, res, next) => {
  try {
    const permit = await Permit.create(req.body);
    await AuditLog.create({ user_id: req.user.id, action: 'create_permit', resource_type: 'permit', resource_id: permit.id, ip_address: req.ip });
    res.status(201).json({ success: true, data: permit });
  } catch (error) {
    next(error);
  }
};

export const updatePermit = async (req, res, next) => {
  try {
    const permit = await Permit.findByPk(req.params.id);
    if (!permit) return res.status(404).json({ success: false, message: 'Permit not found.' });
    await permit.update(req.body);
    await AuditLog.create({ user_id: req.user.id, action: 'update_permit', resource_type: 'permit', resource_id: permit.id, ip_address: req.ip });
    res.json({ success: true, data: permit });
  } catch (error) {
    next(error);
  }
};