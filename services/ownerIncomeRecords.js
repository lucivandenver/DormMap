import { Op } from 'sequelize';
import { TenantApplication } from '../models/tenantModels.js';

export function approvedReservations(ownerId) {
  return TenantApplication.findAll({
    where: { ownerId, reservationApprovedAt: { [Op.ne]: null } },
    attributes: ['boardingHouseId', 'reservationRoomId', 'reservationApprovedAt', 'reservationFee', 'reservationAmountPaid'],
  });
}
