import { uploadDir } from '../config/storage.js';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireBarangayOfficial } from '../middleware/barangayAuth.js';
import * as controller from '../controllers/barangayDashboardController.js';

const router = express.Router();

// Setup Multer for document & report submissions

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `barangay-${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB limit
});

router.use(requireBarangayOfficial);

// Dashboard Page & Overview
router.get('/', controller.barangayDashboardPage);
router.get('/api/overview', controller.overview);

// Data Requests & Submissions Module
router.get('/api/data-requests', controller.getBarangayDataRequests);
router.get('/api/submissions', controller.getBarangaySubmissions);
router.post('/api/submissions', upload.single('submissionFile'), controller.submitBarangayData);
router.get('/api/masterlist-export', controller.generateMasterlistExport);
router.get('/api/submissions/:id/export-excel', controller.exportSubmissionExcel);

// Permit Renewals & Expiration Monitoring
router.get('/api/permit-renewals', controller.getPermitRenewals);
router.post('/api/permit-renewals', upload.single('renewalDocument'), controller.submitPermitRenewal);
router.patch('/api/permit-renewals/:id', controller.updatePermitRenewalStatus);

// Owner Applications & Boarding Houses
router.get('/api/applications', controller.applications);
router.patch('/api/applications/:id/review', controller.reviewApplication);
router.get('/api/houses', controller.houses);
router.patch('/api/houses/:id/status', controller.changeHouseStatus);
router.get('/api/permits', controller.permits);
router.patch('/api/permits/:id', controller.updatePermit);
router.get('/api/permit-alerts', controller.expiringNotifications);
router.get('/api/map-houses', controller.mapHouses);

// Communication, Tenants, Reports & Profile
router.get('/api/messages', controller.messages);
router.post('/api/messages', controller.sendMessage);
router.get('/api/notifications', controller.notifications);
router.get('/api/audit-logs', controller.auditLogs);
router.post('/api/announcements', controller.publishAnnouncement);
router.get('/api/tenants', controller.tenants);
router.get('/api/reports', controller.getReportsData);
router.get('/api/profile', controller.getProfile);
router.patch('/api/profile', controller.updateProfile);

export default router;
