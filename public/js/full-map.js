(() => {
  const key = document.querySelector('meta[name="dormmap-maptiler-key"]')?.content;
  const controls = new WeakMap();

  window.dormMapFullMap = (leaflet, map, street, picker) => {
    const container = map.getContainer();
    const publicSatellite = leaflet.tileLayer(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
      { maxNativeZoom: 14, maxZoom: 19, attribution: '<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)' }
    );
    const mapTilerSatellite = key ? leaflet.tileLayer(
      `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
      { maxZoom: 19, attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a>' }
    ) : null;
    const satellite = mapTilerSatellite || publicSatellite;
    let activeLayer = street;
    const control = leaflet.control({ position: 'topright' });
    control.onAdd = () => {
      const button = leaflet.DomUtil.create('button', 'dormmap-expand-map');
      button.type = 'button';
      button.textContent = 'Open Full Map';
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
        <button type="button" data-satellite>Satellite</button></div>
        <button type="button" data-close>${picker ? 'Cancel' : 'Close'}</button>
      </div><p class="dormmap-map-status" role="status"></p><div class="dormmap-map-stage"></div>
      ${picker ? '<div class="dormmap-map-toolbar"><button type="button" data-use disabled>Use this location</button></div>' : ''}`;
      const status = dialog.querySelector('[role="status"]');
      const stage = dialog.querySelector('.dormmap-map-stage');
      const streetButton = dialog.querySelector('[data-street]');
      const satelliteButton = dialog.querySelector('[data-satellite]');
      const use = dialog.querySelector('[data-use]');
      const placeholder = document.createComment('DormMap map position');
      container.before(placeholder);
      stage.append(container);
      document.body.append(dialog);
      controls.set(map, dialog);

      let loadedTiles = 0;
      let failedTiles = 0;
      const satelliteLayers = [mapTilerSatellite, publicSatellite].filter(Boolean);
      const startTiles = () => { loadedTiles = failedTiles = 0; };
      const tileLoaded = () => { loadedTiles++; };
      const tileFailed = () => { failedTiles++; };

      function selectLayer(layer) {
        streetButton.setAttribute('aria-pressed', String(layer === street));
        satelliteButton.setAttribute('aria-pressed', String(layer !== street));
        if (layer === activeLayer) return;
        map.removeLayer(activeLayer);
        activeLayer = layer;
        startTiles();
        map.addLayer(layer);
      }

      function satelliteFinished(event) {
        if (event.target !== activeLayer || !failedTiles || loadedTiles) return;
        if (activeLayer === mapTilerSatellite) {
          selectLayer(publicSatellite);
        } else {
          selectLayer(street);
          status.textContent = 'Satellite imagery could not load. Street view is available.';
        }
      }

      const tileEvents = { loading: startTiles, tileload: tileLoaded, tileerror: tileFailed, load: satelliteFinished };
      for (const layer of satelliteLayers) layer.on(tileEvents);
      function changeLayer(layer) {
        if (!picker) status.textContent = '';
        else if (draft) updateDraft(draft.getLatLng());
        else status.textContent = 'Tap the map to drop a pin, then drag it to adjust.';
        selectLayer(layer);
      }
      streetButton.onclick = () => changeLayer(street);
      satelliteButton.onclick = () => changeLayer(satellite);
      selectLayer(activeLayer);
      const resize = () => map.invalidateSize({ animate: false });

      let draft;
      function updateDraft(point) {
        if (!draft) {
          draft = leaflet.marker(point, { draggable: true, icon: window.dormMapPropertyPin(leaflet), zIndexOffset: 1000, title: 'Draft property location' }).addTo(map);
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
        if (draft) draft.remove();
        picker?.existingMarker?.addTo(map);
        for (const layer of satelliteLayers) layer.off(tileEvents);
        selectLayer(street);
        placeholder.replaceWith(container);
        controls.delete(map);
        dialog.remove();
        resize();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      }, { once: true });
      dialog.showModal();
      resize();
      map.fire('dormmap:expanded');
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
        leaflet.marker(point, { icon: window.dormMapPropertyPin(leaflet, house.registrationStatus === 'unregistered') })
          .bindTooltip(label).addTo(map);
      }
    } catch {
      // The owner can still select a location if public listings are unavailable.
    }
  };
})();
