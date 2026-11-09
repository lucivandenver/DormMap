(() => {
  const key = document.querySelector('meta[name="dormmap-maptiler-key"]')?.content;
  const controls = new WeakMap();

  window.dormMapFullMap = (leaflet, map, street, picker) => {
    const container = map.getContainer();
    const satellite = key ? leaflet.tileLayer(
      `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
      { maxZoom: 19, attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a>' }
    ) : null;
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

      function selectLayer(layer) {
        if (layer !== activeLayer) {
          map.removeLayer(activeLayer);
          activeLayer = layer;
          map.addLayer(layer);
        }
        streetButton.setAttribute('aria-pressed', String(layer === street));
        satelliteButton.setAttribute('aria-pressed', String(layer === satellite));
      }
      function satelliteError() {
        if (activeLayer !== satellite) return;
        selectLayer(street);
        status.textContent = 'Satellite imagery could not load. Check the map key and allowed website domains. Street view is available.';
      }
      satellite?.on('tileerror', satelliteError);
      streetButton.onclick = () => selectLayer(street);
      satelliteButton.onclick = () => {
        if (!satellite) {
          status.textContent = 'Satellite is not configured. Street view is available.';
          return;
        }
        selectLayer(satellite);
      };
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
        satellite?.off('tileerror', satelliteError);
        placeholder.replaceWith(container);
        controls.delete(map);
        dialog.remove();
        resize();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      }, { once: true });
      dialog.showModal();
      requestAnimationFrame(resize);
    }

    control.addTo(map);
    return open;
  };
  window.dormMapIsExpanded = map => controls.has(map);

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
