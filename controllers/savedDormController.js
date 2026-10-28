import { SavedDorm } from '../models/savedDormModel.js';
import { listTenantDorms } from '../services/dormListingService.js';

const validKey = key => /^(bh|owner)-[1-9]\d{0,9}$/.test(key);

export async function saveDorm(req, res, next) {
  try {
    const key = req.params.listingKey;
    if (!validKey(key)) return res.status(400).json({ error: 'Invalid dorm listing.' });
    const listings = await listTenantDorms(req.currentUser.id);
    if (!listings.some(item => item.id === key)) {
      return res.status(404).json({ error: 'This dorm is no longer available for browsing.' });
    }
    await SavedDorm.findOrCreate({ where: { tenantId: req.currentUser.id, listingKey: key } });
    res.json({ listingKey: key, isSaved: true });
  } catch (error) { next(error); }
}

export async function removeSavedDorm(req, res, next) {
  try {
    const key = req.params.listingKey;
    if (!validKey(key)) return res.status(400).json({ error: 'Invalid dorm listing.' });
    // Idempotent and scoped to the signed-in tenant; stale listings can be removed.
    await SavedDorm.destroy({ where: { tenantId: req.currentUser.id, listingKey: key } });
    res.json({ listingKey: key, isSaved: false });
  } catch (error) { next(error); }
}
