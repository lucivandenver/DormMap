import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const BoardingHouse = sequelize.define('BoardingHouse', {
  ownerId:      { type: DataTypes.INTEGER, allowNull: false },
  name:         { type: DataTypes.STRING,  allowNull: false },
  address:      { type: DataTypes.TEXT,    allowNull: true },
  barangay:     { type: DataTypes.STRING,  allowNull: true },
  latitude:     { type: DataTypes.STRING,  allowNull: true },
  longitude:    { type: DataTypes.STRING,  allowNull: true },
  mapPin:       { type: DataTypes.TEXT,    allowNull: true },
  picture:      { type: DataTypes.TEXT,    allowNull: true },
  description:  { type: DataTypes.TEXT,    allowNull: true },
  amenities:    { type: DataTypes.TEXT,    allowNull: true },
  houseRules:   { type: DataTypes.TEXT,    allowNull: true },
  isPrimary:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'BoardingHouses' });

export const OwnerRoom = sequelize.define('OwnerRoom', {
  ownerId:         { type: DataTypes.INTEGER, allowNull: false },
  boardingHouseId: { type: DataTypes.INTEGER, allowNull: true },
  roomNumber:      { type: DataTypes.STRING,  allowNull: false },
  roomType:        { type: DataTypes.STRING,  allowNull: false, defaultValue: 'Solo Room' },
  floor:           { type: DataTypes.STRING,  allowNull: false, defaultValue: '1st Floor' },
  capacity:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  availableSlots:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  rentalPrice:     { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
  dimensions:      { type: DataTypes.STRING,  allowNull: true },
  genderPref:      { type: DataTypes.STRING,  allowNull: true, defaultValue: 'Any' },
  furnished:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  aircon:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  status:          { type: DataTypes.STRING,  allowNull: false, defaultValue: 'available' },
  amenities:       { type: DataTypes.TEXT,    allowNull: true },
  photos:          { type: DataTypes.TEXT,    allowNull: true },
  description:     { type: DataTypes.TEXT,    allowNull: true },
}, { tableName: 'OwnerRooms' });

export const OwnerTenant = sequelize.define('OwnerTenant', {
  ownerId:          { type: DataTypes.INTEGER, allowNull: false },
  roomId:           { type: DataTypes.INTEGER, allowNull: true },
  fullName:         { type: DataTypes.STRING,  allowNull: false },
  email:            { type: DataTypes.STRING,  allowNull: true },
  contactNumber:    { type: DataTypes.STRING,  allowNull: true },
  emergencyContact: { type: DataTypes.STRING,  allowNull: true },
  emergencyPhone:   { type: DataTypes.STRING,  allowNull: true },
  moveInDate:       { type: DataTypes.DATEONLY, allowNull: true },
  moveOutDate:      { type: DataTypes.DATEONLY, allowNull: true },
  monthlyRent:      { type: DataTypes.DECIMAL(10,2), allowNull: true },
  balance:          { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
  contractStart:    { type: DataTypes.DATEONLY, allowNull: true },
  contractEnd:      { type: DataTypes.DATEONLY, allowNull: true },
  status:           { type: DataTypes.STRING,  allowNull: false, defaultValue: 'active' },
  notes:            { type: DataTypes.TEXT,    allowNull: true },
}, { tableName: 'OwnerTenants' });

export const OwnerPayment = sequelize.define('OwnerPayment', {
  ownerId:       { type: DataTypes.INTEGER, allowNull: false },
  tenantId:      { type: DataTypes.INTEGER, allowNull: false },
  roomId:        { type: DataTypes.INTEGER, allowNull: true },
  amount:        { type: DataTypes.DECIMAL(10,2), allowNull: false },
  dueDate:       { type: DataTypes.DATEONLY, allowNull: false },
  paidDate:      { type: DataTypes.DATEONLY, allowNull: true },
  status:        { type: DataTypes.STRING,  allowNull: false, defaultValue: 'pending' },
  penalty:       { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0 },
  method:        { type: DataTypes.STRING,  allowNull: true },
  reference:     { type: DataTypes.STRING,  allowNull: true },
  notes:         { type: DataTypes.TEXT,    allowNull: true },
  month:         { type: DataTypes.STRING,  allowNull: true },
}, { tableName: 'OwnerPayments' });

export const OwnerInquiry = sequelize.define('OwnerInquiry', {
  ownerId:     { type: DataTypes.INTEGER, allowNull: false },
  clientName:  { type: DataTypes.STRING,  allowNull: false },
  clientEmail: { type: DataTypes.STRING,  allowNull: true },
  clientPhone: { type: DataTypes.STRING,  allowNull: true },
  message:     { type: DataTypes.TEXT,    allowNull: false },
  reply:       { type: DataTypes.TEXT,    allowNull: true },
  status:      { type: DataTypes.STRING,  allowNull: false, defaultValue: 'new' },
  visitDate:   { type: DataTypes.DATE,    allowNull: true },
  isArchived:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'OwnerInquiries' });

export const OwnerMessage = sequelize.define('OwnerMessage', {
  ownerId:     { type: DataTypes.INTEGER, allowNull: false },
  senderId:    { type: DataTypes.INTEGER, allowNull: false },
  recipientId: { type: DataTypes.INTEGER, allowNull: false },
  message:     { type: DataTypes.TEXT,    allowNull: false },
  isRead:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  subject:     { type: DataTypes.STRING,  allowNull: true },
}, { tableName: 'OwnerMessages' });

export const OwnerNotification = sequelize.define('OwnerNotification', {
  ownerId:  { type: DataTypes.INTEGER, allowNull: false },
  title:    { type: DataTypes.STRING,  allowNull: false },
  body:     { type: DataTypes.TEXT,    allowNull: false },
  type:     { type: DataTypes.STRING,  allowNull: false, defaultValue: 'info' },
  isRead:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  link:     { type: DataTypes.STRING,  allowNull: true },
}, { tableName: 'OwnerNotifications' });

export const OwnerActivityLog = sequelize.define('OwnerActivityLog', {
  ownerId:    { type: DataTypes.INTEGER, allowNull: false },
  action:     { type: DataTypes.STRING,  allowNull: false },
  entityType: { type: DataTypes.STRING,  allowNull: true },
  entityId:   { type: DataTypes.INTEGER, allowNull: true },
  details:    { type: DataTypes.JSON,    allowNull: true },
  ipAddress:  { type: DataTypes.STRING,  allowNull: true },
}, { tableName: 'OwnerActivityLogs' });

export const OwnerGallery = sequelize.define('OwnerGallery', {
  ownerId:         { type: DataTypes.INTEGER, allowNull: false },
  boardingHouseId: { type: DataTypes.INTEGER, allowNull: true },
  imageUrl:        { type: DataTypes.TEXT,    allowNull: false },
  caption:         { type: DataTypes.STRING,  allowNull: true },
  sortOrder:       { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  imageType:       { type: DataTypes.STRING,  allowNull: true, defaultValue: 'gallery' },
}, { tableName: 'OwnerGallery' });


export const ensureOwnerSchema = async () => {
  await BoardingHouse.sync({ alter: true });
  await OwnerRoom.sync({ alter: true });
  await OwnerTenant.sync({ alter: true });
  await OwnerPayment.sync();
  await OwnerInquiry.sync();
  await OwnerMessage.sync();
  await OwnerNotification.sync();
  await OwnerActivityLog.sync();
  await OwnerGallery.sync({ alter: true });

  // Add extra columns to OwnerGallery if needed
  const queryInterface = sequelize.getQueryInterface();
  try {
    const galleryColumns = await queryInterface.describeTable('OwnerGallery');
    if (!galleryColumns.boardingHouseId) {
      await queryInterface.addColumn('OwnerGallery', 'boardingHouseId', {
        type: DataTypes.INTEGER,
        allowNull: true
      });
    }
  } catch (err) {
    console.error('Error checking OwnerGallery columns:', err);
  }

  // Add extra columns to Users table for boarding house owner profile
  const columns = await queryInterface.describeTable('Users');
  const extras = {
    amenities:      { type: DataTypes.TEXT,   allowNull: true },
    houseRules:     { type: DataTypes.TEXT,   allowNull: true },
    coverImage:     { type: DataTypes.TEXT,   allowNull: true },
    operatingHours: { type: DataTypes.STRING, allowNull: true },
    description:    { type: DataTypes.TEXT,   allowNull: true },
    rentalPriceMin: { type: DataTypes.DECIMAL(10,2), allowNull: true },
    rentalPriceMax: { type: DataTypes.DECIMAL(10,2), allowNull: true },
    positionTitle:  { type: DataTypes.STRING, allowNull: true },
  };
  for (const [col, def] of Object.entries(extras)) {
    if (!columns[col]) await queryInterface.addColumn('Users', col, def);
  }
};
