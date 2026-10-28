import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { User, sequelize } from '../models/userModel.js';

export async function resolveGoogleAccount(profile, requestedRole = 'login_only', env = process.env) {
  const email = String(profile.emails?.[0]?.value || '').trim().toLowerCase();
  if (!email) return { error: 'missing_email' };
  // Never infer admin access from a sender email, display name, or a public role selector.
  const verified = profile._json?.email_verified === true || profile.emails?.[0]?.verified === true;
  const admins = new Set(String(env.ADMIN_GOOGLE_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  let user = await User.findOne({ where: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('email'))), email) });
  if (user) {
    if (user.isSuspended || user.isArchived) return { error: 'account_unavailable' };
    if (admins.has(email) && verified && !['super_admin','bplo_admin'].includes(user.accountType)) {
      await user.update({ accountType: 'super_admin', applicationStatus: 'approved', password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12), resetPasswordToken: null, resetPasswordExpires: null });
    }
    const role = user.accountType === 'bplo_admin' ? 'super_admin' : user.accountType;
    if (requestedRole !== 'login_only' && requestedRole && requestedRole !== role) return { error: 'role_conflict', existingRole: role };
    if (!verified) return { error: 'unverified_google_email' };
    await user.update({ googleId: profile.id, oauthProvider: 'google', emailVerified: true });
    return { user, isNew: false };
  }
  if (admins.has(email)) {
    if (!verified) return { error: 'unverified_google_email' };
    user = await User.create({ fullName: profile.displayName || 'BPLO Administrator', email, password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12), accountType: 'super_admin', applicationStatus: 'approved', emailVerified: true, googleId: profile.id, oauthProvider: 'google' });
    return { user, isNew: false };
  }
  if (!requestedRole || requestedRole === 'login_only') return { error: 'no_account', email };
  if (!['tenant', 'barangay', 'boarding_house_owner'].includes(requestedRole)) return { error: 'invalid_registration_role' };
  if (!verified) return { error: 'unverified_google_email' };
  user = await User.create({ fullName: profile.displayName || 'Google User', email, password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10), accountType: requestedRole, applicationStatus: requestedRole === 'tenant' ? 'approved' : 'pending', emailVerified: true, googleId: profile.id, oauthProvider: 'google', profilePicture: profile.photos?.[0]?.value || null });
  return { user, isNew: true };
}
