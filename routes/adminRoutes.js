import express from 'express';
import { requireSuperAdmin } from '../middleware/adminAuth.js';
import * as controller from '../controllers/adminController.js';

const router = express.Router();
router.use(requireSuperAdmin);

// Dashboard Page & Overview
router.get('/', controller.adminDashboardPage);
router.get('/api/overview', controller.overview);
router.get('/api/map-data', controller.adminMapData);

router.get('/api/barangay-accounts', controller.listBarangayAccounts);
router.patch('/api/barangay-accounts/:id/review', controller.reviewBarangayAccount);

// Owner Applications & Review
router.get('/api/owners', controller.listOwners);
router.patch('/api/owners/:id/review', controller.reviewOwner);

// Data Requests Management
router.get('/api/data-requests', controller.listDataRequests);
router.post('/api/data-requests', controller.createDataRequest);
router.get('/api/data-requests/:id', controller.getDataRequestDetails);
router.patch('/api/data-requests/:id', controller.updateDataRequest);
router.delete('/api/data-requests/:id', controller.deleteDataRequest);
router.post('/api/data-requests/:id/remind', controller.sendDataRequestReminder);

// Barangay Submissions Management & Review
router.get('/api/submissions', controller.listSubmissions);
router.get('/api/submissions/compliance-matrix', controller.getComplianceMatrix);
router.get('/api/submissions/export-consolidated', controller.exportConsolidatedData);
router.get('/api/submissions/:id', controller.getSubmissionDetails);
router.get('/api/submissions/:id/export-excel', controller.exportSubmissionExcel);
router.patch('/api/submissions/:id/review', controller.reviewSubmission);

// Permit Renewals Management
router.get('/api/permit-renewals', controller.listPermitRenewals);
router.patch('/api/permit-renewals/:id/review', controller.reviewPermitRenewal);

// CRUD Collections
for (const [path, c] of [['barangays', controller.barangays], ['institutions', controller.institutions], ['permits', controller.permits]]) {
  router.get(`/api/${path}`, c.list);
  router.post(`/api/${path}`, c.create);
  router.put(`/api/${path}/:id`, c.update);
  router.delete(`/api/${path}/:id`, c.remove);
}

// System Settings & Configuration
router.get('/api/settings', controller.getSystemSettings);
router.post('/api/settings', controller.updateSystemSettings);

// System Maintenance & Health Monitoring
router.get('/api/maintenance/status', controller.getMaintenanceStatus);
router.post('/api/maintenance/toggle-mode', controller.toggleMaintenanceMode);
router.get('/api/maintenance/error-logs', controller.getSystemErrorLogs);
router.get('/api/maintenance/backup', controller.triggerDatabaseBackup);

// Audit Logs & Announcements
router.get('/api/audit-logs', controller.listAudit);
router.post('/api/announcements', controller.createAnnouncement);

export default router;
