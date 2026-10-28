import fs from 'node:fs';

export function databaseConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production) {
    for (const key of ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST']) {
      if (!env[key]) throw new Error(`${key} is required in production.`);
    }
  }
  const port = Number(env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }
  const sslEnabled = env.DB_SSL === 'true';
  if (production && !sslEnabled) throw new Error('Set DB_SSL=true for the production database.');
  let ssl;
  if (sslEnabled) {
    const ca = env.DB_SSL_CA?.replace(/\\n/g, '\n') ||
      (env.DB_SSL_CA_PATH ? fs.readFileSync(env.DB_SSL_CA_PATH, 'utf8') : '');
    if (!ca.trim()) throw new Error('Set DB_SSL_CA or DB_SSL_CA_PATH to the Aiven CA certificate.');
    ssl = { ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
  }
  return {
    database: env.DB_NAME || 'DorMap',
    username: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    host: env.DB_HOST || 'localhost',
    port,
    ssl,
  };
}
