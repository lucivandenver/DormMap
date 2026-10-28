import { Op } from 'sequelize';
import { OwnerTenant } from '../models/ownerModels.js';

export async function findActiveRental(user, options = {}) {
  // Names and phone numbers are not account identifiers. Legacy email matches must be unambiguous.
  const linked = await OwnerTenant.findAll({ where: { tenantUserId: user.id, status: 'active' }, ...options });
  if (linked.length > 1) throw Object.assign(new Error('Multiple active rentals are linked to your account. Ask your owner to correct the assignments.'), { status: 409 });
  if (linked[0]) return linked[0];
  if (!user.email) return null;
  const legacy = await OwnerTenant.findAll({ where: { tenantUserId: { [Op.is]: null }, email: user.email.trim().toLowerCase(), status: 'active' }, ...options });
  if (legacy.length > 1) throw Object.assign(new Error('Multiple active rental records match your email. Ask your owner to link the correct tenancy.'), { status: 409 });
  return legacy[0] || null;
}
