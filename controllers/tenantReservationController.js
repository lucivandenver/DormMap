import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadDir } from '../config/storage.js';
import { photoType } from '../services/propertyPhotoService.js';
import { readReservationQr } from '../services/reviewFileService.js';
import { getReservationQuote } from '../services/tenantReservationService.js';

export async function reservationQuote(req, res, next) {
  try {
    const quote = await getReservationQuote(req.params.listing, req.query.roomId);
    const { methods, qrCodes } = quote.payment;
    const query = new URLSearchParams({ roomId: quote.room.id });
    res.set('Cache-Control', 'no-store').json({ monthlyRent: quote.monthlyRent, fee: quote.fee,
      rentalBasis: quote.room.rentalBasis, methods,
      qrCodes: Object.fromEntries(methods.filter(method => qrCodes[method]).map(method => [method,
        `/api/boarding-houses/${req.params.listing}/reservation/qr/${encodeURIComponent(method)}?${query}`])) });
  } catch (error) { next(error); }
}

export async function reservationQr(req, res, next) {
  try {
    const quote = await getReservationQuote(req.params.listing, req.query.roomId);
    const method = req.params.method;
    if (!quote.payment.methods.includes(method)) return res.sendStatus(404);
    const url = quote.payment.qrCodes[method];
    if (!url) return res.sendStatus(404);
    const bytes = url.startsWith('/uploads/')
      ? await readFile(path.join(uploadDir, path.basename(url))).catch(() => null)
      : (await readReservationQr(quote.owner.id, url))?.bytes;
    const type = photoType(bytes);
    if (!type) return res.sendStatus(404);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).type(type).send(bytes);
  } catch (error) { next(error); }
}
