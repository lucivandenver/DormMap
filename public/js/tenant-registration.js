(() => {
  const form = document.getElementById('tenantSetupForm');
  const search = document.getElementById('bhSearchInput');
  const select = document.getElementById('bhSelect');
  const roomTypes = document.getElementById('roomTypeSelect');
  const listingsStatus = document.getElementById('tenantListingsStatus');
  const retry = document.getElementById('tenantListingsRetry');
  const error = document.getElementById('tenantSetupError');
  const submit = form.querySelector('button[type="submit"]');
  const gender = form.elements.gender;
  gender.value = gender.dataset.selected || '';
  let houses = [];
  let selected = select.dataset.selected || '';
  let preferredRoom = roomTypes.dataset.selected || '';
  let map;
  let markers;

  function changeHouse(pan = false) {
    const house = houses.find(item => item.id === selected);
    roomTypes.replaceChildren(new Option('Any room type', ''), ...(house?.roomTypes || []).map(name => new Option(name, name)));
    roomTypes.value = [...roomTypes.options].some(option => option.value === preferredRoom) ? preferredRoom : '';
    roomTypes.disabled = !house || roomTypes.options.length === 1;
    submit.disabled = !house;
    const marker = markers?.getLayers().find(layer => layer.options.listingId === selected);
    if (pan && marker) map.setView(marker.getLatLng(), 16);
  }

  function showHouses() {
    const query = search.value.trim().toLowerCase();
    const filtered = houses.filter(house => house.id === selected ||
      [house.boardingHouseName, house.propertyName, house.barangay].join(' ').toLowerCase().includes(query));
    select.replaceChildren(new Option(filtered.length ? 'Choose a boarding house' : 'No matching boarding houses', ''),
      ...filtered.map(house => new Option(`${house.boardingHouseName} · ${house.barangay || 'Bongabong'}`, house.id)));
    select.disabled = !filtered.length;
    select.value = selected;
    listingsStatus.textContent = filtered.length ? '' : 'No approved boarding houses match your search.';
    if (!map) return;
    markers.clearLayers();
    for (const house of filtered) {
      if (house.latitude == null || house.longitude == null || house.latitude === '' || house.longitude === '') continue;
      const lat = Number(house.latitude);
      const lng = Number(house.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const marker = L.marker([lat, lng], { listingId: house.id, title: house.boardingHouseName,
        ...(window.dormMapPropertyPin ? { icon: dormMapPropertyPin(L, false, house) } : {}) }).addTo(markers);
      marker.on('click', () => {
        selected = house.id;
        preferredRoom = '';
        select.value = house.id;
        changeHouse();
      });
    }
  }

  function showMap() {
    if (!window.L || map) return;
    document.getElementById('tenantSetupMap').hidden = false;
    map = L.map('tenantMiniMap', { scrollWheelZoom: false }).setView([12.7192, 121.4719], 14);
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    window.dormMapFullMap?.(L, map, tiles);
    markers = L.layerGroup().addTo(map);
  }

  async function loadHouses() {
    retry.hidden = true;
    listingsStatus.textContent = 'Loading boarding houses…';
    try {
      const response = await fetch('/api/boarding-houses');
      if (!response.ok) throw new Error();
      houses = (await response.json()).filter(house => house.registrationStatus === 'registered');
    } catch {
      listingsStatus.textContent = 'Boarding houses could not be loaded.';
      retry.hidden = false;
      return;
    }
    if (houses.length) showMap();
    if (!houses.some(house => house.id === selected)) {
      selected = houses.find(house => house.boardingHouseName === selected)?.id || '';
    }
    showHouses();
    changeHouse(true);
  }

  search.addEventListener('input', showHouses);
  search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  retry.addEventListener('click', loadHouses);
  select.addEventListener('change', () => { selected = select.value; preferredRoom = ''; changeHouse(true); });
  roomTypes.addEventListener('change', () => { preferredRoom = roomTypes.value; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Submitting…';
    error.hidden = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.redirect) throw new Error(data.error || 'Could not submit your application. Please try again.');
      window.location.assign(data.redirect);
    } catch (cause) {
      error.textContent = cause instanceof TypeError ? 'Connection interrupted. Try submitting again.' : cause.message;
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      changeHouse();
      submit.querySelector('span').textContent = 'Submit application';
    }
  });
  loadHouses();
})();
