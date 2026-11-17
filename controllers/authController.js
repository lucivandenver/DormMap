import { storeReviewFile } from '../services/reviewFileService.js';
import { passwordResetDelivery } from '../services/passwordResetMailService.js';
import { validateOwnerSetup, validateOwnerPaymentSetup, registerPropertyInventory } from '../services/ownerRegistrationService.js';

      /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import { hasApprovedBarangay, ownerBarangayError } from "../services/registrationPolicy.js";
import bcrypt from "bcrypt";
import { randomBytes, createHash } from "node:crypto";
import { Op } from "sequelize";
import { User, sequelize } from "../models/userModel.js";
import { storeRegistrationPhotos } from '../services/propertyPhotoService.js';
import nodemailer from "nodemailer";

const roleLabels = {
  super_admin: "Super Admin",
  barangay: "Barangay Official",
  boarding_house_owner: "Boarding House Owner",
  tenant: "Tenant",
};

const dashboardNavItems = {
  super_admin: [
    { label: "Users", path: "#users" },
    { label: "Barangay Management", path: "#barangays" },
    { label: "Boarding Houses", path: "#boarding-houses" },
    { label: "Reports", path: "#reports" },
  ],
  barangay: [
    { label: "Permit Requests", path: "#permits" },
    { label: "Verified Boarding Houses", path: "#boarding-houses" },
    { label: "Barangay Announcements", path: "#announcements" },
  ],
  boarding_house_owner: [
    { label: "My Boarding Houses", path: "#my-houses" },
    { label: "Tenants", path: "#tenants" },
    { label: "Messages", path: "#messages" },
  ],
  tenant: [
    { label: "My Bookings", path: "#bookings" },
    { label: "Payments", path: "#payments" },
    { label: "Support", path: "#support" },
  ],
};

const getRoleLabel = (accountType) => roleLabels[accountType] || "User";
const getNavItems = (accountType) => dashboardNavItems[accountType] || [];

const renderAuthHome = (res, options = {}) => {
  const {
    authMode = "login",
    authOpen = true,
    authAccountType = "super_admin",
    authError = "",
    authSuccess = "",
    authValues = {},
    googleRoleConflict = false,
    googleRoleConflictExisting = "",
    googleNotRegistered = false,
    googleNotRegisteredEmail = "",
  } = options;

  return res.render("home", {
    title: "DormMap",
    authMode,
    authOpen,
    authAccountType,
    authError,
    authSuccess,
    authValues,
    googleRoleConflict,
    googleRoleConflictExisting,
    googleNotRegistered,
    googleNotRegisteredEmail,
  });
};

const renderLoginPage = (res, options = {}) => {
  const {
    authAccountType = "tenant",
    authError = "",
    authSuccess = "",
    authValues = {},
  } = options;

  return renderAuthHome(res, {
    authMode: "login",
    authOpen: true,
    authAccountType,
    authError,
    authSuccess,
    authValues,
  });
};

const renderRegisterPage = (res, options = {}) => {
  const {
    authAccountType = "boarding_house_owner",
    authError = "",
    authSuccess = "",
    authValues = {},
  } = options;

  return renderAuthHome(res, {
    authMode: "register",
    authOpen: true,
    authAccountType,
    authError,
    authSuccess,
    authValues,
  });
};

const accountTypes = new Set(["super_admin", "barangay", "boarding_house_owner", "tenant"]);
const normalizeList = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value].filter(Boolean) : [];
const getUploadedPath = (files, fieldName) => files?.[fieldName]?.[0] ? `/uploads/${files[fieldName][0].filename}` : null;

export const normalizeAccountType = (type) => {
  if (!type) return "tenant";
  if (type === "bplo_admin") return "super_admin";
  return type;
};

const createTransporter = () => {
  const user = (process.env.GMAIL_USER || process.env.EMAIL_USER || '').trim();
  const pass = (process.env.GMAIL_PASS || process.env.EMAIL_PASS || '').trim().replace(/\s+/g, '');

  if (user) {
    return nodemailer.createTransport({
      service: 'gmail',
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user, pass }
    });
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: { user: user || 'no-reply@example.com', pass: pass || 'password' }
  });
};

const sendVerificationEmail = async (email, token) => {
  const transporter = createTransporter();
  const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'DorMap <no-reply@example.com>',
    to: email,
    subject: '✅ Verify your DormMap Account',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
            <tr><td style="background:linear-gradient(135deg,#064e3b,#059669);padding:32px 40px;text-align:center">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px">🏠 DorMap</h1>
              <p style="margin:8px 0 0;color:#a7f3d0;font-size:13px">Boarding House Registry System</p>
            </td></tr>
            <tr><td style="padding:40px">
              <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px">Verify Your Email Address</h2>
              <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.7">Welcome to DorMap! Please click the button below to verify your email address and activate your account.</p>
              <table cellpadding="0" cellspacing="0"><tr><td>
                <a href="${verifyUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px">✅ Verify Email Address</a>
              </td></tr></table>
              <p style="margin:24px 0 0;color:#94a3b8;font-size:12px">If you did not create a DorMap account, you can safely ignore this email. This link expires in 24 hours.</p>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
              <p style="margin:0;color:#94a3b8;font-size:11px">© ${new Date().getFullYear()} DorMap — Mindoro State University, Philippines</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`,
  });
};

export const loginPage = (req, res) => {
  const flashErr = req.flash("error_msg");
  const flashErrStr = Array.isArray(flashErr) ? (flashErr[0] || "") : (flashErr || "");
  const queryError = req.query.error === "google_oauth_not_configured"
    ? "Google Sign-In is not configured yet. Please check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env."
    : req.query.error === "google_auth_failed"
      ? "Google Sign-In failed or was cancelled. Please try again."
      : "";

  return renderAuthHome(res, {
    authMode: "login",
    authOpen: true,
    authAccountType: normalizeAccountType(req.query.accountType),
    authError: queryError || flashErrStr,
    authSuccess: req.query.pendingApproval === "1" ? "Application submitted. Please wait for the responsible office to approve your account." : req.query.verified === "1"
      ? "Your email has been verified. You can login now."
      : req.query.registered === "1"
        ? "Registration complete. Check your email for the verification link."
        : req.query.passwordUpdated === "1" ? "Password updated. Sign in with your new password." : "",
    authValues: { email: req.query.email || "" },
    googleNotRegistered: req.query.not_registered === "1" || req.query.error === "google_not_registered",
    googleNotRegisteredEmail: req.query.email || "",
  });
};

export const registerPage = (req, res) => {
  const flashErr = req.flash("error_msg");
  const flashErrStr = Array.isArray(flashErr) ? (flashErr[0] || "") : (flashErr || "");
  return renderAuthHome(res, {
    authMode: "register",
    authOpen: true,
    authAccountType: normalizeAccountType(req.query.accountType) || "boarding_house_owner",
    authError: flashErrStr,
    authValues: {},
  });
};
const resetTokenHash = token => createHash('sha256').update(token).digest('hex');
const resetLifetime = 15 * 60 * 1000;

export const forgotPasswordPage = (req, res) => res.render('forgotpassword', {
  title: 'Forgot Password', error: '', success: ''
});

export const sendPasswordResetLink = async (req, res) => {
  const wantsJson = req.xhr || req.accepts(['html', 'json']) === 'json';
  const reply = (status, error, success = '') => wantsJson
    ? res.status(status).json(error ? { success: false, error } : { success: true, message: success })
    : res.status(status).render('forgotpassword', { title: 'Forgot Password', error, success });
  const suppliedEmail = req.body?.email;
  const email = typeof suppliedEmail === 'string' ? suppliedEmail.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return reply(400, 'Enter your registered email address.');
  }
  const deliver = passwordResetDelivery();
  const base = process.env.APP_BASE_URL || process.env.APP_URL || process.env.RENDER_EXTERNAL_URL ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (!deliver || !base) return reply(503, 'Password reset email is temporarily unavailable. Please try again later.');
  const success = 'If the address is registered, a password reset link will arrive in your inbox. Check your spam folder too.';
  try {
    const user = await User.findOne({
      attributes: ['id', 'email'],
      where: { isArchived: false, [Op.and]: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), email) }
    });
    if (user) {
      const token = randomBytes(32).toString('hex');
      const digest = resetTokenHash(token);
      const resetUrl = new URL('/reset-password', base);
      if (process.env.NODE_ENV === 'production' && resetUrl.protocol !== 'https:') throw new Error('Password reset requires an HTTPS application URL.');
      resetUrl.searchParams.set('token', token);
      const now = Date.now();
      const [reserved] = await User.update({
        resetPasswordToken: digest, resetPasswordExpires: new Date(now + resetLifetime)
      }, {
        where: { id: user.id, [Op.or]: [
          { resetPasswordExpires: null },
          { resetPasswordExpires: { [Op.lte]: new Date(now + resetLifetime - 60000) } }
        ] }
      });
      if (reserved) {
        try {
          await deliver({
            to: user.email,
            subject: 'Reset your DormMap password',
            text: `Open this link within 15 minutes to set your new DormMap password: ${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
            html: `<p>Use this link within 15 minutes to set your new DormMap password.</p><p><a href="${resetUrl}">Reset My Password</a></p><p>If you did not request this, you can ignore this email.</p>`
          });
        } catch (error) {
          await User.update({ resetPasswordToken: null, resetPasswordExpires: null }, { where: { id: user.id, resetPasswordToken: digest } });
          console.error('[Password reset email]', error.code || error.name);
        }
      }
    }
    return reply(200, '', success);
  } catch (error) {
    console.error('[Password reset request]', error.code || error.name);
    return reply(503, 'Password reset is temporarily unavailable. Please try again later.');
  }
};

function resetTokenWhere(token) {
  return { resetPasswordToken: resetTokenHash(token), resetPasswordExpires: { [Op.gt]: new Date() }, isArchived: false };
}

const validResetToken = token => typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
const invalidResetLink = 'This reset link is invalid or expired. Request a new link.';
const resetHeaders = res => res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });

export const resetPasswordPage = async (req, res, next) => {
  resetHeaders(res);
  try {
    const { token } = req.query;
    const user = validResetToken(token) && await User.findOne({ where: resetTokenWhere(token), attributes: ['id'] });
    return res.status(user ? 200 : 400).render('resetpassword', {
      title: 'Reset Password', token: user ? token : '', error: user ? '' : invalidResetLink
    });
  } catch (error) { next(error); }
};

export const handleResetPassword = async (req, res) => {
  resetHeaders(res);
  const { token, password, confirmPassword } = req.body || {};
  const wantsJson = req.xhr || req.accepts(['html', 'json']) === 'json';
  const fail = (status, error, retry = false) => wantsJson
    ? res.status(status).json({ success: false, error })
    : res.status(status).render('resetpassword', { title: 'Reset Password', error, token: retry ? token : '' });
  if (!validResetToken(token)) return fail(400, invalidResetLink);
  if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) {
    return fail(400, 'Use at least 6 characters and at most 72 bytes for your password.', true);
  }
  if (password !== confirmPassword) return fail(400, 'The passwords do not match.', true);
  try {
    const user = await User.findOne({ where: resetTokenWhere(token), attributes: ['id'] });
    if (!user) return fail(400, invalidResetLink);
    const hash = await bcrypt.hash(password, 10);
    const [updated] = await User.update({
      password: hash, resetPasswordToken: null, resetPasswordExpires: null
    }, { where: { ...resetTokenWhere(token), id: user.id } });
    if (!updated) return fail(400, invalidResetLink);
    const redirect = '/login?passwordUpdated=1';
    if (wantsJson) return res.json({ success: true, redirect });
    return res.redirect(303, redirect);
  } catch (error) {
    console.error('[Password reset]', error.code || error.name);
    return fail(503, 'Unable to update your password. Please try again.', true);
  }
};

export const verifyEmail = async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return renderLoginPage(res, {
      authError: "Verification token is invalid.",
    });
  }
  const user = await User.findOne({ where: { verificationToken: token } });
  if (!user) {
    return renderLoginPage(res, {
      authError: "Verification token is invalid or expired.",
    });
  }
  user.emailVerified = true;
  user.verificationToken = null;
  await user.save();
  res.redirect("/login?verified=1");
};
export const dashboardPage = async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  if (req.session.accountType === 'super_admin') return res.redirect('/admin');
  if (req.session.accountType === 'barangay') return res.redirect('/barangay-dashboard');
  if (req.session.accountType === 'boarding_house_owner') return res.redirect('/owner-dashboard');
  if (req.session.accountType === 'tenant') return res.redirect('/tenant-dashboard');

  const accountType = req.session.accountType || "tenant";
  const navItems = getNavItems(accountType);
  const roleLabel = getRoleLabel(accountType);
  const user = await User.findByPk(req.session.userId);
  if (!user) {
    return req.session.destroy(() => res.redirect("/login"));
  }

  let dashboardStats;
  let dashboardMessage;
  if (accountType === "super_admin") {
    const [users, owners, tenants] = await Promise.all([
      User.count(),
      User.count({ where: { accountType: "boarding_house_owner" } }),
      User.count({ where: { accountType: "tenant" } }),
    ]);
    dashboardStats = [
      { label: "Registered users", value: users, description: "All DormMap accounts" },
      { label: "Property owners", value: owners, description: "Boarding house owner accounts" },
      { label: "Tenants", value: tenants, description: "Tenant accounts" },
    ];
    dashboardMessage = "Use the map to review submitted boarding-house locations and account registrations.";
  } else if (accountType === "boarding_house_owner") {
    dashboardStats = [
      { label: "My property", value: user.boardingHouseName ? "1" : "0", description: user.boardingHouseName || "No property registered" },
      { label: "Available rooms", value: user.roomsAvailable ?? "—", description: "Current listing availability" },
      { label: "Map pin", value: user.mapPin ? "Set" : "Missing", description: "Location shown to tenants" },
    ];
    dashboardMessage = "Keep your property details, room availability, and contact information up to date.";
  } else if (accountType === "barangay") {
    const localUsers = await User.count({ where: { barangay: user.barangay } });
    dashboardStats = [
      { label: "Barangay", value: user.barangay || "—", description: "Assigned jurisdiction" },
      { label: "Local accounts", value: localUsers, description: "Accounts registered under this barangay" },
      { label: "Position", value: user.positionTitle || "Official", description: "Registered office role" },
    ];
    dashboardMessage = "Review registered properties and coordinate with owners in your assigned barangay.";
  } else {
    dashboardStats = [
      { label: "Selected house", value: user.selectedBoardingHouse ? "Set" : "None", description: user.selectedBoardingHouse || "Choose a listing from the map" },
      { label: "Budget", value: user.budgetRange || "—", description: "Your saved budget preference" },
      { label: "Location", value: user.preferredLocation || "—", description: "Your saved location preference" },
    ];
    dashboardMessage = "Browse the verified map listings and contact a property owner directly when you find a match.";
  }

  return res.render("dashboard", {
    title: "Dashboard",
    userName: req.session.userName || "Guest",
    accountType,
    roleLabel,
    navItems,
    dashboardStats,
    dashboardMessage,
  });
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const requestedAccountType = normalizeAccountType(req.body.accountType);

    if (!email || !password) {
      return renderLoginPage(res, {
        authAccountType: requestedAccountType || "tenant",
        authError: "Email and password are required.",
        authValues: { email, accountType: requestedAccountType },
      });
    }

    // 1. Find user by email (case-insensitive search)
    const user = await User.findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('email')),
        email.toLowerCase().trim()
      )
    });

    if (!user) {
      return renderLoginPage(res, {
        authAccountType: requestedAccountType || "tenant",
        authError: "No registered account found with this email address.",
        authValues: { email, accountType: requestedAccountType },
      });
    }

    // 2. Check if account is suspended
    if (user.isSuspended) {
      return renderLoginPage(res, {
        authAccountType: requestedAccountType || normalizeAccountType(user.accountType),
        authError: "Your account has been suspended. Please contact BPLO administration.",
        authValues: { email },
      });
    }

    // 3. Verify Password — handle Google OAuth accounts gracefully
    const match = await bcrypt.compare(password, user.password).catch(() => false);
    if (!match) {
      return renderLoginPage(res, {
        authAccountType: requestedAccountType || normalizeAccountType(user.accountType),
        authError: "Incorrect password. Try again or select 'Forgot password?'.",
        authValues: { email, accountType: requestedAccountType },
      });
    }

    // 4. Auto-verify email upon authentic login
    if (!user.emailVerified) {
      user.emailVerified = true;
      user.verificationToken = null;
      await user.save().catch(() => {});
    }

    // Rotate the login session and persist it before redirecting to a dashboard.
    const actualRole = normalizeAccountType(user.accountType);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.accountType = actualRole;
    req.session.userName = user.fullName;
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

    // 6. Direct user to their respective dashboard
    if (actualRole === 'super_admin') return res.redirect('/admin');
    if (actualRole === 'barangay') return res.redirect('/barangay-dashboard');
    if (actualRole === 'boarding_house_owner') return res.redirect('/owner-dashboard');
    if (actualRole === 'tenant') return res.redirect('/tenant-dashboard');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error("Login Error:", err);
    return renderLoginPage(res, {
      authError: "An unexpected error occurred during login. Please try again.",
      authValues: { email: req.body?.email || "" }
    });
  }
};

export const registerUser = async (req, res) => {
  try {
    const {
      accountType,
      fullName,
      email,
      password,
      confirmPassword,
      acceptTerms,
      barangay,
      positionTitle,
      boardingHouseName,
      boardingHouseAddress,
      roomsAvailable,
      mapPin,
      boardingHouseLatitude,
      boardingHouseLongitude,
      roomTypes,
      contactNumber,
      selectedBoardingHouse,
      notes,
    } = req.body;

    const normalizedAccountType = normalizeAccountType(accountType);
    const agreedToTerms = acceptTerms === 'on' || acceptTerms === 'true';

    if (!agreedToTerms) {
      return renderRegisterPage(res, {
        authAccountType: normalizedAccountType,
        authError: 'You must accept the Terms of Service and Privacy Policy to continue.',
        authValues: req.body,
      });
    }

    if (!accountTypes.has(normalizedAccountType)) {
      return renderRegisterPage(res, {
        authAccountType: "boarding_house_owner",
        authError: "Please select a valid account type.",
        authValues: req.body,
      });
    }

    if (normalizedAccountType === "super_admin") {
      return renderRegisterPage(res, {
        authAccountType: "tenant",
        authError: "Super Admin accounts can only be created by a system administrator.",
        authValues: req.body,
      });
    }

    if (!fullName || !email || !password) {
      return renderRegisterPage(res, {
        authAccountType: accountType,
        authError: "Full name, email, and password are required.",
        authValues: req.body,
      });
    }

    if (password !== confirmPassword) {
      return renderRegisterPage(res, {
        authAccountType: accountType,
        authError: "Passwords do not match.",
        authValues: req.body,
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return renderRegisterPage(res, {
        authAccountType: accountType,
        authError: "Email is already registered.",
        authValues: req.body,
      });
    }

    if (normalizedAccountType === 'barangay' && barangay && await User.findOne({ where: { accountType: 'barangay', barangay, isArchived: false } })) {
      return renderRegisterPage(res, { authAccountType: normalizedAccountType, authError: 'An official account already exists for this barangay. Please contact BPLO.', authValues: req.body });
    }
    if (normalizedAccountType === 'boarding_house_owner' && !await hasApprovedBarangay(boardingHouseAddress)) {
      return renderRegisterPage(res, { authAccountType: normalizedAccountType, authError: ownerBarangayError, authValues: req.body });
    }

    const profilePicture = getUploadedPath(req.files, "profilePicture");
    const businessPermit = getUploadedPath(req.files, "businessPermit");


    if (normalizedAccountType === "barangay" && !barangay) {
      return renderRegisterPage(res, {
        authAccountType: normalizedAccountType,
        authError: "Please choose your Barangay from the Bongabong list.",
        authValues: req.body,
      });
    }

    if (normalizedAccountType === "boarding_house_owner") {
      if (!boardingHouseName || !boardingHouseAddress || !roomsAvailable || !businessPermit || !mapPin) {
        return renderRegisterPage(res, {
          authAccountType: normalizedAccountType,
          authError: "Boarding house owner registration needs the required property and business documents plus a street map pin.",
          authValues: req.body,
        });
      }
    }

    // Tenants: selectedBoardingHouse and validIdPicture are now OPTIONAL.
    // Undecided tenants can register without a boarding house selection.
    // They can select/update their boarding house later from their dashboard.

    let setup;
    if (normalizedAccountType === 'boarding_house_owner') {
      try { setup = validateOwnerSetup(req.body, req.files); setup.payment = validateOwnerPaymentSetup(req.body, req.files); } catch (error) { return renderRegisterPage(res, { authAccountType: normalizedAccountType, authError: error.message, authValues: req.body }); }
    }
    const hashed = await bcrypt.hash(password, 10);
    const verificationToken = Math.random().toString(36).substring(2, 18);
    const user = await sequelize.transaction(async transaction => {
      const created = await User.create({
        accountType: normalizedAccountType,
        applicationStatus: ['boarding_house_owner', 'barangay'].includes(normalizedAccountType) ? 'pending' : 'approved',
        fullName,
        email,
        password: hashed,
        emailVerified: true,
        verificationToken: null,
        profilePicture,
        barangay: accountType === "barangay" ? barangay : (accountType === "boarding_house_owner" ? boardingHouseAddress : null),
        positionTitle: accountType === "barangay" ? positionTitle || null : null,
        boardingHouseName: accountType === "boarding_house_owner" ? boardingHouseName : null,
        boardingHouseAddress: accountType === "boarding_house_owner" ? boardingHouseAddress : null,
        roomsAvailable: accountType === "boarding_house_owner" ? Number(roomsAvailable) || null : null,
        mapPin: accountType === "boarding_house_owner" ? mapPin || null : null,
        boardingHouseLatitude: accountType === "boarding_house_owner" ? boardingHouseLatitude || null : null,
        boardingHouseLongitude: accountType === "boarding_house_owner" ? boardingHouseLongitude : null,
        roomTypes: accountType === "boarding_house_owner" ? JSON.stringify(normalizeList(roomTypes)) : null,
        paymentMethods: setup?.payment.paymentMethods ?? null,
        selectedBoardingHouse: accountType === "tenant" ? selectedBoardingHouse || null : null,
        contactNumber: setup?.payment.contactNumber || contactNumber || null,
        notes: notes || null,
      }, { transaction });
      const scope = { boarding_house_owner: 'owner-registration', tenant: 'tenant-registration' }[normalizedAccountType] || 'registration';
      const documentUpdates = {};
      const supportingDocuments = {};
      for (const field of ['validIdPicture', 'businessPermit', 'barangayClearance', 'rentalPermit',
        'proofOfOwnership', 'sanitationPermit', 'fireSafetyPermit', 'governmentId', 'barangayCertificate']) {
        const url = await storeReviewFile(req.files?.[field]?.[0], created.id, scope, transaction);
        if (!url) continue;
        if (['validIdPicture', 'businessPermit', 'barangayClearance', 'rentalPermit'].includes(field)) documentUpdates[field] = url;
        else supportingDocuments[field] = url;
      }
      if (Object.keys(supportingDocuments).length) documentUpdates.supportingDocuments = JSON.stringify(supportingDocuments);
      if (Object.keys(documentUpdates).length) await created.update(documentUpdates, { transaction });
      if (setup) {
        const galleryImages = await storeRegistrationPhotos(req.files, created.id, transaction);
        await created.update({
          boardingHousePicture: galleryImages[0] || null,
          galleryImages: JSON.stringify(galleryImages),
          gcashQrCode: await storeReviewFile(setup.payment.qr, created.id, 'payment-qr', transaction),
        }, { transaction });
        await registerPropertyInventory(created, setup, req.files, transaction);
      }
      return created;
    });

    req.registrationSaved = true;

    if (normalizedAccountType !== "super_admin") {
      try {
        await sendVerificationEmail(email, verificationToken);
      } catch (mailError) {
        console.error("Verification email failed:", mailError);
      }
      return res.redirect(['barangay', 'boarding_house_owner'].includes(normalizedAccountType) ? "/login?pendingApproval=1" : "/login?registered=1");
    }

    req.session.userId = user.id;
    req.session.accountType = normalizeAccountType(user.accountType);
    req.session.userName = user.fullName;
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Register error:", error);
    return renderRegisterPage(res, {
      authAccountType: req.body.accountType || "boarding_house_owner",
      authError: error.status === 422 ? error.message : "Registration failed. Please check your inputs and try again.",
      authValues: req.body,
    });
  }
};

export const completeBarangayProfilePage = (req, res) => {
  // Accept two cases:
  // 1. Brand-new Google OAuth user (pendingBarangayUserId set by the callback)
  // 2. Existing barangay user with no barangay assigned (caught by middleware)
  const pendingId = req.session.pendingBarangayUserId;
  const existingBarangaySession =
    req.session.userId && req.session.accountType === 'barangay';

  if (!pendingId && !existingBarangaySession) {
    return res.redirect("/login");
  }
  return res.render("completeBarangayProfile", {
    title: "Complete Your Barangay Profile | DormMap",
    error: "",
  });
};

export const completeBarangayProfile = async (req, res) => {
  // Resolve user from either a new OAuth flow or an existing session
  const userId = req.session.pendingBarangayUserId || req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  const { barangay, positionTitle, contactNumber, acceptTerms } = req.body;

  const renderError = (msg) =>
    res.render("completeBarangayProfile", {
      title: "Complete Your Barangay Profile | DormMap",
      error: msg,
    });

  if (!barangay) return renderError("Please select your assigned barangay.");
  if (!positionTitle || !positionTitle.trim()) return renderError("Position / designation is required.");
  if (!contactNumber || !contactNumber.trim()) return renderError("Contact number is required.");
  if (acceptTerms !== "on") return renderError("You must accept the Terms of Service and Privacy Policy.");

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      delete req.session.pendingBarangayUserId;
      return res.redirect("/login");
    }

    // Check if this barangay is already taken by another account
    const existingBarangay = await User.findOne({
      where: {
        accountType: "barangay",
        barangay,
        id: { [Op.ne]: userId },
      },
    });

    if (existingBarangay) {
      return renderError(`A barangay official account for "${barangay}" already exists. Please contact the administrator.`);
    }

    if (user.accountType !== "barangay") return res.status(403).send("Barangay account required.");
    user.applicationStatus = 'pending';
    user.barangay = barangay;
    user.positionTitle = positionTitle.trim();
    user.contactNumber = contactNumber.trim();
    await user.save();

    // Promote / refresh session to full authenticated state
    req.session.userId = user.id;
    req.session.accountType = normalizeAccountType(user.accountType);
    req.session.userName = user.fullName;
    delete req.session.pendingBarangayUserId;

    return res.redirect("/barangay-dashboard");
  } catch (err) {
    console.error("Complete barangay profile error:", err);
    return renderError("Something went wrong. Please try again.");
  }
};

export const logoutUser = (req, res) => {
  req.session.destroy(() => res.redirect("/"));
};
