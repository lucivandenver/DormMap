import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const SavedDorm = sequelize.define('SavedDorm', {
  tenantId: { type: DataTypes.INTEGER, allowNull: false },
  // Stable keys distinguish multiple houses owned by the same account.
  listingKey: { type: DataTypes.STRING(80), allowNull: false },
}, {
  tableName: 'TenantSavedDorms',
  indexes: [{ unique: true, fields: ['tenantId', 'listingKey'], name: 'tenant_saved_dorm_unique' }],
});
