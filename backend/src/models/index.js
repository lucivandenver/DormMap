import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';
import { RoleModel } from './role.model.js';
import { UserModel } from './user.model.js';
import { BarangayModel } from './barangay.model.js';
import { EducationalInstitutionModel } from './educationalInstitution.model.js';
import { BoardingHouseModel } from './boardingHouse.model.js';
import { PermitModel } from './permit.model.js';
import { RoomModel } from './room.model.js';
import { TenantModel } from './tenant.model.js';
import { MessageModel } from './message.model.js';
import { NotificationModel } from './notification.model.js';
import { AuditLogModel } from './auditLog.model.js';

export const Role = RoleModel(sequelize, DataTypes);
export const User = UserModel(sequelize, DataTypes);
export const Barangay = BarangayModel(sequelize, DataTypes);
export const EducationalInstitution = EducationalInstitutionModel(sequelize, DataTypes);
export const BoardingHouse = BoardingHouseModel(sequelize, DataTypes);
export const Permit = PermitModel(sequelize, DataTypes);
export const Room = RoomModel(sequelize, DataTypes);
export const Tenant = TenantModel(sequelize, DataTypes);
export const Message = MessageModel(sequelize, DataTypes);
export const Notification = NotificationModel(sequelize, DataTypes);
export const AuditLog = AuditLogModel(sequelize, DataTypes);

Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

Barangay.hasMany(User, { foreignKey: 'barangay_id', as: 'users' });
User.belongsTo(Barangay, { foreignKey: 'barangay_id', as: 'barangay' });

Barangay.hasMany(BoardingHouse, { foreignKey: 'barangay_id', as: 'boardingHouses' });
BoardingHouse.belongsTo(Barangay, { foreignKey: 'barangay_id', as: 'barangay' });

User.hasMany(BoardingHouse, { foreignKey: 'owner_id', as: 'ownedBoardingHouses' });
BoardingHouse.belongsTo(User, { foreignKey: 'owner_id', as: 'owner' });

BoardingHouse.hasMany(Permit, { foreignKey: 'boarding_house_id', as: 'permits' });
Permit.belongsTo(BoardingHouse, { foreignKey: 'boarding_house_id', as: 'boardingHouse' });

BoardingHouse.hasMany(Room, { foreignKey: 'boarding_house_id', as: 'rooms' });
Room.belongsTo(BoardingHouse, { foreignKey: 'boarding_house_id', as: 'boardingHouse' });

BoardingHouse.hasMany(Tenant, { foreignKey: 'boarding_house_id', as: 'tenants' });
Tenant.belongsTo(BoardingHouse, { foreignKey: 'boarding_house_id', as: 'boardingHouse' });

Room.hasMany(Tenant, { foreignKey: 'room_id', as: 'tenants' });
Tenant.belongsTo(Room, { foreignKey: 'room_id', as: 'room' });

User.hasMany(Tenant, { foreignKey: 'user_id', as: 'tenantRecords' });
Tenant.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(Message, { foreignKey: 'sender_id', as: 'sentMessages' });
User.hasMany(Message, { foreignKey: 'recipient_id', as: 'receivedMessages' });
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });
Message.belongsTo(User, { foreignKey: 'recipient_id', as: 'recipient' });

User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

export const models = {
  Role,
  User,
  Barangay,
  EducationalInstitution,
  BoardingHouse,
  Permit,
  Room,
  Tenant,
  Message,
  Notification,
  AuditLog,
};

export const syncModels = async ({ force = false, alter = false } = {}) => {
  await sequelize.sync({ alter, force });
};
