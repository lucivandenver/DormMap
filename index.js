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
    
import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import session from "express-session";
import flash from "connect-flash";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcrypt";
import { User } from "./models/userModel.js";
import { sequelize } from "./models/db.js";
import router from "./routes/index.js";
import fs from 'fs';
import hbs from "hbs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { sessionOptions, sessionStore } from './config/session.js';
import { publicDir, uploadDir, prepareUploads } from './config/storage.js';

hbs.registerHelper('eq', (a, b) => a === b);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { installLandingUpdates } from "./services/landingService.js";
import { initWebSocket } from "./services/websocketService.js";

const app = express();
const httpServer = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
if (production) app.set('trust proxy', 1);
app.disable('x-powered-by');
prepareUploads();

// Render probes this route without creating a login session.
app.get('/healthz', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await sequelize.query('SELECT 1', { retry: { max: 0 } });
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => { req.rawBody = buffer; },
}));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(publicDir));

const sessionMiddleware = session(sessionOptions());
app.use(sessionMiddleware);
const io = initWebSocket(httpServer, sessionMiddleware);
installLandingUpdates();
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use((req, res, next) => {
  // Account pages and API responses must not survive logout in a shared browser.
  res.set('Cache-Control', 'no-store');
  next();
});

const normalizeAccountType = (type) => {
  if (!type) return "tenant";
  if (type === "bplo_admin") return "super_admin";
  return type;
};

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user || false);
  } catch (err) {
    done(err, false);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET &&
    !/your[-_]google[-_]client[-_]id/i.test(process.env.GOOGLE_CLIENT_ID) &&
    !/your[-_]google[-_]client[-_]secret/i.test(process.env.GOOGLE_CLIENT_SECRET)) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
    callbackURL: (process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_URL || "http://localhost:3000"}/auth/google/callback`).trim(),
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, profile, done) => {
  try {
    const rawEmail = profile.emails?.[0]?.value;
    if (!rawEmail) return done(null, false, { message: "No email returned from Google." });
    const email = rawEmail.toLowerCase().trim();

    const existingUser = await User.findOne({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("email")),
        email
      ),
    });
    const rawOauthAccountType = req.session.oauthAccountType || req.query.accountType;
    const isLoginOnly = rawOauthAccountType === "login_only" || !rawOauthAccountType;
    const oauthAccountType = isLoginOnly ? "tenant" : normalizeAccountType(rawOauthAccountType);

    if (existingUser) {
      const existingRole = normalizeAccountType(existingUser.accountType);

      // Only enforce role conflict when the user explicitly chose a role (register/register-google flow)
      if (!isLoginOnly && existingRole !== oauthAccountType) {
        return done(null, false, { message: "role_conflict", existingRole });
      }
      existingUser.googleId = profile.id;
      existingUser.oauthProvider = "google";
      if (!existingUser.emailVerified) {
        existingUser.emailVerified = true;
      }
      await existingUser.save();
      return done(null, existingUser);
    }

    // login_only but no account found — can't create a new user without a role
    if (isLoginOnly) {
      return done(null, false, { message: "no_account", email });
    }

    if (!['tenant', 'barangay', 'boarding_house_owner'].includes(oauthAccountType)) return done(null, false, { message: 'invalid_registration_role' });
    const name = profile.displayName || profile.name?.givenName || "Google User";
    const newUser = await User.create({
      accountType: oauthAccountType,
      applicationStatus: ['barangay', 'boarding_house_owner'].includes(oauthAccountType) ? 'pending' : 'approved',
      fullName: name,
      email,
      password: await bcrypt.hash(Math.random().toString(36).slice(2), 10),
      emailVerified: true,
      verificationToken: null,
      googleId: profile.id,
      oauthProvider: "google",
      profilePicture: profile.photos?.[0]?.value || null,
    });
    req.session.oauthNewUser = true;
    return done(null, newUser);
  } catch (err) {
    done(err);
  }
  }));
}

app.engine("xian", async (filePath, options, callback) => {
  try {
     const originalPartialsDir = hbs.partialsDir;
    hbs.partialsDir = path.join(__dirname, 'views');

    const result = await new Promise((resolve, reject) => {
      hbs.__express(filePath, options, (err, html) => {
        if (err) return reject(err);
        resolve(html);
      });
    });

    hbs.partialsDir = originalPartialsDir;
    callback(null, result);
  } catch (err) {
    callback(err);
  }
});
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  next();
});


app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");
const partialsDir = path.join(__dirname, "views/partials");
fs.readdir(partialsDir, (err, files) => {
  if (err) {
    console.error("❌ Could not read partials directory:", err);
    return;
  }

   files
    .filter(file => file.endsWith('.xian'))
    .forEach(file => {
      const partialName = file.replace('.xian', ''); 
      const fullPath = path.join(partialsDir, file);

      fs.readFile(fullPath, 'utf8', (err, content) => {
        if (err) {
          console.error(`❌ Failed to read partial: ${file}`, err);
          return;
        }
        hbs.registerPartial(partialName, content);
        
      });
    });
});

app.use("/", router);

app.use((error, req, res, next) => {
  console.error('Request error:', error);

  const isApi = req.originalUrl?.includes('/api/') || 
                req.path?.includes('/api/') || 
                req.xhr || 
                req.headers?.accept?.includes('application/json');

  if (isApi) {
    return res.status(error.status || error.statusCode || 500).json({
      error: production && (!error.status || error.status >= 500)
        ? 'An internal server error occurred.'
        : error.message || 'An internal server error occurred.'
    });
  }

  if (error instanceof Error && /Only JPG|File too large|Unexpected field/.test(error.message)) {
    return res.status(400).render('home', {
      title: 'DormMap',
      authMode: 'register', authOpen: true,
      authAccountType: req.body?.accountType || 'tenant',
      authError: error.message, authSuccess: '', authValues: req.body || {},
    });
  }

  return res.status(500).render('home', {
    title: 'DormMap',
    authMode: 'login', authOpen: false, authAccountType: 'tenant',
    authError: 'Something went wrong. Please try again.', authSuccess: '', authValues: {},
  });
});

export default app;

const startServer = async () => {
  try {
    await sequelize.authenticate();
    // Migrations run explicitly before starting. Startup never alters tables.
    await sessionStore.sessionModel.findOne({ attributes: ['sid'] });

    if (!process.env.ELECTRON) {
      httpServer.listen(PORT, '0.0.0.0', () => console.log(`🔥 XianFire running on port ${PORT}`));
      httpServer.on('error', (err) => {
        console.error('❌ Server failed to start:', err);
        process.exit(1);
      });
    }
  } catch (err) {
    console.error("❌ Database sync failed:", err);
    process.exit(1);
  }
};

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  sessionStore.stopExpiringSessions();
  io.close(async () => {
    await sequelize.close();
    clearTimeout(deadline);
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (process.env.NODE_ENV !== 'test') startServer();
export { httpServer, io };
