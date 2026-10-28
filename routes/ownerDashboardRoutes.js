import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireApprovedOwner } from '../middleware/ownerAuth.js';
import * as controller from '../controllers/ownerDashboardController.js';

const router = express.Router();

// Setup Multer for drag and drop gallery uploads
const uploadDir = path.join(process.cwd(), 'public', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Protect all routes under /owner-dashboard
router.use(requireApprovedOwner);

// Page Route
router.get('/', controller.ownerDashboardPage);

// API Endpoints
router.get('/api/overview', controller.overview);
router.get('/api/profile', controller.getProfile);
router.patch('/api/profile', controller.updateProfile);

// Boarding House Management (Multiple Establishments)
router.get('/api/boarding-houses', controller.getBoardingHouses);
router.post('/api/boarding-houses', controller.createBoardingHouse);
router.patch('/api/boarding-houses/:id', controller.updateBoardingHouse);
router.delete('/api/boarding-houses/:id', controller.deleteBoardingHouse);

// Room Management
router.get('/api/rooms', controller.getRooms);
router.post('/api/rooms', controller.createRoom);
router.patch('/api/rooms/:id', controller.updateRoom);
router.delete('/api/rooms/:id', controller.deleteRoom);

// Tenant Management
router.get('/api/tenants', controller.getTenants);
router.post('/api/tenants', controller.createTenant);
router.patch('/api/tenants/:id', controller.updateTenant);
router.delete('/api/tenants/:id', controller.deleteTenant);

// Pending Tenant Applications (tenants who registered with this BH)
router.get('/api/pending-applications', controller.getPendingApplications);
router.post('/api/pending-applications/:userId/accept', controller.acceptTenantApplication);
router.delete('/api/pending-applications/:userId/decline', controller.declineTenantApplication);

// Monthly Payment Management
router.get('/api/payments', controller.getPayments);
router.post('/api/payments', controller.createPayment);
router.patch('/api/payments/:id/pay', controller.markPaid);
router.delete('/api/payments/:id', controller.deletePayment);

// Inquiry Module
router.get('/api/inquiries', controller.getInquiries);
router.post('/api/inquiries', controller.createInquiry);
router.patch('/api/inquiries/:id/reply', controller.replyInquiry);
router.patch('/api/inquiries/:id/archive', controller.archiveInquiry);

// Messages
router.get('/api/messages', controller.getMessages);
router.post('/api/messages', controller.sendMessage);

// Notifications
router.get('/api/notifications', controller.getNotifications);
router.patch('/api/notifications/:id/read', controller.markNotificationRead);
router.patch('/api/notifications/read-all', controller.markAllNotificationsRead);

// Gallery Management
router.get('/api/gallery', controller.getGallery);
router.post('/api/gallery', upload.single('galleryImage'), controller.addGalleryImage);
router.delete('/api/gallery/:id', controller.deleteGalleryImage);
router.post('/api/gallery/slot/:slotIndex', upload.single('slotImage'), controller.updateGallerySlot);
router.delete('/api/gallery/slot/:slotIndex', controller.deleteGallerySlot);
router.post('/api/gallery/five-slots', upload.fields([
  { name: 'galleryOutdoor', maxCount: 1 },
  { name: 'galleryLivingArea', maxCount: 1 },
  { name: 'galleryBedroom', maxCount: 1 },
  { name: 'galleryDining', maxCount: 1 },
  { name: 'galleryBathroom', maxCount: 1 },
]), controller.updateFiveGallerySlots);

// Amenities & House Rules
router.patch('/api/amenities', controller.updateAmenities);
router.patch('/api/house-rules', controller.updateHouseRules);

// Map Location
router.patch('/api/location', controller.updateLocation);

// Reports & Audit Logs
router.get('/api/reports', controller.getReports);
router.get('/api/activity-logs', controller.getActivityLogs);
router.get('/api/permit', controller.getPermit);
router.post('/api/permit/request-renewal', controller.requestPermitRenewal);
router.get('/api/announcements', controller.getAnnouncements);
router.get('/api/settings', controller.getSettings);
router.patch('/api/settings', controller.updateSettings);

// My Profile & Documents
const docUpload = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'boardingHousePicture', maxCount: 1 },
  { name: 'validIdPicture', maxCount: 1 },
  { name: 'businessPermit', maxCount: 1 },
  { name: 'barangayClearance', maxCount: 1 },
  { name: 'proofOfOwnership', maxCount: 1 },
  { name: 'rentalPermit', maxCount: 1 },
  { name: 'gcashQrCode', maxCount: 1 },
]);
router.patch('/api/my-profile', docUpload, controller.updateMyProfile);
router.post('/api/my-documents', docUpload, controller.updateMyDocuments);

export default router;

