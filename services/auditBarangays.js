import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { BoardingHouse } from '../models/ownerModels.js';
import { Barangay, BploDataSubmission, BploPermitRenewal } from '../models/adminModels.js';

export async function auditBarangays(logs) {
  const ids = type => [...new Set(logs.filter(log => log.entityType === type).map(log => log.entityId).filter(Boolean))];
  const models = [
    ['BoardingHouse', BoardingHouse, 'barangay'], ['Barangay', Barangay, 'name'],
    ['BploDataSubmission', BploDataSubmission, 'barangay'], ['BploPermitRenewal', BploPermitRenewal, 'barangay']
  ];
  const [users, ...targets] = await Promise.all([
    User.findAll({
      where: { id: { [Op.in]: [...new Set([...ids('User'), ...logs.map(log => log.actorId).filter(Boolean)])] } },
      attributes: ['id', 'fullName', 'barangay', 'accountType'], raw: true
    }),
    ...models.map(async ([type, model, name]) => {
      const matches = ids(type);
      const rows = matches.length ? await model.findAll({ where: { id: { [Op.in]: matches } }, attributes: ['id', name], raw: true }) : [];
      return [type, new Map(rows.map(row => [row.id, row[name]]))];
    })
  ]);
  const people = new Map(users.map(user => [user.id, user]));
  const locations = new Map(targets);
  return logs.map(record => {
    const log = record.toJSON();
    const actor = people.get(log.actorId);
    const target = log.entityType === 'User' ? people.get(log.entityId) : null;
    const barangay = log.details?.barangay || target?.barangay || locations.get(log.entityType)?.get(log.entityId) ||
      (actor?.accountType === 'barangay' ? actor.barangay : null);
    return { ...log, barangay: barangay || null, actorName: actor?.fullName || null };
  });
}
