import { hasApprovedBarangay, ownerBarangayError } from '../services/registrationPolicy.js';
import { uploadDir } from '../config/storage.js';
import express from "express";
import passport from "passport";
import { Op as SequelizeOp } from "sequelize";
import { User, Op as ModelOp } from "../models/userModel.js";
import { OwnerGallery } from "../models/ownerModels.js";

const Op = SequelizeOp || ModelOp || User.sequelize?.Sequelize?.Op;
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
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 16 },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed.'));
    }
    cb(null, true);
  },
});
const registerUpload = upload.fields([
  { name: "profilePicture", maxCount: 1 },
  { name: "boardingHousePicture", maxCount: 1 },
  { name: "validIdPicture", maxCount: 1 },
  { name: "businessPermit", maxCount: 1 },
  { name: "barangayClearance", maxCount: 1 },
  { name: "proofOfOwnership", maxCount: 1 },
  { name: "rentalPermit", maxCount: 1 },
  { name: "sanitationPermit", maxCount: 1 },
  { name: "fireSafetyPermit", maxCount: 1 },
  // 5 required gallery category photos (registration wizard)
  { name: "galleryOutdoor", maxCount: 1 },
  { name: "galleryLivingArea", maxCount: 1 },
  { name: "galleryBedroom", maxCount: 1 },
  { name: "galleryDining", maxCount: 1 },
  { name: "galleryBathroom", maxCount: 1 },
]);

router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/register", registerPage);
router.post("/register", registerUpload, registerUser);
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

    req.logIn(user, (loginErr) => {
      if (loginErr) return res.redirect("/login?error=google_auth_failed");

      const isNew = req.session.oauthNewUser === true;
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
router.post("/complete-barangay-profile", completeBarangayProfile);

router.get("/complete-owner-profile", (req, res) => {
  const pendingId = req.session.pendingOwnerUserId || req.session.userId;
  if (!pendingId) return res.redirect("/login");
  
  res.render("completeOwnerProfile", {
    title: "Complete Property Details | DormMap",
    error: ""
  });
});

router.post("/complete-owner-profile", registerUpload, async (req, res) => {
  const pendingId = req.session.pendingOwnerUserId || req.session.userId;
  if (!pendingId) return res.redirect("/login");

  const {
    boardingHouseName,
    boardingHouseAddress,
    roomsAvailable,
    contactNumber,
    gcashNumber,
    gcashName,
    mapPin,
    boardingHouseLatitude,
    boardingHouseLongitude,
    acceptTerms
  } = req.body;

  const renderError = (error) => res.render("completeOwnerProfile", {
    title: "Complete Property Details | DormMap",
    error
  });

  if (!boardingHouseName || !boardingHouseAddress || !roomsAvailable || !contactNumber || !mapPin) {
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

    const getUploadUrl = (field) => req.files?.[field]?.[0] ? `/uploads/${req.files[field][0].filename}` : null;

    // New 5-category gallery photos (required by the registration wizard)
    const galleryOutdoor   = getUploadUrl('galleryOutdoor');
    const galleryLivingArea = getUploadUrl('galleryLivingArea');
    const galleryBedroom   = getUploadUrl('galleryBedroom');
    const galleryDining    = getUploadUrl('galleryDining');
    const galleryBathroom  = getUploadUrl('galleryBathroom');

    // Legacy single photo fallback (kept for backward compatibility)
    const boardingHousePicture = galleryOutdoor || getUploadUrl('boardingHousePicture');

    const profilePicture = getUploadUrl('profilePicture');
    const validIdPicture = getUploadUrl('validIdPicture');
    const businessPermit = getUploadUrl('businessPermit');
    const barangayClearance = getUploadUrl('barangayClearance');
    const proofOfOwnership = getUploadUrl('proofOfOwnership');
    const rentalPermit = getUploadUrl('rentalPermit');

    // Build gallery images array preserving the 5 required category positions (Outdoor, Living, Bedroom, Dining, Bathroom)
    const galleryImagesArr = [
      galleryOutdoor || boardingHousePicture || '',
      galleryLivingArea || '',
      galleryBedroom || '',
      galleryDining || '',
      galleryBathroom || ''
    ];

    user.boardingHouseName = boardingHouseName;
    user.boardingHouseAddress = boardingHouseAddress;
    user.barangay = boardingHouseAddress; // Sort by barangay
    user.roomsAvailable = Number(roomsAvailable) || 1;
    user.contactNumber = contactNumber;
    if (gcashNumber) user.gcashNumber = gcashNumber;
    if (gcashName) user.gcashName = gcashName;
    user.mapPin = mapPin;
    user.boardingHouseLatitude = boardingHouseLatitude || null;
    user.boardingHouseLongitude = boardingHouseLongitude || null;
    user.applicationStatus = 'pending'; // Pending until Barangay/BPLO approval
    if (boardingHousePicture) user.boardingHousePicture = boardingHousePicture;
    if (profilePicture) user.profilePicture = profilePicture;
    if (validIdPicture) user.validIdPicture = validIdPicture;
    if (businessPermit) user.businessPermit = businessPermit;
    if (barangayClearance) user.barangayClearance = barangayClearance;
    if (proofOfOwnership) user.proofOfOwnership = proofOfOwnership;
    if (rentalPermit) user.rentalPermit = rentalPermit;
    // Save gallery photos JSON string
    if (galleryImagesArr.some(Boolean)) {
      user.galleryImages = JSON.stringify(galleryImagesArr);
    }

    await user.save();

    // Populate initial OwnerGallery records so owner dashboard gallery is fully synced
    const categoryMetadata = [
      { slot: 1, img: galleryOutdoor || boardingHousePicture, caption: "Outdoor Spaces", type: "outdoor" },
      { slot: 2, img: galleryLivingArea, caption: "Living Area", type: "living_area" },
      { slot: 3, img: galleryBedroom, caption: "Bedroom", type: "bedroom" },
      { slot: 4, img: galleryDining, caption: "Dining or kitchenette", type: "dining" },
      { slot: 5, img: galleryBathroom, caption: "Bathroom", type: "bathroom" },
    ];
    for (const item of categoryMetadata) {
      if (item.img) {
        try {
          const existing = await OwnerGallery.findOne({ where: { ownerId: user.id, sortOrder: item.slot } });
          if (existing) {
            existing.imageUrl = item.img;
            existing.caption = item.caption;
            existing.imageType = item.type;
            await existing.save();
          } else {
            await OwnerGallery.create({
              ownerId: user.id,
              imageUrl: item.img,
              caption: item.caption,
              sortOrder: item.slot,
              imageType: item.type
            });
          }
        } catch (e) {
          console.error("Error saving owner gallery slot:", e);
        }
      }
    }

    // Authenticate session completely
    req.session.userId = user.id;
    req.session.accountType = user.accountType;
    req.session.userName = user.fullName;
    delete req.session.pendingOwnerUserId;

    return res.redirect("/owner-dashboard");
  } catch (err) {
    console.error("Owner profile completion error:", err);
    return renderError("Failed to save property details. Please try again.");
  }
});

router.get("/complete-tenant-profile", (req, res) => {
  const pendingId = req.session.pendingTenantUserId || req.session.userId;
  if (!pendingId) return res.redirect("/login");

  res.render("completeTenantProfile", {
    title: "Complete Tenant Profile | DormMap",
    error: ""
  });
});

router.post("/complete-tenant-profile", registerUpload, async (req, res) => {
  const pendingId = req.session.pendingTenantUserId || req.session.userId;
  if (!pendingId) return res.redirect("/login");

  const { selectedBoardingHouse, contactNumber, gender, requestedRoomType, acceptTerms } = req.body;

  const renderError = (error) => res.render("completeTenantProfile", {
    title: "Complete Tenant Profile | DormMap",
    error
  });

  if (!selectedBoardingHouse || !contactNumber) {
    return renderError("Please select a target boarding house and enter your contact number.");
  }
  if (!gender) {
    return renderError("Please select your gender.");
  }
  if (acceptTerms !== "on") {
    return renderError("You must agree to the Terms of Service and Privacy Policy.");
  }

  try {
    const user = await User.findByPk(pendingId);
    if (!user) {
      delete req.session.pendingTenantUserId;
      return res.redirect("/login");
    }

    const getUploadUrl = (field) => req.files?.[field]?.[0] ? `/uploads/${req.files[field][0].filename}` : null;
    const validIdPicture = getUploadUrl('validIdPicture');
    const profilePicture = getUploadUrl('profilePicture');

    user.selectedBoardingHouse = selectedBoardingHouse;
    user.contactNumber = contactNumber;
    user.gender = gender;
    if (requestedRoomType) user.preferredLocation = requestedRoomType; // Store room type choice
    if (validIdPicture) user.validIdPicture = validIdPicture;
    if (profilePicture) user.profilePicture = profilePicture;
    user.applicationStatus = 'pending_owner';

    await user.save();

    const sequelizeOp = User.sequelize?.Sequelize?.Op || Op;
    const owner = await User.findOne({
      where: {
        accountType: 'boarding_house_owner',
        [sequelizeOp.or]: [
          { boardingHouseName: selectedBoardingHouse },
          { name: selectedBoardingHouse }
        ]
      }
    });

    const { TenantApplication } = await import('../models/tenantModels.js');
    const { OwnerInquiry, OwnerNotification, OwnerMessage } = await import('../models/ownerModels.js');

    // Create TenantApplication record
    await TenantApplication.create({
      tenantId: user.id,
      ownerId: owner ? owner.id : 0,
      boardingHouseName: selectedBoardingHouse,
      requestedRoomType: requestedRoomType || null,
      message: `Initial application submitted upon registration. Contact: ${contactNumber}, Gender: ${gender}`,
      status: 'pending_owner'
    }).catch(err => console.error('Error creating TenantApplication in authRoutes:', err));

    if (owner) {
      const roomTypeInfo = requestedRoomType ? ` (Requested Room: ${requestedRoomType})` : '';
      await OwnerInquiry.create({
        ownerId: owner.id,
        clientName: user.fullName,
        clientEmail: user.email,
        clientPhone: user.contactNumber,
        message: `Tenant application submitted for ${selectedBoardingHouse}${roomTypeInfo}. Contact: ${contactNumber}, Gender: ${gender}`,
        status: 'new'
      }).catch(() => {});

      await OwnerNotification.create({
        ownerId: owner.id,
        title: '🏠 New Tenant Application Pending',
        body: `${user.fullName} applied for a room at ${selectedBoardingHouse}${roomTypeInfo}. Review & accept tenant in your portal.`,
        type: 'tenant_application',
        link: '#tenants'
      }).catch(() => {});

      // Create initial conversation message so it appears immediately in Messenger
      await OwnerMessage.create({
        ownerId: owner.id,
        senderId: user.id,
        recipientId: owner.id,
        subject: `Application Inquiry - ${selectedBoardingHouse}`,
        message: `Hello! I submitted a rental application for ${selectedBoardingHouse}${roomTypeInfo}. Looking forward to your response!`,
        isRead: false
      }).catch(() => {});
    }

    req.session.userId = user.id;
    req.session.accountType = 'tenant';
    req.session.userName = user.fullName;
    delete req.session.pendingTenantUserId;

    return res.redirect("/tenant-dashboard");
  } catch (err) {
    console.error("Tenant profile completion error:", err);
    return renderError("Failed to save tenant profile. Please try again.");
  }
});


export default router;
