import { Tenant, BoardingHouse, Room, User, AuditLog } from '../models/index.js';

export const listTenants = async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role.name === 'owner') {
      where['$boardingHouse.owner_id$'] = req.user.id;
    }
    if (req.user.role.name === 'tenant') {
      where.user_id = req.user.id;
    }

    const tenants = await Tenant.findAll({
      where,
      include: [
        { model: BoardingHouse, as: 'boardingHouse' },
        { model: User, as: 'user' },
        { model: Room, as: 'room' },
      ],
    });
    res.json({ success: true, data: tenants });
  } catch (error) {
    next(error);
  }
};

export const getTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id, {
      include: [
        { model: BoardingHouse, as: 'boardingHouse' },
        { model: User, as: 'user' },
        { model: Room, as: 'room' },
      ],
    });
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    if (req.user.role.name === 'tenant' && tenant.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    if (req.user.role.name === 'owner' && tenant.boardingHouse.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    res.json({ success: true, data: tenant });
  } catch (error) {
    next(error);
  }
};

export const createTenant = async (req, res, next) => {
  try {
    const { boarding_house_id } = req.body;
    const boardingHouse = await BoardingHouse.findByPk(boarding_house_id);
    if (!boardingHouse || boardingHouse.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only add tenants to your boarding houses.' });
    }
    const tenant = await Tenant.create({ ...req.body, user_id: req.body.user_id });
    await AuditLog.create({ user_id: req.user.id, action: 'create_tenant', resource_type: 'tenant', resource_id: tenant.id, ip_address: req.ip });
    res.status(201).json({ success: true, data: tenant });
  } catch (error) {
    next(error);
  }
};

export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id, { include: [{ model: BoardingHouse, as: 'boardingHouse' }] });
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    if (req.user.role.name === 'owner' && tenant.boardingHouse.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    await tenant.update(req.body);
    await AuditLog.create({ user_id: req.user.id, action: 'update_tenant', resource_type: 'tenant', resource_id: tenant.id, ip_address: req.ip });
    res.json({ success: true, data: tenant });
  } catch (error) {
    next(error);
  }
};