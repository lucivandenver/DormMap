(() => {
  const norm = value => String(value || '').trim().toLowerCase();
  const coordinate = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
  function hasCoordinates(house) {
    return coordinate(house.latitude) && coordinate(house.longitude) && Math.abs(Number(house.latitude)) <= 90 && Math.abs(Number(house.longitude)) <= 180;
  }
  function distanceKm(a, b) {
    const rad = value => value * Math.PI / 180;
    const dlat = rad(Number(b.latitude) - Number(a.latitude));
    const dlon = rad(Number(b.longitude) - Number(a.longitude));
    const x = Math.sin(dlat / 2) ** 2 + Math.cos(rad(Number(a.latitude))) * Math.cos(rad(Number(b.latitude))) * Math.sin(dlon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }
  const ranges = { under_1000: [0, 999.99], '1000_2000': [1000, 2000], '2000_3000': [2000, 3000], '3000_4000': [3000, 4000], '4000_5000': [4000, 5000], above_5000: [5000, Infinity] };
  function filter(houses, criteria) {
    const { query = '', barangay = '', type = '', priceRange = '', place = null, placeKind = 'institution', radius = 3, unavailable = false } = criteria;
    if (unavailable) return [];
    const distance = house => hasCoordinates(house) ? distanceKm(place, house) : Infinity;
    const result = houses.filter(house => {
      if (query && ![house.boardingHouseName, house.fullName, house.boardingHouseAddress, house.barangay].some(value => norm(value).includes(norm(query)))) return false;
      const inBarangay = norm(house.barangay) === norm(barangay);
      const nearbyBarangay = place && placeKind === 'barangay' && distance(house) <= radius;
      if (barangay && !inBarangay && !nearbyBarangay) return false;
      const matchesPropertyType = norm(house.propertyType) === norm(type);
      const matchesRoomType = value => norm(value) === norm(type);
      if (type && !matchesPropertyType && !(house.roomTypes || []).some(matchesRoomType)) return false;
      if (priceRange) {
        const [low, high] = ranges[priceRange] || [0, Infinity];
        const pricedRooms = (house.roomInventory || []).filter(room => coordinate(room.rentalPrice));
        if (pricedRooms.length) {
          const matchesPrice = room => Number(room.rentalPrice) >= low && Number(room.rentalPrice) <= high;
          if (!pricedRooms.some(room => matchesPrice(room) && (!type || matchesPropertyType || matchesRoomType(room.roomType)))) return false;
        } else {
          const prices = [house.rentalPriceMin, house.rentalPriceMax].filter(coordinate).map(Number);
          if (!prices.length || Math.max(...prices) < low || Math.min(...prices) > high) return false;
        }
      }
      if (place && placeKind === 'institution' && distance(house) > radius) return false;
      return true;
    });
    if (place) result.sort((a, b) => distance(a) - distance(b));
    return result;
  }
  globalThis.DormMapSearch = { hasCoordinates, distanceKm, filter };
})();
