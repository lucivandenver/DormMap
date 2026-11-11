import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { ownerLock } from './occupancyService.js';
import { BoardingHouse, OwnerRoom, OwnerNotification } from '../models/ownerModels.js';
const applicationStatuses = new Set(['pending', 'revision_requested']);

function branchJurisdiction(barangay) {
  if (!barangay?.trim()) throw Object.assign(new Error('No assigned barangay.'), { status: 422 });
  return { isPrimary: false, barangay };
}

export async function listBarangayBranches(barangay) {
  const branches = await BoardingHouse.findAll({
    where: branchJurisdiction(barangay),
    attributes: ['id', 'ownerId', 'name', 'barangay', 'address', 'propertyType', 'floorCount', 'approvalStatus', 'reviewNote'],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    raw: true,
  });
  const owners = branches.length ? await User.findAll({
    where: { id: [...new Set(branches.map(branch => branch.ownerId))], accountType: 'boarding_house_owner', isArchived: false },
    attributes: ['id', 'fullName', 'boardingHouseName', 'barangay'],
    raw: true,
  }) : [];
  const groups = new Map(owners.map(owner => [owner.id, { ...owner, branches: [] }]));
  const applications = [];
  for (const branch of branches) {
    const group = groups.get(branch.ownerId);
    if (!group) continue;
    if (applicationStatuses.has(branch.approvalStatus)) {
      applications.push({ ...branch, ownerName: group.fullName, mainPropertyName: group.boardingHouseName });
    } else {
      group.branches.push(branch);
    }
  }
  return { data: applications, groups: [...groups.values()].filter(group => group.branches.length) };
}

export async function reviewBranch(id, action, note, barangay) {
  const status = { approve: 'approved', revision: 'revision_requested', suspend: 'suspended', reject: 'rejected' }[action];
  if (!status) throw Object.assign(new Error('Invalid branch review action.'), { status: 422 });
  const house = await BoardingHouse.findOne({ where: { id, ...branchJurisdiction(barangay) } });
  if (!house) throw Object.assign(new Error('Branch not found in your jurisdiction.'), { status: 404 });
  if (action !== 'approve' && !String(note || '').trim()) throw Object.assign(new Error('Provide a review note.'), { status: 422 });
  await sequelize.transaction(async transaction => {
    await ownerLock(house.ownerId, transaction);
    await house.reload({ transaction, lock: transaction.LOCK.UPDATE });
    if (action === 'approve' && !await OwnerRoom.count({ where: { boardingHouseId: house.id, ownerId: house.ownerId }, transaction })) throw Object.assign(new Error('The owner must add the branch room inventory before approval.'), { status: 422 });
    await house.update({ approvalStatus: status, reviewNote: String(note || '').trim().slice(0,2000) || null }, { transaction });
  });
  await OwnerNotification.create({ ownerId: house.ownerId, title: 'Branch review updated', body: `${house.name}: ${status}. ${note || ''}`, type: 'branch_review' }).catch(error => console.error('Branch notification failed:', error.message));
  return house;
}
