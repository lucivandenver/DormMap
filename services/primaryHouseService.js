import { BoardingHouse } from '../models/ownerModels.js';
export async function syncPrimaryHouse(ownerId, values, options = {}) {
  const fields = { boardingHouseName: 'name', boardingHouseAddress: 'address', boardingHouseLatitude: 'latitude', boardingHouseLongitude: 'longitude', boardingHousePicture: 'picture', amenities: 'amenities', houseRules: 'houseRules', description: 'description', mapPin: 'mapPin' };
  const changes = Object.fromEntries(Object.entries(fields).filter(([key]) => values[key] !== undefined).map(([key,target]) => [target,values[key]]));
  if (Object.keys(changes).length) await BoardingHouse.update(changes, { where: { ownerId, isPrimary: true }, ...options });
}
