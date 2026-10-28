import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireTenantUser } from '../middleware/tenantAuth.js';
import {
  tenantDashboardPage,
  overview,
  getMyRoom,
  getPaymentHistory,
  getRentalInformation,
  getMaintenanceRequests,
  createMaintenanceRequest,
  getMessages,
  sendMessage,
  getConversations,
  getApplications,
  applyBoardingHouse,
  confirmApplication,
  cancelApplication,
  browseBoardingHouses,
  getDocuments,
  uploadDocument,
  getNotifications,
  getAnnouncements,
  getProfile,
  updateProfile,
  changePassword,
} from '../controllers/tenantDashboardController.js';

const router = express.Router();

const uploadDir = path.join(process.cwd(), 'public', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `tenant-${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Protect all tenant routes with requireTenantUser middleware
router.use(requireTenantUser);

// Dashboard View
router.get('/', tenantDashboardPage);

// API Endpoints
router.get('/api/overview', overview);
router.get('/api/my-room', getMyRoom);
router.get('/api/payments', getPaymentHistory);
router.get('/api/rental-info', getRentalInformation);

// Browse Boarding Houses & Location Map
router.get('/api/browse-boarding-houses', browseBoardingHouses);

// Applications & Inquiries
router.get('/api/applications', getApplications);
router.post('/api/applications', applyBoardingHouse);
router.post('/api/applications/:id/confirm', confirmApplication);
router.post('/api/applications/:id/cancel', cancelApplication);

// Maintenance Requests
router.get('/api/maintenance', getMaintenanceRequests);
router.post('/api/maintenance', upload.single('photo'), createMaintenanceRequest);

// Messaging & Messenger Conversations
router.get('/api/conversations', getConversations);
router.get('/api/messages', getMessages);
router.post('/api/messages', sendMessage);

// Documents
router.get('/api/documents', getDocuments);
router.post('/api/documents', upload.single('document'), uploadDocument);

// Notifications & Announcements
router.get('/api/notifications', getNotifications);
router.get('/api/announcements', getAnnouncements);

// Profile & Settings
router.get('/api/profile', getProfile);
router.post('/api/profile', upload.single('profilePicture'), updateProfile);
router.post('/api/change-password', changePassword);

export default router;
