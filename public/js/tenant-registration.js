(() => {
  const defaultCenter = [12.7192, 121.4719];
  const listingTitle = house => house.boardingHouseName || window.dormMapListingTitle?.(house) || 'Boarding house';
  const listingLabel = house => [listingTitle(house), house.barangay].filter(Boolean).join(' · ');
  const roomLabel = room => [`Room ${room.roomNumber}`, room.floor, room.roomType].filter(Boolean).join(' · ');

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
    const detailsPhoto = details.querySelector('[data-details-photo]');
    let detailsHouse;
    let detailsFromMap;

    const initialHouse = field.value;
    let houses = [];
    let selected;
    let markerLayer;
    let visiblePoints = [];
    let map;
    let isVisible = false;
    let started = false;
    let loaded = false;

    function showStatus(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function updatePreference(value = room.value) {
      const available = (selected?.roomInventory || []).filter(item => item.status === 'available' && Number(item.availableSlots) > 0);
      room.replaceChildren(new Option('No preference', ''), ...available.map(item => new Option(roomLabel(item), item.id)));
      room.value = [...room.options].some(option => option.value === value) ? value : '';
      room.closest('[data-room-preference]').hidden = !available.length;
      room.disabled = !available.length;
    }

    function selectHouse(house, { focusMap = false, fromMap = false, preference = '' } = {}) {
      const changed = selected?.id !== house?.id;
      selected = house;
      field.value = house?.id || '';
      selection.hidden = !house;
      selectedName.textContent = house ? listingLabel(house) : '';
      updatePreference(changed ? preference : room.value);
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

      const photo = house.boardingHousePicture || house.galleryImages?.find(Boolean);
      detailsPhoto.hidden = true;
      detailsPhoto.removeAttribute('src');
      if (photo) {
        try {
          const url = new URL(photo, window.location.href);
          if (['https:', 'http:'].includes(url.protocol)) detailsPhoto.src = url.href;
        } catch { /* The listing can still be viewed without a photo. */ }
      }
      const rate = Number(house.rentalPriceMin || house.rentPerHead || house.rentPerRoom || 0);
      details.querySelector('[data-details-summary]').textContent = [
        house.propertyType, `${house.roomsAvailable ?? 0} available rooms`,
        rate > 0 ? `From ₱${rate.toLocaleString('en-PH')} / month` : ''
      ].filter(Boolean).join(' · ');
      const description = details.querySelector('[data-details-description]');
      description.textContent = house.description || '';
      description.hidden = !house.description;
      details.querySelector('[data-details-rooms]').innerHTML = window.DormRoomDetails.render(house.roomInventory || []);
      if (!details.open) details.showModal();
    }

    function housePreview(house, fromMap) {
      const preview = document.createElement('div');
      preview.className = 'registration-house-preview';
      const name = document.createElement('strong');
      name.textContent = listingLabel(house);
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
      preview.append(name, actions);
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
      for (const { point, houses: listings } of groups.values()) {
        const [first] = listings;
        const title = listings.length === 1 ? listingLabel(first) : `${listings.length} boarding houses at this location`;
        const icon = window.dormMapPropertyPin?.(L, false, first);
        const pin = L.marker(point, { title, ...(icon ? { icon } : {}) }).addTo(markerLayer);
        pin.getElement()?.setAttribute('aria-label', title);
        const maxWidth = Math.min(250, Math.max(140, map.getSize().x - 58));
        pin.bindPopup(() => {
          const choices = document.createElement('div');
          choices.className = 'registration-map-choices';
          const nearby = [...listings];
          const position = map.latLngToContainerPoint(point);
          // Pins whose icons overlap should all be reachable from the visible pin.
          for (const group of groups.values()) {
            if (group.point === point) continue;
            const other = map.latLngToContainerPoint(group.point);
            if (Math.abs(position.x - other.x) < 48 && Math.abs(position.y - other.y) < 55) {
              nearby.push(...group.houses);
            }
          }
          choices.append(...nearby.map(house => housePreview(house, true)));
          return choices;
        }, { maxWidth, autoPanPadding: L.point(18, 24), keepInView: true });
      }
      visiblePoints = [...groups.values()].map(group => group.point);
      frameMarkers();
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
        selectHouse(restored, { focusMap: true, preference: room.dataset.selected });
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
    detailsPhoto.addEventListener('load', () => { detailsPhoto.hidden = false; });
    detailsPhoto.addEventListener('error', () => { detailsPhoto.hidden = true; });
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
