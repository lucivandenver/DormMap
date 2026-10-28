// Photon/OpenStreetMap lookup: only on a submitted place selection, cached and throttled.
const cache = new Map();
const inFlight = new Map();
let nextRequestAt = 0;
let queue = Promise.resolve();
export const BONGABONG_BOUNDS = [[12.48, 121.05], [12.91, 121.58]];
export function storedPlace(record) {
  if (!record || record.latitude === null || record.longitude === null || record.latitude === '' || record.longitude === '') return null;
  const latitude = Number(record.latitude), longitude = Number(record.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 12.48 || latitude > 12.91 || longitude < 121.05 || longitude > 121.58) return null;
  return { name: record.name, latitude, longitude, source: 'BPLO coordinates' };
}

export async function lookupPlace(name, kind, fetcher = fetch) {
  const key = `${kind}:${name.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);
  if (inFlight.size >= 10) throw new Error('Place search busy. Please retry shortly.');
  const task = queue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())));
    nextRequestAt = Date.now() + 1100;
    const url = new URL(process.env.MAP_GEOCODING_URL || 'https://photon.komoot.io/api/');
    url.search = new URLSearchParams({ q: name, limit: '5', bbox: '121.05,12.48,121.58,12.91', lang: 'en' }).toString();
    const response = await fetcher(url, { headers: { 'User-Agent': 'DormMap/1.0 (Bongabong boarding house finder)' }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Geocoding provider unavailable');
    const data = await response.json();
    const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalized(name);
    const feature = (data.features || []).find(feature => {
      const p = feature.properties || {};
      const result = normalized(p.name);
      const location = feature.geometry?.coordinates;
      const matchingName = result === target || (kind === 'institution' && target.length > 5 && (result.includes(target) || target.includes(result)));
      const outsideMunicipality = /bansud|roxas|mansalay|bulalacao|pinamalayan|gloria|baco|calapan/i.test(String(p.city || p.county || ''));
      const validKind = kind !== 'barangay' || ['village', 'hamlet', 'suburb', 'quarter', 'administrative', 'neighbourhood'].includes(p.osm_value);
      return !outsideMunicipality && validKind && matchingName && result && location && storedPlace({ latitude: location[1], longitude: location[0], name: p.name });
    });
    const value = feature ? { name: feature.properties.name, latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0], source: 'OpenStreetMap / Photon' } : null;
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + (value ? 86400000 : 300000) });
    return value;
  });
  queue = task.catch(() => {});
  inFlight.set(key, task);
  try { return await task; } finally { inFlight.delete(key); }
}
