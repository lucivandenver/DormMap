import { BoardingHouse, Barangay, User } from '../models/index.js';

export const listMapBoardingHouses = async (req, res, next) => {
  try {
    const { barangay_id, owner_id, verified } = req.query;
    const where = {};
    if (barangay_id) where.barangay_id = barangay_id;
    if (owner_id) where.owner_id = owner_id;
    if (verified !== undefined) where.is_verified = verified === 'true';

    const houses = await BoardingHouse.findAll({
      where,
      include: [
        { model: Barangay, as: 'barangay', attributes: ['id', 'name'] },
        { model: User, as: 'owner', attributes: ['id', 'full_name', 'email'] },
      ],
    });
    res.json({ success: true, data: houses });
  } catch (error) {
    next(error);
  }
};
