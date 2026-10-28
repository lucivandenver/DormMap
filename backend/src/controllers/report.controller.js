import { User, BoardingHouse, Permit, Tenant } from '../models/index.js';

export const getDashboardSummary = async (req, res, next) => {
  try {
    const userCount = await User.count();
    const boardingHouseCount = await BoardingHouse.count();
    const activePermits = await Permit.count({ where: { status: 'active' } });
    const activeTenants = await Tenant.count({ where: { status: 'active' } });

    res.json({ success: true, data: { userCount, boardingHouseCount, activePermits, activeTenants } });
  } catch (error) {
    next(error);
  }
};

export const getPermitReport = async (req, res, next) => {
  try {
    const permits = await Permit.findAll({ include: [{ model: BoardingHouse, as: 'boardingHouse' }] });
    res.json({ success: true, data: permits });
  } catch (error) {
    next(error);
  }
};

export const getTenantReport = async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role.name === 'owner') {
      where['$boardingHouse.owner_id$'] = req.user.id;
    }

    const tenants = await Tenant.findAll({
      where,
      include: [{ model: BoardingHouse, as: 'boardingHouse' }, { model: User, as: 'user' }],
    });
    res.json({ success: true, data: tenants });
  } catch (error) {
    next(error);
  }
};