import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { activeBarangayWhere } from './registrationPolicy.js';

export function approvedBarangayOfficials(names) {
  return User.findAll({
    where: { ...activeBarangayWhere, barangay: names ? { [Op.in]: names } : { [Op.ne]: null } },
    attributes: ['id', 'barangay', 'fullName', 'email'], order: [['barangay', 'ASC'], ['id', 'ASC']]
  });
}

export function requestTargetNames(request, legacyAll = []) {
  if (!request.targetBarangays) return request.targetType === 'all_barangays' ? legacyAll : [];
  try {
    const names = JSON.parse(request.targetBarangays);
    return Array.isArray(names) ? names : [];
  } catch { return []; }
}

export function isRequestTargeted(request, barangay) {
  return requestTargetNames(request, [barangay]).includes(barangay);
}
