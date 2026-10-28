import { Role, syncModels } from '../models/index.js';

const defaultRoles = [
  { name: 'super_admin', label: 'Super Admin', description: 'Full access to all features.' },
  { name: 'barangay_official', label: 'Barangay Official', description: 'Manage barangay resources and permit approvals.' },
  { name: 'owner', label: 'Boarding House Owner', description: 'Manage boarding houses and tenants.' },
  { name: 'tenant', label: 'Tenant', description: 'Tenant access for room and profile management.' },
];

export const seedDefaultData = async () => {
  await syncModels();
  for (const role of defaultRoles) {
    await Role.findOrCreate({ where: { name: role.name }, defaults: role });
  }
};