import mysql from 'mysql2/promise';
import { databaseConfig } from '../config/database.js';
import { sequelize } from '../models/db.js';
import '../models/userModel.js';
import { ensureAdminSchema } from '../models/adminModels.js';
import '../models/savedDormModel.js';
import './propertyPhotoService.js';
import './reviewFileService.js';
import { sessionStore } from '../config/session.js';

// Deliberately additive bootstrap for this legacy app: no force, alter, drops,
// renames, or type changes. Future destructive changes need an explicit migration.
export async function migrateSchema({ createDatabase = false } = {}) {
  const { database, username: user, ...connectionOptions } = databaseConfig();
  const lock = await mysql.createConnection({ ...connectionOptions, user });
  const lockName = `dormmap-schema-${database}`.slice(0, 64);
  try {
    // Render can briefly start overlapping instances during a deploy. Keep the
    // second migration alive until the first releases its database-wide lock.
    let [[result]] = await lock.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (Number(result.acquired) !== 1) {
      console.log('Another schema update is running; waiting up to five minutes.');
      [[result]] = await lock.query('SELECT GET_LOCK(?, 300) AS acquired', [lockName]);
    }
    if (Number(result.acquired) !== 1) throw new Error('Timed out waiting for the other schema update to finish.');
    if (createDatabase) {
      if (process.env.NODE_ENV === 'production') throw new Error('Create the production database in Aiven Console first.');
      await lock.query('CREATE DATABASE IF NOT EXISTS ??', [database]);
    }
    await sequelize.authenticate();
    await ensureAdminSchema();
    const queryInterface = sequelize.getQueryInterface();
    for (const model of Object.values(sequelize.models)) {
      const columns = await queryInterface.describeTable(model.getTableName());
      for (const attribute of Object.values(model.getAttributes())) {
        if (!columns[attribute.field]) {
          await queryInterface.addColumn(model.getTableName(), attribute.field, attribute);
          console.log(`Added ${model.getTableName()}.${attribute.field}`);
        }
      }
    }
    const applicationIndexes = await queryInterface.showIndex('TenantApplications');
    for (const [name, fields] of [
      ['tenant_application_room_reservations', ['ownerId', 'reservationRoomId', 'status']],
      ['tenant_application_reservation_references', ['ownerId', 'reservationMethod', 'reservationReference']]
    ]) {
      if (!applicationIndexes.some(index => index.name === name)) {
        await queryInterface.addIndex('TenantApplications', fields, { name });
      }
    }
  } finally {
    await lock.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    await lock.end();
  }
}

export async function closeDatabase() {
  sessionStore.stopExpiringSessions();
  await sequelize.close();
}
