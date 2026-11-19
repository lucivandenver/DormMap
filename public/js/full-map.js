(() => {
  const key = document.querySelector('meta[name="dormmap-maptiler-key"]')?.content;
  const cartoKey = document.querySelector('meta[name="dormmap-carto-basemap-key"]')?.content;
  const controls = new WeakMap();
  const locationPins = new WeakMap();
  const locationRequests = new WeakMap();

  window.dormMapLocate = (leaflet, map) => {
    if (!navigator.geolocation) return Promise.reject(new Error('This browser does not support location access.'));
    if (locationRequests.has(map)) return locationRequests.get(map);
    const request = new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        resolve([coords.latitude, coords.longitude]);
      }, error => reject(new Error(error.code === 1
        ? 'Location access is blocked. Allow it in your browser and try again.'
        : 'Your current location could not be determined. Try again.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
    }).then(point => {
      let pin = locationPins.get(map);
      if (pin) pin.setLatLng(point);
      else {
        pin = leaflet.circleMarker(point, { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })
          .addTo(map).bindPopup('Your current location');
        locationPins.set(map, pin);
      }
      map.setView(point, Math.max(map.getZoom(), 16));
      pin.openPopup();
      return point;
    }).finally(() => locationRequests.delete(map));
    locationRequests.set(map, request);
    return request;
  };

  window.dormMapFullMap = (leaflet, map, street, picker, listings) => {
    const container = map.getContainer();
    const mapTiler = key ? leaflet.tileLayer(
      `https://api.maptiler.com/maps/satellite-v4/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      { tileSize: 512, zoomOffset: -1, maxZoom: 21, attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a>' }
    ) : null;
    const esri = leaflet.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
      { maxNativeZoom: 17, maxZoom: 18, attribution: 'Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community' }
    );
    const satellite = mapTiler || esri;
    const voyager = cartoKey ? leaflet.tileLayer(
      `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey)}`,
      { maxNativeZoom: 19, maxZoom: 20, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> © <a href="https://carto.com/basemaps/">CARTO</a>' }
    ) : null;
    let activeLayer = street;
    const control = leaflet.control({ position: 'bottomright' });
    control.onAdd = () => {
      const button = leaflet.DomUtil.create('button', 'dormmap-expand-map');
      button.type = 'button';
      button.innerHTML = '<svg width="17" height="17" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/></svg> Open full map';
      leaflet.DomEvent.disableClickPropagation(button);
      button.addEventListener('click', () => open(button));
      return button;
    };

    function open(trigger) {
      if (controls.has(map)) return;
      const dialog = document.createElement('dialog');
      dialog.className = 'dormmap-full-map';
      dialog.setAttribute('aria-label', picker ? 'Choose property location' : 'DormMap full map');
      dialog.innerHTML = `<div class="dormmap-map-toolbar">
        <strong>${picker ? 'Choose property location' : 'DormMap'}</strong>
        <div aria-label="Map layer"><button type="button" data-street>Street</button>
        ${voyager ? '<button type="button" data-voyager>Voyager</button>' : ''}
        <button type="button" data-satellite>Satellite</button></div>
        <button type="button" data-close>${picker ? 'Cancel' : 'Close'}</button>
      </div><p class="dormmap-map-status" role="status"></p>
      <div class="dormmap-map-stage">${listings ? `<aside class="dormmap-map-sidebar" aria-label="Boarding house listings">
        <div class="dormmap-sidebar-heading"><strong>Boarding houses</strong><span data-listing-count></span></div>
        <div data-full-map-listings></div>
      </aside>` : ''}</div>
      ${picker ? '<div class="dormmap-map-toolbar"><button type="button" data-use disabled>Use this location</button></div>' : ''}`;
      const status = dialog.querySelector('[role="status"]');
      const stage = dialog.querySelector('.dormmap-map-stage');
      const streetButton = dialog.querySelector('[data-street]');
      const satelliteButton = dialog.querySelector('[data-satellite]');
      const voyagerButton = voyager && dialog.querySelector('[data-voyager]');
      const use = dialog.querySelector('[data-use]');
      const placeholder = document.createComment('DormMap map position');
      container.before(placeholder);
      stage.append(container);
      document.body.append(dialog);
      controls.set(map, dialog);

      let loadedTiles = 0;
      let failedTiles = 0;
      const alternateLayers = [voyager, mapTiler, esri].filter(Boolean);
      const startTiles = () => { loadedTiles = failedTiles = 0; };
      const tileLoaded = () => { loadedTiles++; };
      const tileFailed = () => { failedTiles++; };

      function selectLayer(layer) {
        streetButton.setAttribute('aria-pressed', String(layer === street));
        voyagerButton?.setAttribute('aria-pressed', String(layer === voyager));
        satelliteButton.setAttribute('aria-pressed', String(layer === mapTiler || layer === esri));
        if (layer === activeLayer) return;
        map.removeLayer(activeLayer);
        activeLayer = layer;
        startTiles();
        map.addLayer(layer);
      }

      function tilesFinished(event) {
        if (event.target !== activeLayer || !failedTiles || loadedTiles) return;
        if (activeLayer === mapTiler) {
          selectLayer(esri);
          status.textContent = 'Showing Esri satellite imagery.';
          return;
        }
        const failedLayer = activeLayer === voyager ? 'Voyager tiles' : 'Satellite imagery';
        selectLayer(street);
        status.textContent = `${failedLayer} could not load. Showing Street view.`;
      }

      const tileEvents = { loading: startTiles, tileload: tileLoaded, tileerror: tileFailed, load: tilesFinished };
      for (const layer of alternateLayers) layer.on(tileEvents);
      function changeLayer(layer) {
        if (!picker) status.textContent = '';
        else if (draft) updateDraft(draft.getLatLng());
        else status.textContent = 'Tap the map to drop a pin, then drag it to adjust.';
        selectLayer(layer);
      }
      streetButton.onclick = () => changeLayer(street);
      if (voyagerButton) voyagerButton.onclick = () => changeLayer(voyager);
      satelliteButton.onclick = () => changeLayer(satellite);
      selectLayer(activeLayer);
      const resize = () => map.invalidateSize({ animate: false, pan: false });
      const scrollEnabled = map.scrollWheelZoom.enabled();
      const zoomPosition = map.zoomControl?.getPosition();
      map.scrollWheelZoom.enable();
      map.zoomControl?.setPosition('topright');
      const locationControl = leaflet.control({ position: 'topright' });
      locationControl.onAdd = () => {
        const wrapper = leaflet.DomUtil.create('div', 'dormmap-location-control');
        const button = document.createElement('button');
        button.type = 'button';
        button.title = 'Use my current location';
        button.setAttribute('aria-label', button.title);
        button.innerHTML = '<svg width="18" height="18" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1"/></svg>';
        wrapper.append(button);
        leaflet.DomEvent.disableClickPropagation(wrapper);
        button.onclick = async () => {
          button.disabled = true;
          status.textContent = 'Finding your location…';
          try {
            await window.dormMapLocate(leaflet, map);
            status.textContent = picker ? 'Tap the map to place the property pin.' : '';
          } catch (error) { status.textContent = error.message; }
          finally { button.disabled = false; }
        };
        return wrapper;
      };
      locationControl.addTo(map);
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
      observer?.observe(stage);
      window.addEventListener('resize', resize);

      const listingCards = new Map();
      function highlightListing(event) {
        for (const [id, card] of listingCards) {
          card.classList.toggle('is-selected', id === String(event.id));
        }
      }
      function renderListings() {
        if (!listings) return;
        const houses = listings.getListings();
        dialog.querySelector('[data-listing-count]').textContent = houses.length;
        const list = dialog.querySelector('[data-full-map-listings]');
        list.replaceChildren();
        listingCards.clear();
        for (const house of houses) {
          const card = window.dormMapListingPopup(house, {
            onDetails: () => listings.onDetails(house),
            onDirections: () => listings.onDirections(house)
          });
          card.classList.add('dormmap-map-listing-card');
          const focus = document.createElement('button');
          focus.type = 'button';
          focus.className = 'dormmap-focus-listing';
          focus.textContent = 'Show on map';
          focus.addEventListener('click', () => listings.onSelect(house));
          card.append(focus);
          listingCards.set(String(house.id), card);
          list.append(card);
          window.dormMapRefreshListingDistance(leaflet, card, house);
        }
        if (!houses.length) list.textContent = 'No boarding houses match the current map filters.';
      }
      renderListings();
      map.on('dormmap:listings-updated', renderListings);
      map.on('dormmap:listing-selected', highlightListing);

      let draft;
      function updateDraft(point) {
        if (!draft) {
          draft = leaflet.marker(point, { draggable: true, icon: picker.existingMarker?.options.icon || window.dormMapPropertyPin(leaflet), zIndexOffset: 1000, title: 'Draft property location' }).addTo(map);
          draft.on('dragend', () => updateDraft(draft.getLatLng()));
        } else draft.setLatLng(point);
        use.disabled = false;
        status.textContent = `Selected: ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}. Drag to adjust, then confirm.`;
      }
      const pick = event => updateDraft(event.latlng);
      if (picker) {
        status.textContent = 'Tap the map to drop a pin, then drag it to adjust.';
        map.on('click', pick);
        const current = picker.current();
        picker.existingMarker?.remove();
        if (current) updateDraft(leaflet.latLng(current));
        use.onclick = () => {
          picker.commit(draft.getLatLng());
          dialog.close();
        };
      }
      dialog.querySelector('[data-close]').onclick = () => dialog.close();
      dialog.addEventListener('close', () => {
        map.off('click', pick);
        map.off('dormmap:listings-updated', renderListings);
        map.off('dormmap:listing-selected', highlightListing);
        observer?.disconnect();
        window.removeEventListener('resize', resize);
        if (!scrollEnabled) map.scrollWheelZoom.disable();
        locationControl.remove();
        if (zoomPosition) map.zoomControl?.setPosition(zoomPosition);
        if (draft) draft.remove();
        picker?.existingMarker?.addTo(map);
        for (const layer of alternateLayers) layer.off(tileEvents);
        selectLayer(street);
        placeholder.replaceWith(container);
        controls.delete(map);
        dialog.remove();
        resize();
        map.fire('dormmap:collapsed');
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      }, { once: true });
      dialog.showModal();
      resize();
      requestAnimationFrame(() => {
        if (!dialog.open) return;
        resize();
        map.fire('dormmap:expanded');
      });
    }

    control.addTo(map);
    return open;
  };
  window.dormMapIsExpanded = map => controls.has(map);
  window.dormMapCloseExpanded = map => controls.get(map)?.close();

  window.dormMapReferencePins = async (leaflet, map) => {
    try {
      const response = await fetch('/api/boarding-houses');
      if (!response.ok) return;
      const houses = await response.json();
      if (!Array.isArray(houses)) return;
      for (const house of houses) {
        if (house.latitude == null || house.longitude == null || house.latitude === '' || house.longitude === '') continue;
        const point = [Number(house.latitude), Number(house.longitude)];
        if (!point.every(Number.isFinite)) continue;
        const label = document.createElement('span');
        label.textContent = house.boardingHouseName || 'Boarding house';
        leaflet.marker(point, { icon: window.dormMapPropertyPin(leaflet, house.registrationStatus === 'unregistered', house) })
          .bindTooltip(label).addTo(map);
      }
    } catch {
      // The owner can still select a location if public listings are unavailable.
    }
  };
})();
