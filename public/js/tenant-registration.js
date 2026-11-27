(() => {
  const defaultCenter = [12.7192, 121.4719];
  const listingTitle = house => house.boardingHouseName || window.dormMapListingTitle?.(house) || 'Boarding house';
  const listingLabel = house => [listingTitle(house), house.barangay].filter(Boolean).join(' · ');
  const roomLabel = room => [`Room ${room.roomNumber}`, room.floor, room.roomType].filter(Boolean).join(' · ');

  function photoUrls(house) {
    return [...new Set([house?.boardingHousePicture, ...(house?.galleryImages || [])])].flatMap(source => {
      if (!source) return [];
      try {
        const url = new URL(source, window.location.href);
        return ['https:', 'http:'].includes(url.protocol) ? [url.href] : [];
      } catch { return []; }
    });
  }

  function coordinates(house) {
    const values = [house.latitude, house.longitude];
    if (values.some(value => value == null || value === '')) return null;
    const [lat, lng] = values.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? [lat, lng] : null;
  }

  function setupPropertyPicker(picker) {
    const field = picker.querySelector('[name="selectedBoardingHouse"]');
    const room = picker.querySelector('[name="requestedRoomId"]');
    const search = picker.querySelector('[data-house-search]');
    const mapElement = picker.querySelector('[data-house-map]');
    const results = picker.querySelector('[data-house-results]');
    const status = picker.querySelector('[data-house-status]');
    const retry = picker.querySelector('[data-retry-houses]');
    const clear = picker.querySelector('[data-clear-house]');
    const selection = picker.querySelector('[data-house-selection]');
    const selectedName = picker.querySelector('[data-house-name]');
    const details = picker.querySelector('[data-registration-details]');
    const selectedPhoto = picker.querySelector('[data-selected-photo]');
    const reservation = window.DormReservations.setup(picker.querySelector('[data-reservation]'));
    let detailsHouse;
    let detailsFromMap;

    const initialHouse = field.value;
    let houses = [];
    let selected;
    let markerLayer;
    let visiblePoints = [];
    let map;
    let coLocated = [];
    let isVisible = false;
    let started = false;
    let loaded = false;

    function showStatus(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function updatePreference(value = room.value, restore = false) {
      const available = (selected?.roomInventory || []).filter(item => item.status === 'available' && Number(item.availableSlots) > 0);
      room.replaceChildren(new Option('No preference', ''), ...available.map(item => new Option(roomLabel(item), item.id)));
      room.value = [...room.options].some(option => option.value === value) ? value : '';
      room.closest('[data-room-preference]').hidden = !available.length;
      room.disabled = !available.length;
      if (loaded) reservation.select(selected?.id, room.value, { restore });
    }

    function selectHouse(house, { focusMap = false, fromMap = false, preference = '', restore = false } = {}) {
      const changed = selected?.id !== house?.id;
      selected = house;
      field.value = house?.id || '';
      selection.hidden = !house;
      selectedName.textContent = house ? listingLabel(house) : '';
      selectedPhoto.hidden = true;
      selectedPhoto.removeAttribute('src');
      const photo = photoUrls(house)[0];
      if (photo) selectedPhoto.src = photo;
      updatePreference(changed ? preference : room.value, restore);
      for (const button of results.querySelectorAll('[data-house-id]')) {
        button.setAttribute('aria-pressed', String(house?.id === button.dataset.houseId));
      }
      if (house) {
        showStatus('');
        const point = coordinates(house);
        if (focusMap && map && point) map.setView(point, 16, { animate: false });
        if (fromMap && map) {
          map.closePopup();
          window.dormMapCloseExpanded?.(map);
        }
      }
    }

    function viewDetails(house, fromMap) {
      detailsHouse = house;
      detailsFromMap = fromMap;
      details.querySelector('[data-details-name]').textContent = listingTitle(house);
      details.querySelector('[data-details-address]').textContent = window.dormMapListingLocation(house);

      const gallery = details.querySelector('[data-details-photos]');
      gallery.replaceChildren(...photoUrls(house).map((url, index) => {
        const photo = document.createElement('img');
        photo.alt = `${listingTitle(house)} · Photo ${index + 1}`;
        photo.loading = index ? 'lazy' : 'eager';
        photo.addEventListener('error', () => photo.remove(), { once: true });
        photo.src = url;
        return photo;
      }));
      details.querySelector('[data-details-summary]').textContent = [
        house.propertyType, `${house.roomsAvailable ?? 0} available rooms`
      ].filter(Boolean).join(' · ');
      const description = details.querySelector('[data-details-description]');
      description.textContent = house.description || '';
      description.hidden = !house.description;
      const prices = details.querySelector('[data-details-prices]');
      prices.replaceChildren(...[['Per room', house.rentPerRoom], ['Per head', house.rentPerHead]].map(([label, amount]) => {
        const block = document.createElement('div');
        const term = document.createElement('dt');
        const value = document.createElement('dd');
        term.textContent = label;
        value.textContent = Number(amount) > 0 ? `₱${Number(amount).toLocaleString('en-PH')} / month` : 'Ask the owner';
        block.append(term, value);
        return block;
      }));
      const amenities = details.querySelector('[data-details-amenities]');
      let list = house.amenities || '';
      if (typeof list === 'string') {
        try { const parsed = JSON.parse(list); if (Array.isArray(parsed)) list = parsed; } catch { /* The owner entered plain text. */ }
      }
      const items = (Array.isArray(list) ? list : list.split(/[,;\n]+/)).map(value => String(value).trim()).filter(Boolean);
      amenities.hidden = !items.length;
      amenities.querySelector('ul').replaceChildren(...items.map(item => {
        const entry = document.createElement('li');
        entry.textContent = item;
        return entry;
      }));
      details.querySelector('[data-details-rooms]').innerHTML = window.DormRoomDetails.render(house.roomInventory || []);
      if (!details.open) details.showModal();
    }

    function housePreview(house, fromMap) {
      const preview = document.createElement('div');
      preview.className = 'registration-house-preview';
      const heading = document.createElement('div');
      heading.className = 'registration-house-heading';
      const cover = photoUrls(house)[0];
      if (fromMap && cover) {
        const image = document.createElement('img');
        image.alt = '';
        image.addEventListener('error', () => image.remove(), { once: true });
        image.src = cover;
        heading.append(image);
      }
      const name = document.createElement('strong');
      name.textContent = listingLabel(house);
      heading.append(name);
      const actions = document.createElement('div');
      actions.className = 'registration-house-actions';
      const view = document.createElement('button');
      view.type = 'button';
      view.textContent = 'View details';
      view.setAttribute('aria-label', `View details for ${listingLabel(house)}`);
      view.addEventListener('click', () => viewDetails(house, fromMap));
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'registration-select-house';
      choose.dataset.houseId = house.id;
      choose.textContent = 'Select boarding house';
      choose.setAttribute('aria-label', `Select ${listingLabel(house)}`);
      choose.setAttribute('aria-pressed', String(house.id === selected?.id));
      choose.addEventListener('click', () => selectHouse(house, { focusMap: !fromMap, fromMap }));
      actions.append(view, choose);
      preview.append(heading, actions);
      return preview;
    }

    function frameMarkers() {
      if (visiblePoints.length === 1) map.setView(visiblePoints[0], 16, { animate: false });
      else if (visiblePoints.length) map.fitBounds(visiblePoints, {
        paddingTopLeft: [32, 68], paddingBottomRight: [32, 45], maxZoom: 16, animate: false
      });
    }

    function drawMarkers(list) {
      if (!map) return;
      markerLayer.clearLayers();
      const groups = new Map();
      for (const house of list) {
        const point = coordinates(house);
        if (!point) continue;
        const key = point.join(',');
        if (groups.has(key)) groups.get(key).houses.push(house);
        else groups.set(key, { point, houses: [house] });
      }
      coLocated = [];
      for (const { point, houses: listings } of groups.values()) {
        const pins = listings.map(house => {
          const title = listingLabel(house);
          const icon = window.dormMapPropertyPin?.(L, false, house);
          const pin = L.marker(point, { title, ...(icon ? { icon } : {}) }).addTo(markerLayer);
          pin.getElement()?.setAttribute('aria-label', title);
          const maxWidth = Math.min(240, Math.max(135, map.getSize().x - 52));
          pin.bindPopup(() => housePreview(house, true), { maxWidth, autoPanPadding: L.point(14, 12), keepInView: true });
          return pin;
        });
        if (pins.length > 1) coLocated.push({ point, pins });
      }
      visiblePoints = [...groups.values()].map(group => group.point);
      frameMarkers();
      spreadCoLocated();
    }

    function spreadCoLocated() {
      for (const { point, pins } of coLocated) {
        const center = map.project(point);
        const radius = Math.max(27, 12 * pins.length);
        for (const [index, pin] of pins.entries()) {
          const angle = (2 * Math.PI * index) / pins.length;
          pin.setLatLng(map.unproject(center.add(L.point(radius * Math.cos(angle), radius * Math.sin(angle)))));
        }
      }
    }

    function showResults() {
      if (!loaded) return;
      const query = search.value.trim().toLowerCase();
      const list = query ? houses.filter(house =>
        [house.boardingHouseName, house.propertyName, house.barangay, house.boardingHouseAddress].join(' ').toLowerCase().includes(query)
      ) : houses;
      results.replaceChildren();
      for (const house of query ? list : []) {
        const row = document.createElement('li');
        row.append(housePreview(house, false));
        results.append(row);
      }
      results.hidden = !query || !list.length;
      showStatus(list.length ? '' : 'No approved boarding houses match your search.');
      drawMarkers(list);
    }

    function openMap() {
      if (!window.L) {
        picker.querySelector('[data-map-unavailable]').hidden = false;
        return;
      }
      map = L.map(mapElement, { scrollWheelZoom: false }).setView(defaultCenter, 14);
      const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap contributors'
      }).addTo(map);
      window.dormMapFullMap?.(L, map, street);
      map.on('zoomend', spreadCoLocated);
      map.on('popupopen', () => mapElement.classList.add('registration-pin-open'));
      map.on('popupclose', () => mapElement.classList.remove('registration-pin-open'));
      map.on('dormmap:expanded', frameMarkers);
      map.on('dormmap:collapsed', () => {
        const point = selected && coordinates(selected);
        if (point && visiblePoints.some(([lat, lng]) => lat === point[0] && lng === point[1])) {
          map.setView(point, 16, { animate: false });
        } else frameMarkers();
      });
      markerLayer = L.layerGroup().addTo(map);
    }

    async function loadHouses() {
      retry.hidden = true;
      showStatus('Loading boarding houses…');
      try {
        const response = await fetch('/api/boarding-houses');
        if (!response.ok) throw new Error();
        houses = (await response.json()).filter(house => house.registrationStatus === 'registered');
        loaded = true;
      } catch {
        showStatus('Boarding houses could not be loaded.');
        retry.hidden = false;
        return;
      }
      showResults();
      if (!selected && initialHouse && field.value === initialHouse) {
        const restored = houses.find(house => house.id === initialHouse) ||
          houses.find(house => house.boardingHouseName === initialHouse);
        selectHouse(restored, { focusMap: true, preference: room.dataset.selected, restore: true });
      }
    }

    function onVisible() {
      const visible = picker.getClientRects().length > 0;
      if (visible && !isVisible) {
        if (!started) {
          started = true;
          openMap();
          loadHouses();
        } else map?.invalidateSize({ pan: false });
        updatePreference();
      }
      isVisible = visible;
    }

    search.addEventListener('input', () => { if (!retry.hidden) return; showResults(); });
    search.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!retry.hidden) loadHouses();
      else showResults();
    });
    picker.querySelector('[data-search-houses]').addEventListener('click', () => {
      if (!retry.hidden) loadHouses();
      else if (search.value.trim()) showResults();
      else search.focus();
    });
    retry.addEventListener('click', loadHouses);
    clear.addEventListener('click', () => {
      selectHouse();
      search.focus();
    });
    room.addEventListener('change', () => reservation.select(selected?.id, room.value));
    selectedPhoto.addEventListener('load', () => { selectedPhoto.hidden = false; });
    selectedPhoto.addEventListener('error', () => { selectedPhoto.hidden = true; });
    picker.querySelector('[data-selected-details]').addEventListener('click', () => { if (selected) viewDetails(selected, false); });
    details.querySelector('[data-close-details]').addEventListener('click', () => details.close());
    details.querySelector('[data-select-details]').addEventListener('click', () => {
      details.close();
      selectHouse(detailsHouse, { focusMap: !detailsFromMap, fromMap: detailsFromMap });
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(onVisible).observe(picker);
    else document.addEventListener('tenant-registration-shown', onVisible);
    onVisible();
  }

  document.querySelectorAll('[data-registration-property]').forEach(setupPropertyPicker);
  const form = document.getElementById('tenantSetupForm');
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');
  const error = document.getElementById('tenantSetupError');
  const gender = form.elements.gender;
  gender.value = ['male', 'female'].includes(gender.dataset.selected) ? gender.dataset.selected : '';
  form.addEventListener('submit', async event => {
    if (event.defaultPrevented) return;
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
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Complete registration';
    }
  });
})();
