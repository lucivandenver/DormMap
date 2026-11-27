import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const registrationTemp = path.join(tmpdir(), 'dormmap-registration');
const draftRoot = path.join(registrationTemp, 'drafts');
const draftLifetime = 2 * 60 * 60 * 1000;
const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const draftError = (message, status = 422) => Object.assign(new Error(message), { status });
let nextSweep = 0;

async function removeExpiredDrafts() {
  if (Date.now() < nextSweep) return;
  nextSweep = Date.now() + 60_000;
  for (const entry of await readdir(draftRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(draftRoot, entry.name);
    const info = await stat(directory).catch(() => null);
    if (info && Date.now() - info.mtimeMs > draftLifetime) await rm(directory, { recursive: true, force: true });
  }
}

export async function startRegistrationDraft(req) {
  const attempt = req.body?.attempt;
  if (attempt !== undefined && (typeof attempt !== 'string' || !/^[a-f0-9]{32}$/.test(attempt))) {
    throw draftError('Please start a new registration upload.');
  }
  const existing = req.session.registrationDraft;
  if (existing && attempt === req.session.registrationDraftAttempt && existing !== req.session.completedRegistrationDraft?.id) {
    const directory = await registrationDraftDirectory(req, existing).catch(error => {
      if (error.status !== 410) throw error;
    });
    if (directory) return existing;
  }
  const id = randomUUID();
  await mkdir(path.join(draftRoot, id), { recursive: true, mode: 0o700 });
  void removeExpiredDrafts().catch(error => console.error('Registration draft cleanup:', error.message));
  req.session.registrationDraft = id;
  req.session.registrationDraftAttempt = attempt;
  return id;
}

export async function registrationDraftDirectory(req, id) {
  if (!id || id !== req.session.registrationDraft) throw draftError('Your upload session expired. Please try submitting again.', 410);
  const directory = path.join(draftRoot, id);
  const info = await stat(directory).catch(() => null);
  if (!info || Date.now() - info.mtimeMs > draftLifetime) throw draftError('Your upload session expired. Please try submitting again.', 410);
  return directory;
}

export async function saveRegistrationDraftFile(directory, field, file) {
  if (!file) throw draftError('Choose a file to upload.');
  const extension = path.extname(file.originalname).toLowerCase().slice(1);
  if (types[extension] !== file.mimetype) throw draftError('Choose a JPG, PNG, WebP, or PDF with the matching file extension.');
  await rename(file.path, path.join(directory, `${field}.${extension}`));
  return extension;
}

export async function useRegistrationDraft(req, fields) {
  const { registrationDraft, registrationFiles } = req.body;
  if (!registrationDraft) return;
  const directory = await registrationDraftDirectory(req, registrationDraft);
  let entries;
  try { entries = JSON.parse(registrationFiles); } catch { throw draftError('Please submit the registration attachments again.'); }
  if (!Array.isArray(entries) || entries.length > fields.size) throw draftError('Invalid registration attachments.');
  req.files ||= {};
  const used = new Set();
  await Promise.all(entries.map(async entry => {
    const [field, extension] = Array.isArray(entry) ? entry : [];
    if (!fields.has(field) || typeof extension !== 'string' || !Object.hasOwn(types, extension) || req.files[field] || used.has(field)) throw draftError('Invalid registration attachment.');
    used.add(field);
    const originalname = `${field}.${extension}`;
    const filename = path.join(directory, originalname);
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) throw draftError('An attachment expired. Please try submitting again.', 410);
    req.files[field] = [{ fieldname: field, originalname, path: filename, size: info.size, mimetype: types[extension], staged: true }];
  }));
  req.registrationDraftDirectory = directory;
}
