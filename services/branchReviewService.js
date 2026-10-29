import { sequelize } from '../models/db.js';
import { ownerLock } from './occupancyService.js';
import { BoardingHouse, OwnerRoom, OwnerNotification } from '../models/ownerModels.js';
export async function listBranchApplications(barangay = null) {
  return BoardingHouse.findAll({ where: { isPrimary: false, ...(barangay ? { barangay } : {}) }, order: [['createdAt','DESC']] });
}
export async function reviewBranch(id, action, note, barangay = null) {
  const status = { approve: 'approved', revision: 'revision_requested', suspend: 'suspended', reject: 'rejected' }[action];
  if (!status) throw Object.assign(new Error('Invalid branch review action.'), { status: 422 });
  const house = await BoardingHouse.findOne({ where: { id, isPrimary: false, ...(barangay ? { barangay } : {}) } });
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
