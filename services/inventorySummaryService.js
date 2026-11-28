import { Op } from 'sequelize';
import { reportDay } from './reportCalendar.js';
import { BoardingHouse, OwnerRoom, OwnerTenant } from '../models/ownerModels.js';
import { User } from '../models/userModel.js';
import { submittedOwnerWhere } from './registrationPolicy.js';

export async function barangayInventoryOwners(barangay) {
  const branches = await BoardingHouse.findAll({
    where: { barangay }, attributes: ['ownerId'], group: ['ownerId'], raw: true
  });
  return User.findAll({
    where: {
      accountType: 'boarding_house_owner', isArchived: false,
      [Op.or]: [{ barangay }, { id: { [Op.in]: branches.map(branch => branch.ownerId) } }]
    },
    attributes: ['id', 'barangay', 'applicationStatus', 'boardingHouseName', 'createdAt'],
    raw: true
  });
}

export async function municipalInventory() {
  const owners = await User.findAll({
    where: submittedOwnerWhere,
    attributes: ['id', 'boardingHouseName', 'applicationStatus', 'isSuspended', 'publicMapUnregistered']
  });
  return inventorySummary(owners);
}

export function ownerRoomCounts(rooms) {
  return {
    totalRooms: rooms.length,
    availableRooms: rooms.filter(room => room.status === 'available' && room.availableSlots > 0).length,
    occupiedRooms: rooms.filter(room => room.status === 'occupied').length
  };
}

export async function inventorySummary(owners, { barangay } = {}) {
  const ids = owners.map(owner => owner.id);
  const [year, month] = barangay ? reportDay().slice(0, 7).split('-').map(Number) : [];
  const periods = barangay ? new Map(Array.from({ length: 6 }, (_, index) => {
    const monthStart = new Date(Date.UTC(year, month - 6 + index, 1));
    const period = monthStart.toISOString().slice(0, 7);
    return [period, { period, properties: 0, tenants: 0 }];
  })) : null;
  const recentTenants = periods ? {
    [Op.or]: [{ status: 'active' }, { createdAt: { [Op.gte]: new Date(`${periods.keys().next().value}-01T00:00:00+08:00`) } }]
  } : { status: 'active' };
  const [houses, rooms, tenantRecords] = await Promise.all([
    BoardingHouse.findAll({ where: { ownerId: { [Op.in]: ids } } }),
    OwnerRoom.findAll({ where: { ownerId: { [Op.in]: ids } } }),
    OwnerTenant.findAll({
      where: { ownerId: { [Op.in]: ids }, ...recentTenants },
      attributes: barangay ? ['ownerId', 'roomId', 'occupantCount', 'status', 'createdAt'] : ['roomId', 'occupantCount']
    }),
  ]);
  if (barangay) return barangayInventory(owners, houses, rooms, tenantRecords, barangay, periods);

  const tenants = tenantRecords;
  const totalCapacity = rooms.reduce((sum, room) => sum + Number(room.capacity), 0);
  const occupiedIds = new Set(tenants.map(tenant => tenant.roomId).filter(Boolean));
  const approvedIds = new Set(owners.filter(owner => ['approved','approved_barangay'].includes(owner.applicationStatus) && !owner.isSuspended && !owner.publicMapUnregistered).map(owner => owner.id));
  const represented = new Set(houses.map(house => house.ownerId));
  const legacy = owners.filter(owner => owner.boardingHouseName && !represented.has(owner.id));
  return {
    totalRooms: rooms.length,
    houses: houses.length + legacy.length,
    activeHouses: houses.filter(house => approvedIds.has(house.ownerId) && house.approvalStatus === 'approved').length + legacy.filter(owner => approvedIds.has(owner.id)).length,
    tenants: tenants.reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0),
    availableRooms: rooms.filter(room => room.status === 'available' && room.availableSlots > 0).length,
    occupiedRooms: rooms.filter(room => occupiedIds.has(room.id)).length,
    availableSlots: rooms.filter(room => room.status === 'available').reduce((sum, room) => sum + Number(room.availableSlots), 0),
    occupancy: totalCapacity ? Math.min(100, Math.round(100 * tenants.filter(tenant => tenant.roomId).reduce((sum,tenant) => sum + Number(tenant.occupantCount || 1),0) / totalCapacity)) : 0,
  };
}

function barangayInventory(owners, houses, rooms, tenants, barangay, periods) {
  const ownersById = new Map(owners.map(owner => [owner.id, owner]));
  const ownersWithHouses = new Set(houses.map(house => house.ownerId));
  const propertiesById = new Map();
  const defaultProperty = new Map();
  const properties = [];

  const addProperty = (name, createdAt) => {
    const property = { name, createdAt, total: 0, occupied: 0, available: 0, unavailable: 0 };
    properties.push(property);
    return property;
  };
  for (const house of houses) {
    const owner = ownersById.get(house.ownerId);
    if ((house.barangay || owner.barangay) !== barangay) continue;
    const property = addProperty(house.name, house.createdAt);
    propertiesById.set(house.id, property);
    if (house.isPrimary) defaultProperty.set(house.ownerId, property);
  }
  for (const owner of owners) {
    if (owner.barangay === barangay && owner.boardingHouseName && !ownersWithHouses.has(owner.id)) {
      defaultProperty.set(owner.id, addProperty(owner.boardingHouseName, owner.createdAt));
    }
  }

  const roomsById = new Map();
  for (const room of rooms) {
    const property = room.boardingHouseId ? propertiesById.get(room.boardingHouseId) : defaultProperty.get(room.ownerId);
    if (property) roomsById.set(room.id, { room, property });
  }
  const occupied = new Set(tenants.filter(tenant => tenant.status === 'active').map(tenant => tenant.roomId));
  for (const { room, property } of roomsById.values()) {
    property.total++;
    if (occupied.has(room.id)) property.occupied++;
    else if (room.status === 'available' && room.availableSlots > 0) property.available++;
    else property.unavailable++;
  }
  const localTenants = tenants.filter(tenant => tenant.roomId
    ? roomsById.get(tenant.roomId)?.room.ownerId === tenant.ownerId
    : defaultProperty.has(tenant.ownerId));

  for (const property of properties) {
    const entry = periods.get(reportDay(property.createdAt).slice(0, 7));
    if (entry) entry.properties++;
  }
  for (const tenant of localTenants) {
    const entry = periods.get(reportDay(tenant.createdAt).slice(0, 7));
    if (entry) entry.tenants++;
  }

  return {
    totalRooms: roomsById.size,
    houses: properties.length,
    tenants: localTenants.filter(tenant => tenant.status === 'active')
      .reduce((sum, tenant) => sum + Number(tenant.occupantCount || 1), 0),
    availableRooms: properties.reduce((sum, property) => sum + property.available, 0),
    occupiedRooms: properties.reduce((sum, property) => sum + property.occupied, 0),
    unavailableRooms: properties.reduce((sum, property) => sum + property.unavailable, 0),
    monthly: [...periods.values()],
    properties: properties.filter(property => property.total > 0)
      .map(({ name, total, occupied }) => ({ name, total, occupied })),
  };
}
