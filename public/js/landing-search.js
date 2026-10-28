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
  const ranges = { under_1000: [0, 999.99], '1000_2000': [1000, 2000], '2000_3000': [2000, 3000], '3000_4000': [3000, 4000], '4000_5000': [4000, 5000], above_5000: [5000.01, Infinity] };
  function filter(houses, criteria) {
    const { query = '', barangay = '', type = '', priceRange = '', place = null, radius = 3 } = criteria;
    const result = houses.filter(house => {
      if (query && ![house.boardingHouseName, house.fullName, house.boardingHouseAddress, house.barangay].some(value => norm(value).includes(norm(query)))) return false;
      if (barangay && norm(house.barangay) !== norm(barangay)) return false;
      if (type && !(house.roomTypes || []).some(value => norm(value).includes(norm(type)))) return false;
      if (priceRange) {
        const prices = [house.rentalPriceMin, house.rentalPriceMax].filter(coordinate).map(Number);
        if (!prices.length) return false;
        const [low, high] = ranges[priceRange] || [0, Infinity];
        if (Math.max(...prices) < low || Math.min(...prices) > high) return false;
      }
      if (place && (!hasCoordinates(house) || distanceKm(place, house) > Number(radius))) return false;
      return true;
    });
    if (place) result.sort((a, b) => distanceKm(place, a) - distanceKm(place, b));
    return result;
  }
  globalThis.DormMapSearch = { hasCoordinates, distanceKm, filter };
})();
