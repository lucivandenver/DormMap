import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname });

const database = process.env.DB_NAME || 'DorMap';
const username = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const host = process.env.DB_HOST || 'localhost';
const dialect = process.env.DB_DIALECT || 'mysql';

export const sequelize = new Sequelize(database, username, password, {
  host,
  dialect,
  logging: false,
  define: {
    underscored: true,
    paranoid: true,
    timestamps: true,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

export const testDatabaseConnection = async () => {
  await sequelize.authenticate();
  return true;
};
