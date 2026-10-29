import { Op } from 'sequelize';
import { BoardingHouse, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
export async function inventorySummary(owners) {
  const ids = owners.map(owner => owner.id);
  const [houses, rooms, tenants] = await Promise.all([
    BoardingHouse.findAll({ where: { ownerId: { [Op.in]: ids } } }),
    OwnerRoom.findAll({ where: { ownerId: { [Op.in]: ids } } }),
    OwnerTenant.findAll({ where: { ownerId: { [Op.in]: ids }, status: 'active' }, attributes: ['id','roomId','occupantCount'] }),
  ]);
  const totalCapacity = rooms.reduce((sum, room) => sum + Number(room.capacity), 0);
  const occupiedIds = new Set(tenants.map(tenant => tenant.roomId).filter(Boolean));
  const approvedIds = new Set(owners.filter(owner => ['approved','approved_barangay'].includes(owner.applicationStatus) && !owner.isSuspended && !owner.publicMapUnregistered).map(owner => owner.id));
  const represented = new Set(houses.map(house => house.ownerId));
  const legacy = owners.filter(owner => owner.boardingHouseName && !represented.has(owner.id));
  return {
    houses: houses.length + legacy.length,
    activeHouses: houses.filter(house => approvedIds.has(house.ownerId) && house.approvalStatus === 'approved').length + legacy.filter(owner => approvedIds.has(owner.id)).length,
    tenants: tenants.reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0),
    availableRooms: rooms.filter(room => room.status === 'available' && room.availableSlots > 0).length,
    occupiedRooms: rooms.filter(room => occupiedIds.has(room.id)).length,
    availableSlots: rooms.filter(room => room.status === 'available').reduce((sum, room) => sum + Number(room.availableSlots), 0),
    occupancy: totalCapacity ? Math.min(100, Math.round(100 * tenants.filter(tenant => tenant.roomId).reduce((sum,tenant) => sum + Number(tenant.occupantCount || 1),0) / totalCapacity)) : 0,
  };
}
