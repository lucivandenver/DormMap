import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = fileURLToPath(new URL('../', import.meta.url));
export const publicDir = path.join(projectDir, 'public');
export const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(publicDir, 'uploads'));

// Keep existing /uploads URLs working when moving to a Render disk. Never overwrite
// a file already on the disk with a version from an older Git checkout.
export function prepareUploads(destination = uploadDir, source = path.join(publicDir, 'uploads')) {
  fs.mkdirSync(destination, { recursive: true });
  if (path.resolve(destination) === path.resolve(source) || !fs.existsSync(source)) return;
  for (const file of fs.readdirSync(source, { withFileTypes: true })) {
    if (!file.isFile()) continue;
    try {
      fs.copyFileSync(path.join(source, file.name), path.join(destination, file.name), fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}
