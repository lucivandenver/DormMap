import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { ensureOwnerSchema } from './ownerModels.js';
import { ensureTenantSchema } from './tenantModels.js';
import { ensurePaymentSchema } from './paymentModels.js';

export const Barangay = sequelize.define('Barangay', {
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  officialName: { type: DataTypes.STRING, allowNull: true },
  officialEmail: { type: DataTypes.STRING, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'BploBarangays' });

export const EducationalInstitution = sequelize.define('EducationalInstitution', {
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  schoolType: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.TEXT, allowNull: true },
  latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  barangay: { type: DataTypes.STRING, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'BploEducationalInstitutions' });

export const BusinessPermit = sequelize.define('BusinessPermit', {
  ownerId: { type: DataTypes.INTEGER, allowNull: false },
  permitNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  issueDate: { type: DataTypes.DATEONLY, allowNull: true },
  expirationDate: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.ENUM('active', 'pending', 'expired', 'renewal_requested', 'rejected'), allowNull: false, defaultValue: 'pending' },
  documentUrl: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'BploBusinessPermits' });

export const AdminAuditLog = sequelize.define('AdminAuditLog', {
  actorId: { type: DataTypes.INTEGER, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false },
  entityType: { type: DataTypes.STRING, allowNull: false },
  entityId: { type: DataTypes.INTEGER, allowNull: true },
  details: { type: DataTypes.JSON, allowNull: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
}, { tableName: 'BploAdminAuditLogs' });

export const Announcement = sequelize.define('Announcement', {
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  audience: { type: DataTypes.STRING, allowNull: false, defaultValue: 'all' },
  publishedBy: { type: DataTypes.INTEGER, allowNull: false },
  isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'BploAnnouncements' });

export const BarangayMessage = sequelize.define('BarangayMessage', {
  senderId: { type: DataTypes.INTEGER, allowNull: false },
  recipientId: { type: DataTypes.INTEGER, allowNull: false },
  subject: { type: DataTypes.STRING, allowNull: true },
  message: { type: DataTypes.TEXT, allowNull: false },
  isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'BploMessages' });

export const BarangayNotification = sequelize.define('BarangayNotification', {
  userId: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'BploNotifications' });

// ==========================================
// TWO-WAY DATA MANAGEMENT & WORKFLOW MODELS
// ==========================================

export const BploDataRequest = sequelize.define('BploDataRequest', {
  title: { type: DataTypes.STRING, allowNull: false },
  category: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    defaultValue: 'updated_masterlist' // updated_masterlist, unregistered_houses, permit_renewals, expired_permits, new_establishments, closed_establishments, occupancy_tenants, ownership_changes, location_changes, general_compliance, other
  },
  purpose: { type: DataTypes.TEXT, allowNull: false },
  reportingPeriod: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    defaultValue: 'monthly' // monthly, quarterly, semi_annual, yearly, on_demand
  },
  periodDetails: { type: DataTypes.STRING, allowNull: true }, // e.g. "Q1 2026", "March 2026"
  submissionDeadline: { type: DataTypes.DATEONLY, allowNull: false },
  priority: { 
    type: DataTypes.ENUM('normal', 'high', 'urgent'), 
    allowNull: false, 
    defaultValue: 'normal' 
  },
  targetType: { 
    type: DataTypes.ENUM('all_barangays', 'selected_barangays'), 
    allowNull: false, 
    defaultValue: 'all_barangays' 
  },
  targetBarangays: { type: DataTypes.TEXT, allowNull: true }, // JSON array of barangay names
  requiredFormat: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PDF, XLSX, CSV' },
  instructions: { type: DataTypes.TEXT, allowNull: true },
  status: { 
    type: DataTypes.ENUM('active', 'completed', 'cancelled', 'archived'), 
    allowNull: false, 
    defaultValue: 'active' 
  },
  createdBy: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'BploDataRequests' });

export const BploDataSubmission = sequelize.define('BploDataSubmission', {
  requestId: { type: DataTypes.INTEGER, allowNull: true }, // null if voluntary / on-demand
  barangay: { type: DataTypes.STRING, allowNull: false },
  submittedBy: { type: DataTypes.INTEGER, allowNull: false },
  submissionType: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    defaultValue: 'requested_report' // requested_report, unregistered_houses, new_establishments, closed_establishments, permit_renewals, ownership_changes, location_changes, occupancy_update, general_update
  },
  title: { type: DataTypes.STRING, allowNull: false },
  reportingPeriod: { type: DataTypes.STRING, allowNull: true },
  status: { 
    type: DataTypes.ENUM('submitted', 'under_review', 'revision_requested', 'approved', 'rejected', 'archived'), 
    allowNull: false, 
    defaultValue: 'submitted' 
  },
  fileUrl: { type: DataTypes.TEXT, allowNull: true },
  fileName: { type: DataTypes.STRING, allowNull: true },
  fileFormat: { type: DataTypes.STRING, allowNull: true }, // pdf, xlsx, csv, etc.
  fileSize: { type: DataTypes.INTEGER, allowNull: true },
  summaryData: { type: DataTypes.JSON, allowNull: true }, // JSON stats (totalHouses, registered, unregistered, rooms, tenants, etc.)
  remarks: { type: DataTypes.TEXT, allowNull: true },
  adminRemarks: { type: DataTypes.TEXT, allowNull: true },
  reviewedBy: { type: DataTypes.INTEGER, allowNull: true },
  reviewedAt: { type: DataTypes.DATE, allowNull: true },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  previousSubmissionId: { type: DataTypes.INTEGER, allowNull: true },
  attachments: { type: DataTypes.JSON, allowNull: true }, // Array of supporting documents
}, { tableName: 'BploDataSubmissions' });

export const BploPermitRenewal = sequelize.define('BploPermitRenewal', {
  ownerId: { type: DataTypes.INTEGER, allowNull: false },
  barangay: { type: DataTypes.STRING, allowNull: false },
  permitNumber: { type: DataTypes.STRING, allowNull: true },
  currentExpirationDate: { type: DataTypes.DATEONLY, allowNull: true },
  requestedRenewalDate: { type: DataTypes.DATEONLY, allowNull: true },
  status: { 
    type: DataTypes.ENUM('pending_barangay', 'barangay_approved', 'forwarded_to_bplo', 'bplo_approved', 'revision_required', 'rejected'), 
    allowNull: false, 
    defaultValue: 'pending_barangay' 
  },
  documents: { type: DataTypes.JSON, allowNull: true }, // { barangayClearance, sanitaryPermit, fireClearance, receipt }
  barangayNotes: { type: DataTypes.TEXT, allowNull: true },
  bploNotes: { type: DataTypes.TEXT, allowNull: true },
  reviewedByBarangay: { type: DataTypes.INTEGER, allowNull: true },
  reviewedByBplo: { type: DataTypes.INTEGER, allowNull: true },
  reviewedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'BploPermitRenewals' });

export const BploSystemSetting = sequelize.define('BploSystemSetting', {
  key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  value: { type: DataTypes.TEXT, allowNull: false },
  category: { type: DataTypes.STRING, allowNull: false, defaultValue: 'general' }, // general, reporting, notifications, permits, maintenance, security
  description: { type: DataTypes.STRING, allowNull: true },
  updatedBy: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'BploSystemSettings' });

// ==========================================
// SCHEMA SYNCHRONIZATION & AUTO-SEEDING
// ==========================================

export const ensureAdminSchema = async () => {
  await sequelize.sync();
  await ensureOwnerSchema();
  await ensureTenantSchema();
  await ensurePaymentSchema();
  const queryInterface = sequelize.getQueryInterface();
  const additions = {
    contactNumber: { type: DataTypes.STRING, allowNull: true },
    gender: { type: DataTypes.STRING, allowNull: true },
    gcashNumber: { type: DataTypes.STRING, allowNull: true },
    gcashName: { type: DataTypes.STRING, allowNull: true },
    gcashQrCode: { type: DataTypes.TEXT, allowNull: true },
    barangayClearance: { type: DataTypes.TEXT, allowNull: true },
    proofOfOwnership: { type: DataTypes.TEXT, allowNull: true },
    rentalPermit: { type: DataTypes.TEXT, allowNull: true },
    occupiedRooms: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    applicationStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'approved' },
    applicationReviewedAt: { type: DataTypes.DATE, allowNull: true },
    applicationReviewNote: { type: DataTypes.TEXT, allowNull: true },
    isSuspended: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isArchived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    resetPasswordToken: { type: DataTypes.STRING, allowNull: true },
    resetPasswordExpires: { type: DataTypes.DATE, allowNull: true },
    // New columns for gallery photos, pricing, and room details
    roomTypes: { type: DataTypes.TEXT, allowNull: true },
    houseRules: { type: DataTypes.TEXT, allowNull: true },
    amenities: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    rentalPriceMin: { type: DataTypes.FLOAT, allowNull: true },
    rentalPriceMax: { type: DataTypes.FLOAT, allowNull: true },
    operatingHours: { type: DataTypes.STRING, allowNull: true },
    galleryImages: { type: DataTypes.TEXT, allowNull: true },
  };
  const columns = await queryInterface.describeTable('Users');
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns[name]) await queryInterface.addColumn('Users', name, definition);
  }

  // Auto-seed default system settings if empty
  try {
    const defaultSettings = [
      { key: 'system_name', value: 'DormMap - Municipality of Bongabong BPLO', category: 'general', description: 'Official Portal Name' },
      { key: 'bplo_office_email', value: 'bplo@bongabong.gov.ph', category: 'general', description: 'Official BPLO Email Address' },
      { key: 'bplo_office_phone', value: '(043) 283-5000', category: 'general', description: 'Official BPLO Hotline' },
      { key: 'reporting_schedule', value: JSON.stringify({ monthly: true, quarterly: true, semiAnnual: true, yearly: true, defaultDeadlineDays: 15 }), category: 'reporting', description: 'Configurable Reporting Cycle' },
      { key: 'permit_expiration_intervals', value: JSON.stringify([60, 30, 15, 7, 0]), category: 'permits', description: 'Notification Trigger Days Before Expiration' },
      { key: 'allowed_upload_formats', value: 'pdf,xlsx,xls,csv,png,jpg,jpeg,zip,doc,docx', category: 'maintenance', description: 'Allowed File Submission Formats' },
      { key: 'max_upload_size_mb', value: '15', category: 'maintenance', description: 'Maximum File Upload Size Limit in MB' },
      { key: 'maintenance_mode', value: 'false', category: 'maintenance', description: 'System Maintenance Mode Flag' },
      { key: 'auto_audit_logging', value: 'true', category: 'security', description: 'Enable Comprehensive Audit Trail' },
    ];

    for (const setting of defaultSettings) {
      const exists = await BploSystemSetting.findByPk(setting.key);
      if (!exists) {
        await BploSystemSetting.create(setting);
      }
    }
  } catch (err) {
    console.error('Note on setting defaults:', err.message);
  }
};
