import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const MaintenanceRequest = sequelize.define('MaintenanceRequest', {
  tenantId:     { type: DataTypes.INTEGER, allowNull: false },
  ownerId:      { type: DataTypes.INTEGER, allowNull: false },
  roomId:       { type: DataTypes.INTEGER, allowNull: true },
  title:        { type: DataTypes.STRING,  allowNull: false },
  description:  { type: DataTypes.TEXT,    allowNull: false },
  category:     { type: DataTypes.STRING,  allowNull: false, defaultValue: 'general' }, // plumbing, electrical, appliance, furniture, structural, general
  priority:     { type: DataTypes.STRING,  allowNull: false, defaultValue: 'medium' },  // low, medium, high, urgent
  status:       { type: DataTypes.STRING,  allowNull: false, defaultValue: 'pending' }, // pending, in_progress, resolved, rejected
  photos:       { type: DataTypes.TEXT,    allowNull: true }, // JSON string or comma-separated image URLs
  ownerResponse:{ type: DataTypes.TEXT,    allowNull: true },
  resolvedAt:   { type: DataTypes.DATE,    allowNull: true },
}, { tableName: 'TenantMaintenanceRequests' });

export const TenantDocument = sequelize.define('TenantDocument', {
  tenantId:    { type: DataTypes.INTEGER, allowNull: false },
  ownerId:     { type: DataTypes.INTEGER, allowNull: true },
  title:       { type: DataTypes.STRING,  allowNull: false },
  docType:     { type: DataTypes.STRING,  allowNull: false, defaultValue: 'receipt' }, // contract, receipt, form, identification, other
  fileUrl:     { type: DataTypes.TEXT,    allowNull: false },
  fileSize:    { type: DataTypes.STRING,  allowNull: true },
  description: { type: DataTypes.TEXT,    allowNull: true },
}, { tableName: 'TenantDocuments' });

export const TenantApplication = sequelize.define('TenantApplication', {
  tenantId:          { type: DataTypes.INTEGER, allowNull: false }, // User.id (tenant)
  ownerId:           { type: DataTypes.INTEGER, allowNull: false }, // User.id (owner)
  boardingHouseId:   { type: DataTypes.INTEGER, allowNull: true },  // BoardingHouse.id if assigned
  boardingHouseName: { type: DataTypes.STRING,  allowNull: false },
  requestedRoomType: { type: DataTypes.STRING,  allowNull: true },
  roomId:            { type: DataTypes.INTEGER, allowNull: true },  // Room offered by owner
  monthlyRent:       { type: DataTypes.DECIMAL(10,2), allowNull: true },
  moveInDate:        { type: DataTypes.DATEONLY, allowNull: true },
  message:           { type: DataTypes.TEXT,    allowNull: true },
  status:            {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending_owner'
    // 'pending_owner'       -> tenant applied, awaiting landlord response
    // 'accepted_by_owner'   -> owner accepted & offered room, awaiting tenant confirmation back
    // 'confirmed'           -> tenant confirmed back, officially active tenant
    // 'declined_by_owner'   -> owner rejected
    // 'cancelled_by_tenant' -> tenant cancelled or picked another boarding house
  },
  ownerNotes:        { type: DataTypes.TEXT,    allowNull: true },
  acceptedAt:        { type: DataTypes.DATE,    allowNull: true },
  confirmedAt:       { type: DataTypes.DATE,    allowNull: true },
}, { tableName: 'TenantApplications' });

export const ensureTenantSchema = async () => {
  await MaintenanceRequest.sync();
  await TenantDocument.sync();
  await TenantApplication.sync({ alter: true });
};

