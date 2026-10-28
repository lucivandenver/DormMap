import { User } from '../models/userModel.js';

export const activeBarangayWhere = {
  accountType: 'barangay', applicationStatus: 'approved', isSuspended: false, isArchived: false,
};

export async function hasApprovedBarangay(barangay) {
  if (!String(barangay || '').trim()) return false;
  return Boolean(await User.findOne({ where: { ...activeBarangayWhere, barangay: String(barangay).trim() }, attributes: ['id'] }));
}

export const ownerBarangayError = 'This barangay does not have an approved, active official account yet. Please wait for BPLO to approve its barangay official before applying.';
