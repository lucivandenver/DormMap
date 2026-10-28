import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import session from 'express-session';
import connectSessionSequelize from 'connect-session-sequelize';
import { sequelize } from '../models/db.js';

const SequelizeStore = connectSessionSequelize(session.Store);
export const sessionStore = new SequelizeStore({ db: sequelize, tableName: 'Sessions' });

export function sessionOptions(env = process.env, store = sessionStore) {
  const production = env.NODE_ENV === 'production';
  if (production && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET must have at least 32 characters in production.');
  }
  return {
    name: 'dormmap.sid',
    secret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
    store,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
  };
}
