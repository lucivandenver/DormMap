import { BoardingHouse, Barangay, User, AuditLog } from '../models/index.js';

export const listBoardingHouses = async (req, res, next) => {
  try {
    const houses = await BoardingHouse.findAll({
      include: [
        { model: Barangay, as: 'barangay', attributes: ['id', 'name'] },
        { model: User, as: 'owner', attributes: ['id', 'full_name', 'email', 'phone'] },
      ],
    });
    res.json({ success: true, data: houses });
  } catch (error) {
    next(error);
  }
};

export const getBoardingHouse = async (req, res, next) => {
  try {
    const house = await BoardingHouse.findByPk(req.params.id, {
      include: [{ model: Barangay, as: 'barangay' }, { model: User, as: 'owner', attributes: ['id', 'full_name', 'email', 'phone'] }],
    });
    if (!house) return res.status(404).json({ success: false, message: 'Boarding house not found.' });
    res.json({ success: true, data: house });
  } catch (error) {
    next(error);
  }
};

export const createBoardingHouse = async (req, res, next) => {
  try {
    const payload = { ...req.body, owner_id: req.user.id };
    const house = await BoardingHouse.create(payload);
    await AuditLog.create({ user_id: req.user.id, action: 'create_boarding_house', resource_type: 'boarding_house', resource_id: house.id, ip_address: req.ip });
    res.status(201).json({ success: true, data: house });
  } catch (error) {
    next(error);
  }
};

export const updateBoardingHouse = async (req, res, next) => {
  try {
    const house = await BoardingHouse.findByPk(req.params.id);
    if (!house) return res.status(404).json({ success: false, message: 'Boarding house not found.' });
    if (req.user.role.name === 'owner' && house.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only update your own boarding houses.' });
    }
    delete req.body.owner_id;
    await house.update(req.body);
    await AuditLog.create({ user_id: req.user.id, action: 'update_boarding_house', resource_type: 'boarding_house', resource_id: house.id, ip_address: req.ip });
    res.json({ success: true, data: house });
  } catch (error) {
    next(error);
  }
};
