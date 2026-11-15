import { Op } from 'sequelize';
import { BoardingHouse, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { User } from '../models/userModel.js';

export function orderBranches(houses) {
  return [...houses].sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.id - b.id);
}

export async function tenantBranchAssignments({ barangay, ownerId, search = '' } = {}) {
  if (!ownerId && !barangay) return [];
  const ownerWhere = { accountType: 'boarding_house_owner', isArchived: false };
  if (ownerId) ownerWhere.id = ownerId;
  if (barangay) {
    const localBranches = await BoardingHouse.findAll({
      where: { barangay, approvalStatus: 'approved' }, attributes: ['ownerId']
    });
    ownerWhere[Op.or] = [
      { barangay },
      { id: { [Op.in]: [...new Set(localBranches.map(house => house.ownerId))] },
        applicationStatus: { [Op.in]: ['approved', 'approved_barangay'] }, isSuspended: false }
    ];
  }
  const owners = await User.findAll({
    where: ownerWhere, attributes: ['id', 'boardingHouseName', 'barangay']
  });
  if (!owners.length) return [];
  const where = { ownerId: { [Op.in]: owners.map(owner => owner.id) } };
  const tenantWhere = { ...where };
  if (search) tenantWhere[Op.or] = ['fullName', 'email', 'contactNumber']
    .map(field => ({ [field]: { [Op.like]: `%${search}%` } }));
  const [tenants, rooms, houses] = await Promise.all([
    OwnerTenant.findAll({ where: tenantWhere, order: [['createdAt', 'DESC']] }),
    OwnerRoom.findAll({ where, attributes: ['id', 'ownerId', 'boardingHouseId', 'roomNumber'] }),
    BoardingHouse.findAll({ where, attributes: ['id', 'ownerId', 'isPrimary', 'name', 'barangay', 'approvalStatus'] })
  ]);
  const ownersById = new Map(owners.map(owner => [owner.id, owner]));
  const roomsById = new Map(rooms.map(room => [room.id, room]));
  const branches = new Map();
  for (const house of orderBranches(houses)) {
    if (!branches.has(house.ownerId)) branches.set(house.ownerId, []);
    branches.get(house.ownerId).push(house);
  }

  return tenants.flatMap(tenant => {
    const owner = ownersById.get(tenant.ownerId);
    const candidateRoom = roomsById.get(tenant.roomId);
    const room = candidateRoom?.ownerId === owner.id ? candidateRoom : null;
    const owned = branches.get(owner.id) || [];
    const branchIndex = room?.boardingHouseId
      ? owned.findIndex(house => house.id === room.boardingHouseId)
      : room ? owned.findIndex(house => house.isPrimary) : -1;
    const branch = owned[branchIndex];
    if (barangay && (branch?.barangay || owner.barangay) !== barangay) return [];
    if (barangay && owner.barangay !== barangay && branch?.approvalStatus !== 'approved') return [];
    return [{
      ...tenant.get({ plain: true }),
      roomNumber: room?.roomNumber || null,
      selectedBoardingHouse: owner.boardingHouseName || branch?.name || '',
      branchNumber: branchIndex >= 0 ? branchIndex + 1 : room && !room.boardingHouseId ? 1 : null
    }];
  });
}
