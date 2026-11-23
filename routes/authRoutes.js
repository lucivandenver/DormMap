import { createRegistrationInquiry, isTenantGender, notifyRegistrationInquiry, registrationApplicationDetails } from '../services/tenantApplicationService.js';
import { storeReviewFile } from '../services/reviewFileService.js';
import { randomUUID } from 'node:crypto';
import { OwnerRoom } from '../models/ownerModels.js';
import { validateOwnerSetup, validateOwnerPaymentSetup, registerPropertyInventory } from '../services/ownerRegistrationService.js';
import { hasApprovedBarangay, ownerBarangayError } from '../services/registrationPolicy.js';
import { uploadDir } from '../config/storage.js';
import express from "express";
import passport from "passport";
import { User, sequelize } from "../models/userModel.js";
import { GALLERY_CATEGORIES, storeRegistrationPhotos } from '../services/propertyPhotoService.js';
import { registrationTemp, startRegistrationDraft, registrationDraftDirectory,
  saveRegistrationDraftFile, useRegistrationDraft } from '../services/registrationUploads.js';

import {
  loginPage, registerPage, forgotPasswordPage, sendPasswordResetLink,
  resetPasswordPage, handleResetPassword, dashboardPage, loginUser,
  registerUser, logoutUser, verifyEmail, normalizeAccountType,
  completeBarangayProfilePage, completeBarangayProfile,
} from "../controllers/authController.js";
import fs from "fs";
import path from "path";
import multer from "multer";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === "profilePicture" ? uploadDir : registrationTemp;
    fs.mkdir(dir, { recursive: true, mode: 0o700 }, error => cb(error, dir));
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${randomUUID()}-${safeName}`);
  },
});
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1013, fields: 750, parts: 1763 },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype) || !['.jpg','.jpeg','.png','.webp','.pdf'].includes(path.extname(file.originalname).toLowerCase())) {
      return cb(Object.assign(new Error('Only JPG, PNG, WebP, and PDF files are allowed.'), { status: 422 }));
    }
    cb(null, true);
  },
});
const registrationFields = [
  { name: "profilePicture", maxCount: 1 },
  { name: "gcashQrCode", maxCount: 1 },
  { name: "qrPhCode", maxCount: 1 },
  { name: "boardingHousePicture", maxCount: 1 },
  { name: "validIdPicture", maxCount: 1 },
  { name: "businessPermit", maxCount: 1 },
  { name: "barangayClearance", maxCount: 1 },
  { name: "proofOfOwnership", maxCount: 1 },
  { name: "rentalPermit", maxCount: 1 },
  { name: "sanitationPermit", maxCount: 1 },
  { name: "fireSafetyPermit", maxCount: 1 },
  { name: "governmentId", maxCount: 1 },
  { name: "barangayCertificate", maxCount: 1 },
  ...Array.from({ length: 100 }, (_, index) => GALLERY_CATEGORIES.map(({ field }) => ({
    name: index ? `branch${index + 1}_${field}` : field, maxCount: 1
  }))).flat(),
];

router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/register", registerPage);
const stagedFields = new Set(registrationFields
  .map(({ name }) => name)
  .filter(name => !['profilePicture', 'governmentId', 'barangayCertificate'].includes(name)));
const registrationError = (req, res, error) => {
  const multerError = error instanceof multer.MulterError;
  const status = error.status || (multerError ? 422 : 500);
  const message = status >= 500 ? 'The server could not accept your attachments. Please try again.'
    : multerError && error.code === 'LIMIT_FILE_SIZE' ? 'Each attachment must be 5 MB or smaller.' : error.message;
  if (status >= 500) console.error('Registration upload failed:', error);
  if (req.accepts(['html', 'json']) === 'json') return res.status(status).json({ error: message });
  res.status(status).send(message);
};
const parseRegistration = upload.fields(registrationFields);
const parseStagedFile = upload.single('file');
const registerUpload = (req, res, next) => {
  parseRegistration(req, res, error => {
    if (error) return registrationError(req, res, error);
    next();
  });
};
const loadStagedRegistration = async (req, res, next) => {
  try {
    const finished = req.session.completedRegistrationDraft;
    if (finished && req.body?.registrationDraft === finished.id && req.path === finished.path) {
      return res.status(finished.status).json(finished.result);
    }
    await useRegistrationDraft(req, stagedFields);
    next();
  } catch (error) { return registrationError(req, res, error); }
};
const cleanRegistration = (req, res, next) => {
  res.on('finish', () => {
    for (const file of Object.values(req.files || {}).flat()) {
      if (!file.staged && file.path && (!req.registrationSaved || file.fieldname !== 'profilePicture')) fs.rm(file.path, { force: true }, () => {});
    }
    if (req.registrationSaved && req.registrationDraftDirectory) {
      fs.rm(req.registrationDraftDirectory, { recursive: true, force: true }, () => {});
    }
  });
  next();
};

router.post('/owner-registration/uploads', async (req, res, next) => {
  try { res.status(201).json({ id: await startRegistrationDraft(req) }); } catch (error) { next(error); }
});
router.post('/owner-registration/uploads/:draft/:field', async (req, res, next) => {
  try {
    if (!stagedFields.has(req.params.field)) return res.status(422).json({ error: 'Unknown registration attachment.' });
    req.registrationDraftDirectory = await registrationDraftDirectory(req, req.params.draft);
    next();
  } catch (error) { return registrationError(req, res, error); }
}, (req, res) => {
  parseStagedFile(req, res, async error => {
    try {
      if (error) throw error;
      const extension = await saveRegistrationDraftFile(req.registrationDraftDirectory, req.params.field, req.file);
      res.json({ extension });
    } catch (error) {
      if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
      registrationError(req, res, error);
    }
  });
});
router.post("/register", cleanRegistration, registerUpload, loadStagedRegistration, registerUser);
router.get("/forgot-password", forgotPasswordPage);
router.post("/forgot-password", sendPasswordResetLink);
router.get("/reset-password", resetPasswordPage);
router.post("/reset-password", handleResetPassword);
router.get("/dashboard", dashboardPage);
router.get("/logout", logoutUser);
router.get("/verify-email", verifyEmail);

const getGoogleStrategy = () => {
  return (passport._strategies && passport._strategies.google) ? passport._strategies.google : null;
};

router.get("/auth/google", (req, res, next) => {
  if (!getGoogleStrategy()) {
    return res.redirect("/login?error=google_oauth_not_configured");
  }
  if (req.query.accountType && !['login_only', 'tenant', 'barangay', 'boarding_house_owner'].includes(req.query.accountType)) {
    return res.status(403).send('Administrator accounts cannot be created through public registration.');
  }
  // If no accountType is given, treat as a login-only flow (no role enforcement)
  req.session.oauthAccountType = req.query.accountType ? req.query.accountType : "login_only";
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
  if (!getGoogleStrategy()) {
    return res.redirect("/login?error=google_oauth_not_configured");
  }
  passport.authenticate("google", {
    failureRedirect: "/login",
    failureMessage: true,
  }, (err, user, info) => {
    if (err) {
      return res.redirect("/login?error=google_auth_failed");
    }

    // Role conflict: Gmail already registered under a different role
    if (!user && info && info.message === "role_conflict") {
      const existingRole = info.existingRole || "tenant";
      return res.render("home", {
        title: "DormMap",
        authMode: "login",
        authOpen: true,
        authAccountType: existingRole,
        authError: "",
        authSuccess: "",
        authValues: {},
        googleRoleConflict: true,
        googleRoleConflictExisting: existingRole,
      });
    }

    // No account found for login-only Google flow
    if (!user && info && info.message === "no_account") {
      const googleEmail = info.email || "";
      return res.render("home", {
        title: "DormMap",
        authMode: "login",
        authOpen: true,
        authAccountType: "tenant",
        authError: "",
        authSuccess: "",
        authValues: { email: googleEmail },
        googleRoleConflict: false,
        googleRoleConflictExisting: "",
        googleNotRegistered: true,
        googleNotRegisteredEmail: googleEmail,
      });
    }

    if (!user) {
      return res.redirect("/login?error=google_auth_failed");
    }

    const isNew = req.session.oauthNewUser === true;
    req.logIn(user, (loginErr) => {
      if (loginErr) return res.redirect("/login?error=google_auth_failed");

      const accountType = normalizeAccountType(user.accountType);

      if (accountType === 'barangay') {
        if (isNew || !user.barangay) {
          req.session.pendingBarangayUserId = user.id;
          delete req.session.oauthNewUser;
          return res.redirect("/complete-barangay-profile");
        }
      } else if (accountType === 'boarding_house_owner') {
        if (isNew || !user.boardingHouseName || !user.barangay || !user.mapPin) {
          req.session.pendingOwnerUserId = user.id;
          delete req.session.oauthNewUser;
          return res.redirect("/complete-owner-profile");
        }
      } else if (accountType === 'tenant') {
        if (isNew || !user.selectedBoardingHouse || !user.contactNumber) {
          req.session.pendingTenantUserId = user.id;
          delete req.session.oauthNewUser;
          return res.redirect("/complete-tenant-profile");
        }
      }

      req.session.userId = user.id;
      req.session.accountType = accountType;
      req.session.userName = user.fullName;
      delete req.session.oauthNewUser;
      return res.redirect("/dashboard");
    });
  })(req, res, next);
});

router.get("/complete-barangay-profile", completeBarangayProfilePage);
router.post("/complete-barangay-profile", cleanRegistration, registerUpload, completeBarangayProfile);

router.get("/complete-owner-profile", async (req, res, next) => {
  const pendingId = req.session.pendingOwnerUserId || req.session.userId;
  if (!pendingId) return res.redirect("/login");
  
  try {
    const user = await User.findByPk(pendingId);
    if (!user || user.accountType !== 'boarding_house_owner') return res.redirect('/dashboard');
    if ((user.boardingHouseName && user.barangay && user.mapPin) || await OwnerRoom.count({ where: { ownerId: user.id } })) return res.redirect('/owner-dashboard');
  } catch (error) { return next(error); }
  res.render("completeOwnerProfile", {
    title: "Complete Property Details | DormMap",
    error: ""
  });
});

router.post("/complete-owner-profile", cleanRegistration, registerUpload, loadStagedRegistration, async (req, res) => {
  const pendingId = req.session.pendingOwnerUserId || req.session.userId;
  if (!pendingId) return res.redirect("/login");

  const {
    boardingHouseName,
    boardingHouseAddress,
    roomsAvailable,
    mapPin,
    boardingHouseLatitude,
    boardingHouseLongitude,
    acceptTerms
  } = req.body;

  const wantsJson = req.accepts(['html', 'json']) === 'json';
  const renderError = (error) => wantsJson ? res.status(422).json({ error }) : res.render("completeOwnerProfile", {
    title: "Complete Property Details | DormMap",
    authValues: req.body,
    error
  });

  if (!boardingHouseName || !boardingHouseAddress || !roomsAvailable || !mapPin) {
    return renderError("Please fill out all required property fields.");
  }
  if (acceptTerms !== "on") {
    return renderError("You must agree to the Terms of Service and Privacy Policy.");
  }

  try {
    const user = await User.findByPk(pendingId);
    if (!user) {
      delete req.session.pendingOwnerUserId;
      return res.redirect("/login");
    }

    if (user.accountType !== 'boarding_house_owner') return res.status(403).send('Owner account required.');
    if (!await hasApprovedBarangay(boardingHouseAddress)) return renderError(ownerBarangayError);

    let setup;
    try { setup = validateOwnerSetup(req.body, req.files); setup.payment = validateOwnerPaymentSetup(req.body, req.files); } catch (error) { return renderError(error.message); }
    await sequelize.transaction(async transaction => {
      await user.reload({ transaction, lock: transaction.LOCK.UPDATE });
      const getUploadUrl = (field) => storeReviewFile(req.files?.[field]?.[0], user.id, 'owner-registration', transaction);

      if (user.boardingHouseName && user.barangay && user.mapPin) {
        throw new Error('This account already has a property registration. Manage its information from the owner dashboard.');
      }
      const galleries = await storeRegistrationPhotos(req.files, user.id, transaction, setup.branches.length);
      const [galleryImagesArr] = galleries;
      const [boardingHousePicture] = galleryImagesArr;
      const validIdPicture = await getUploadUrl('validIdPicture');
      const businessPermit = await getUploadUrl('businessPermit');
      const barangayClearance = await getUploadUrl('barangayClearance');

      user.boardingHouseName = boardingHouseName;
      user.boardingHouseAddress = boardingHouseAddress;
      user.barangay = boardingHouseAddress; // Sort by barangay
      user.roomsAvailable = Number(roomsAvailable) || 1;
      user.paymentMethods = setup.payment.paymentMethods;
      user.rentPerRoom = setup.payment.rentPerRoom;
      user.rentPerHead = setup.payment.rentPerHead;
      user.contactNumber = setup.payment.contactNumber;
      for (const [field, file] of Object.entries(setup.payment.qrUploads)) {
        user[field] = await storeReviewFile(file, user.id, 'payment-qr', transaction);
      }
      user.mapPin = mapPin;
      user.boardingHouseLatitude = boardingHouseLatitude || null;
      user.boardingHouseLongitude = boardingHouseLongitude || null;
      user.applicationStatus = 'pending'; // Pending until Barangay/BPLO approval
      if (boardingHousePicture) user.boardingHousePicture = boardingHousePicture;
      if (validIdPicture) user.validIdPicture = validIdPicture;
      if (businessPermit) user.businessPermit = businessPermit;
      if (barangayClearance) user.barangayClearance = barangayClearance;
      // Save gallery photos JSON string
      if (galleryImagesArr.some(Boolean)) {
        user.galleryImages = JSON.stringify(galleryImagesArr);
      }

      await user.save({ transaction });
      await registerPropertyInventory(user, setup, galleries, transaction);
    });

    req.registrationSaved = true;
    // Authenticate session completely
    req.session.userId = user.id;
    req.session.accountType = user.accountType;
    req.session.userName = user.fullName;
    delete req.session.pendingOwnerUserId;

    if (wantsJson) {
      const result = { success: true, redirect: '/owner-dashboard' };
      if (req.registrationDraftDirectory) req.session.completedRegistrationDraft = { id: req.body.registrationDraft, path: req.path, status: 200, result };
      return res.json(result);
    }
    return res.redirect("/owner-dashboard");
  } catch (err) {
    console.error("Owner profile completion error:", err);
    return renderError(err.status === 422 ? err.message : "Failed to save property details. Please try again.");
  }
});

function renderTenantProfile(res, error = '', values = {}) {
  res.status(error ? 422 : 200).render("completeTenantProfile", {
    title: "Complete Tenant Profile | DormMap", error, values
  });
}

router.get("/complete-tenant-profile", async (req, res, next) => {
  const pendingId = req.session.pendingTenantUserId;
  if (!pendingId) return res.redirect(req.session.accountType === 'tenant' ? '/tenant-dashboard' : '/login');
  try {
    const user = await User.findByPk(pendingId);
    if (user?.accountType !== 'tenant') return res.redirect('/login');
    renderTenantProfile(res, '', { contactNumber: user.contactNumber, gender: user.gender });
  } catch (error) { next(error); }
});

router.post("/complete-tenant-profile", cleanRegistration, registerUpload, async (req, res) => {
  const pendingId = req.session.pendingTenantUserId;
  if (!pendingId) return res.redirect(req.session.accountType === 'tenant' ? '/tenant-dashboard' : '/login');
  const wantsJson = req.accepts(['html', 'json']) === 'json';
  const reject = error => wantsJson ? res.status(422).json({ error }) : renderTenantProfile(res, error, req.body);
  const { selectedBoardingHouse, gender, acceptTerms } = req.body;
  const contactNumber = String(req.body.contactNumber || '').trim();
  if (!selectedBoardingHouse) return reject('Select a target boarding house.');
  if (!/^\+?[0-9 ()-]{7,24}$/.test(contactNumber) || contactNumber.replace(/\D/g, '').length < 7) return reject('Enter a valid contact number.');
  if (!isTenantGender(gender)) return reject('Choose Male or Female.');
  if (acceptTerms !== 'on') return reject('Accept the Terms of Service and Privacy Policy to continue.');
  const idFile = req.files?.validIdPicture?.[0];
  const picture = req.files?.profilePicture?.[0];
  if (!idFile) return reject('Upload your student or government-issued ID.');
  if (picture && !picture.mimetype.startsWith('image/')) return reject('Upload a JPG, PNG, or WebP profile picture.');

  try {
    const result = await sequelize.transaction(async transaction => {
      const user = await User.findByPk(pendingId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || user.accountType !== 'tenant' || user.isArchived || user.isSuspended) return {};
      const details = await registrationApplicationDetails(req.body, transaction);
      const validIdPicture = await storeReviewFile(idFile, user.id, 'tenant-registration', transaction);
      const inquiry = await createRegistrationInquiry(user, details, transaction);
      await user.update({
        selectedBoardingHouse: details.boardingHouseName, contactNumber, gender,
        preferredLocation: details.requestedRoomType, validIdPicture, applicationStatus: 'pending_owner',
        ...(picture ? { profilePicture: `/uploads/${picture.filename}` } : {})
      }, { transaction });
      return { user, inquiry };
    });

    const { user, inquiry } = result;
    if (!user) return res.status(403).send('Tenant account required.');
    if (inquiry.created) void notifyRegistrationInquiry(user, inquiry.application);

    req.session.userId = user.id;
    req.session.accountType = 'tenant';
    req.session.userName = user.fullName;
    delete req.session.pendingTenantUserId;
    req.registrationSaved = true;
    if (wantsJson) return res.json({ success: true, redirect: '/tenant-dashboard' });
    res.redirect('/tenant-dashboard');
  } catch (error) {
    console.error("Tenant profile completion error:", error);
    return reject(error.status === 422 ? error.message : 'Failed to save your tenant profile. Please try again.');
  }
});

export default router;
