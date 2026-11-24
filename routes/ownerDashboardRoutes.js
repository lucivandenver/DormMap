import { GALLERY_CATEGORIES } from '../services/propertyPhotoService.js';
import { uploadDir } from '../config/storage.js';
import express from 'express';
import multer from 'multer';
import { paymentProof } from '../middleware/paymentUploads.js';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'node:os';
import { requireApprovedOwner } from '../middleware/ownerAuth.js';
import * as controller from '../controllers/ownerDashboardController.js';

const router = express.Router();

// Gallery photos are saved in the database. Other account uploads use disk.

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const directory = ['gcashQrCode', 'qrPhCode'].includes(file.fieldname) ? path.join(tmpdir(), 'dormmap-payment-qr') : uploadDir;
    fs.mkdir(directory, { recursive: true, mode: 0o700 }, error => cb(error, directory));
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

const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: GALLERY_CATEGORIES.length },
});
const parseGalleryUpload = parser => (req, res, next) => {
  parser(req, res, error => {
    if (!error) return next();
    const category = GALLERY_CATEGORIES.find(item => item.field === error.field);
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `${category?.label || 'Each photo'} must be 5 MB or smaller.`
      : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Choose one photo per gallery slot.'
        : 'The photos could not be read. Choose the files again and retry.';
    return res.status(422).json({ error: message });
  });
};

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
router.post('/api/tenants/bulk-archive', controller.archiveTenants);
router.get('/api/walk-in-accounts', controller.listWalkInAccounts);
router.post('/api/walk-in-accounts', paymentProof('reservationProof'), controller.createWalkInAccount);
router.patch('/api/walk-in-accounts/:id/password', controller.updateWalkInPassword);
router.patch('/api/tenants/:id', controller.updateTenant);
router.delete('/api/tenants/:id', controller.deleteTenant);

// Pending Tenant Applications (tenants who registered with this BH)
router.get('/api/pending-applications', controller.getPendingApplications);
router.post('/api/pending-applications/bulk-offer', controller.bulkOfferApplications);
router.post('/api/pending-applications/bulk-archive', controller.archiveApplications);
router.post('/api/pending-applications/:id/approve-reservation', controller.approveApplicationReservation);
router.post('/api/pending-applications/:userId/accept', controller.acceptTenantApplication);
router.delete('/api/pending-applications/:userId/decline', controller.declineTenantApplication);

// Monthly Payment Management
router.get('/api/payments', controller.getPayments);
router.post('/api/payments', controller.createPayment);
router.patch('/api/payments/:id/pay', controller.markPaid);
router.delete('/api/payments/:id/submission', controller.returnPaymentSubmission);
router.delete('/api/payments/:id', controller.deletePayment);

// Inquiry Module
router.get('/api/inquiries', controller.getInquiries);
router.post('/api/inquiries', controller.createInquiry);
router.post('/api/inquiries/bulk-archive', controller.archiveInquiries);
router.patch('/api/inquiries/:id/reply', controller.replyInquiry);
router.patch('/api/inquiries/:id/archive', controller.archiveInquiry);

// Messages
router.get('/api/maintenance', controller.getMaintenance);
router.patch('/api/maintenance/:id', controller.updateMaintenance);
router.get('/api/messages', controller.getMessages);
router.post('/api/messages', controller.sendMessage);

// Notifications
router.get('/api/notifications', controller.getNotifications);
router.patch('/api/notifications/:id/read', controller.markNotificationRead);
router.patch('/api/notifications/read-all', controller.markAllNotificationsRead);

// Gallery Management
router.get('/api/gallery', controller.getGallery);
router.post('/api/gallery', parseGalleryUpload(galleryUpload.single('galleryImage')), controller.addGalleryImage);
router.delete('/api/gallery/:id', controller.deleteGalleryImage);
router.post('/api/gallery/slot/:slotIndex', parseGalleryUpload(galleryUpload.single('slotImage')), controller.updateGallerySlot);
router.delete('/api/gallery/slot/:slotIndex', controller.deleteGallerySlot);
router.post('/api/gallery/five-slots', parseGalleryUpload(galleryUpload.fields(GALLERY_CATEGORIES.map(({ field }) => ({ name: field, maxCount: 1 })))), controller.updateFiveGallerySlots);

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
  { name: 'qrPhCode', maxCount: 1 },
]);
router.patch('/api/my-profile', (req, res, next) => {
  res.on('finish', () => {
    for (const field of ['gcashQrCode', 'qrPhCode']) {
      const qr = req.files?.[field]?.[0];
      if (qr?.path) fs.rm(qr.path, { force: true }, () => {});
    }
  });
  docUpload(req, res, error => {
    if (error) return res.status(422).json({ error: 'Upload supported images up to 5 MB each.' });
    next();
  });
}, controller.updateMyProfile);
const reviewDocumentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/api/my-documents', reviewDocumentUpload.fields([
  'validIdPicture', 'businessPermit', 'barangayClearance', 'proofOfOwnership', 'rentalPermit', 'boardingHousePicture'
].map(name => ({ name, maxCount: 1 }))), controller.updateMyDocuments);

export default router;

