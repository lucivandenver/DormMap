import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const projectDir = fileURLToPath(new URL('../', import.meta.url));
export const publicDir = path.join(projectDir, 'public');
export let uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(publicDir, 'uploads'));

function ensureWritable(directory) {
  fs.mkdirSync(directory, { recursive: true });
  // Checking an existing folder alone misses read-only mounts. Verify that the
  // running account can actually create and remove a file before accepting it.
  const probe = path.join(directory, `.dormmap-write-check-${randomUUID()}`);
  const descriptor = fs.openSync(probe, 'wx', 0o600);
  try { fs.closeSync(descriptor); } finally { fs.unlinkSync(probe); }
}

// Keep existing /uploads URLs working when moving to a Render disk. Never overwrite
// a file already on the disk with a version from an older Git checkout.
export function prepareUploads(destination = uploadDir, source = path.join(publicDir, 'uploads')) {
  const configured = path.resolve(destination);
  let effective = configured;
  try {
    ensureWritable(effective);
  } catch (error) {
    const fallback = path.resolve(source);
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code) ||
        configured === fallback || process.env.UPLOAD_DIR_STRICT === 'true') throw error;
    ensureWritable(fallback);
    effective = fallback;
    console.warn(`[Storage] ${configured} is not writable (${error.code}). Using ${fallback}. ` +
      'Uploads in this fallback are temporary on Render and can be lost on restart or redeploy. ' +
      'Attach a persistent disk for durable uploads.');
  }
  // All route imports are live bindings. Multer, exports and express.static must
  // use the same directory selected during startup, including the fallback.
  if (configured === uploadDir) uploadDir = effective;
  if (effective === path.resolve(source) || !fs.existsSync(source)) return effective;
  for (const file of fs.readdirSync(source, { withFileTypes: true })) {
    if (!file.isFile()) continue;
    try {
      fs.copyFileSync(path.join(source, file.name), path.join(effective, file.name), fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return effective;
}
