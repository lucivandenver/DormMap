(function () {
  'use strict';
  let listings = [];
  const selected = new Set();
  const saving = new Set();
  let map = null;
  let markerLayer = null;
  let currentMapListings = [];
  const markers = new Map();
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ratingMarkup = item => {
    const average = Number(item.ratingAverage || 0), count = Number(item.ratingCount || 0);
    const rounded = Math.max(0, Math.min(5, Math.round(average)));
    return `<span class="inline-flex flex-wrap items-center gap-x-2" role="img" aria-label="${escapeHtml(count ? `${average.toFixed(1)} out of 5 from ${count} tenant ratings` : 'No tenant ratings yet')}"><span aria-hidden="true" class="text-amber-400 tracking-wide">${'★'.repeat(rounded)}<span class="text-slate-300">${'☆'.repeat(5-rounded)}</span></span><span class="text-xs font-semibold text-slate-600">${count ? `${average.toFixed(1)} · ${count} ${count === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'}</span></span>`;
  };
  const money = value => value === null || value === undefined ? 'Ask owner' : `₱${Number(value).toLocaleString('en-PH')}`;
  const rate = item => item.rentalPriceMin === null ? 'Ask owner for price' : `${money(item.rentalPriceMin)}${item.rentalPriceMax !== null && item.rentalPriceMax !== item.rentalPriceMin ? ` – ${money(item.rentalPriceMax)}` : ''} / month`;
  const safeImage = value => {
    if (typeof value !== 'string') return '';
    if (value.startsWith('/uploads/') || value.startsWith('/images/')) return value;
    try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
  };
  const title = item => [item.propertyName || item.name, item.branchNumber ? `Branch ${item.branchNumber}` : ''].filter(Boolean).join(' · ');
  const hasLocation = item => item.latitude !== null && item.longitude !== null && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude));
  const activeApplication = item => item.application && ['pending_owner', 'accepted_by_owner', 'confirmed'].includes(item.application.status);
  function status(message, error = false) {
    el('browseStatus').textContent = message;
    el('browseStatus').style.color = error ? '#be123c' : '#475569';
  }

  async function loadBrowseBoardingHouses() {
    status('Loading current dorm listings…');
    try {
      // Load the full visible catalog so changing a filter never loses saved cards.
      const response = await fetch('/tenant-dashboard/api/browse-boarding-houses', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load boarding houses.');
      listings = data.boardingHouses || [];
      for (const key of selected) if (!listings.some(item => item.id === key)) selected.delete(key);
      filterBrowseListings();
    } catch (error) {
      status(error.message || 'Connection failed. Please try Refresh Dorms.', true);
    }
  }

  function filterBrowseListings() {
    const search = (el('browseSearchInput').value || '').trim().toLowerCase();
    const barangay = el('browseBarangayFilter').value;
    const rawBudget = el('browseMaxBudget').value;
    const budget = rawBudget === '' ? null : Number(rawBudget);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
      status('Enter a valid maximum monthly budget.', true);
      return;
    }
    const filtered = listings.filter(item =>
      (!search || [item.name, item.propertyName, item.ownerName, item.address, item.barangay].some(value => String(value || '').toLowerCase().includes(search))) &&
      (barangay === 'all' || item.barangay === barangay) &&
      (!el('browseSavedOnly').checked || item.isSaved) &&
      (!el('browseAvailableOnly').checked || item.roomsAvailable > 0) &&
      (budget === null || (item.rentalPriceMin !== null && item.rentalPriceMin <= budget))
    );
    filtered.sort(el('browseSort').value === 'price_asc'
      ? (a, b) => (a.rentalPriceMin ?? Infinity) - (b.rentalPriceMin ?? Infinity) || a.name.localeCompare(b.name)
      : (a, b) => a.name.localeCompare(b.name));
    renderGrid(filtered);
    renderMap(filtered);
    updateComparison();
    const savedCount = listings.filter(item => item.isSaved).length;
    el('browseSavedCount').textContent = savedCount;
    status(`${filtered.length} dorm${filtered.length === 1 ? '' : 's'} found. ${savedCount} saved to your account.`);
  }

  function renderGrid(items) {
    const grid = el('browseDormsGrid');
    grid.innerHTML = items.length ? items.map(item => {
      const key = escapeHtml(item.id);
      const picture = safeImage(item.picture);
      const application = activeApplication(item);
      return `<article class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" data-dorm="${key}">
        <div class="relative h-36 bg-emerald-50 flex items-center justify-center overflow-hidden">
          ${picture ? `<img src="${escapeHtml(picture)}" alt="${escapeHtml(title(item))}" loading="lazy" class="w-full h-full object-cover">` : '<span class="text-emerald-800 font-bold text-sm">DormMap</span>'}
          <span class="absolute top-2 right-2 bg-white rounded-full px-2 py-1 text-xs font-bold">${Number(item.roomsAvailable)} ${Number(item.roomsAvailable) === 1 ? 'room' : 'rooms'} available</span>
        </div>
        <div class="p-4 space-y-3">
          <div><h4 class="font-bold text-slate-900">${escapeHtml(title(item))}</h4><p class="text-xs text-slate-500">${escapeHtml(item.address || item.barangay || 'Address not provided')}</p></div>
          ${ratingMarkup(item)}
          <p class="text-emerald-800 font-bold text-xs">${escapeHtml(rate(item))}<br><span class="font-normal">${escapeHtml(item.pricingLabel || 'Confirm price basis')}</span></p>
          <p class="text-xs text-slate-500">${escapeHtml(item.ownerName)} · ${escapeHtml(item.barangay)}</p>
          <p class="text-xs text-slate-600">${escapeHtml(item.propertyType)} · ${item.floorCount || 'Unspecified'} floors · ${Number(item.availableBeds || 0)} bedspaces available</p>
          ${window.DormRoomDetails?.render(item.roomInventory, item) || ''}
          ${application ? `<p class="text-xs font-semibold text-emerald-800">Application: ${escapeHtml(item.application.status.replace(/_/g, ' '))}</p>` : ''}
          <div class="flex gap-2 flex-wrap">
            <button type="button" data-action="save" aria-pressed="${item.isSaved}" ${saving.has(item.id) ? 'disabled' : ''} class="px-3 py-2 rounded-xl border border-emerald-800 text-emerald-900 text-xs font-bold">${saving.has(item.id) ? 'Saving…' : item.isSaved ? '♥ Saved' : '♡ Save dorm'}</button>
            <label class="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" data-action="compare" ${selected.has(item.id) ? 'checked' : ''}> Compare<span class="sr-only"> ${escapeHtml(title(item))}</span></label>
          </div>
          <div class="flex gap-2 flex-wrap">
            ${item.branchGalleries?.some(branch => branch.photos.length) ? '<button type="button" data-action="photos" class="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold">View photos</button>' : ''}
            <button type="button" data-action="map" ${hasLocation(item) && typeof window.L !== 'undefined' ? '' : 'disabled'} class="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold">${!hasLocation(item) ? 'No map pin' : typeof window.L === 'undefined' ? 'Map unavailable' : 'Map'}</button>
            <button type="button" data-action="${application ? 'message' : 'apply'}" class="flex-1 px-3 py-2 bg-emerald-950 text-white rounded-xl text-xs font-bold">${application ? 'Message owner' : 'Inquire & Apply'}</button>
            ${application && item.application.status === 'pending_owner' && !item.application.hasReservation && item.establishmentId && item.availableRooms?.length ? '<button type="button" data-action="reserve" class="px-3 py-2 rounded-xl border border-emerald-700 text-xs font-bold text-emerald-800">Request reservation</button>' : ''}
          </div>
        </div>
      </article>`;
    }).join('') : '<p class="col-span-full text-sm text-slate-500 py-8 text-center">No dorms match these filters. Try clearing a filter or saving a dorm first.</p>';
  }

  function showBranchGallery(item) {
    const slides = window.DormBranchGallery.slidesFor(item).filter(slide => safeImage(slide.url));
    const dialog = el('tenantBranchGallery');
    const photo = el('tenantBranchGalleryPhoto');
    const unavailable = el('tenantBranchGalleryUnavailable');
    let index = 0;
    function render() {
      const slide = slides[index];
      photo.hidden = false;
      unavailable.hidden = true;
      photo.src = slide.url;
      photo.alt = slide.caption;
      el('tenantBranchGalleryCaption').textContent = slide.caption;
      el('tenantBranchGalleryCount').textContent = `${index + 1} / ${slides.length}`;
      el('tenantBranchGalleryPrev').disabled = index === 0;
      el('tenantBranchGalleryNext').disabled = index === slides.length - 1;
    }
    photo.onerror = () => { photo.hidden = true; unavailable.hidden = false; };
    el('tenantBranchGalleryTitle').textContent = title(item);
    el('tenantBranchGalleryAddress').textContent = window.dormMapListingLocation(item);
    el('tenantBranchGalleryRating').innerHTML = ratingMarkup(item);
    el('tenantBranchGalleryPrev').onclick = () => { index--; render(); };
    el('tenantBranchGalleryNext').onclick = () => { index++; render(); };
    if (slides.length) render();
    else {
      photo.hidden = true;
      photo.removeAttribute('src');
      unavailable.hidden = false;
      el('tenantBranchGalleryCaption').textContent = '';
      el('tenantBranchGalleryCount').textContent = '';
      el('tenantBranchGalleryPrev').disabled = true;
      el('tenantBranchGalleryNext').disabled = true;
    }
    dialog.showModal();
  }

  function inquire(item, reservationOnly = false) { window.openInquiryModal(item, reservationOnly); }

  function renderMap(items) {
    const located = items.filter(hasLocation);
    currentMapListings = located;
    el('browseMapCount').textContent = `${located.length} map pins · ${items.length - located.length} without a pin`;
    if (typeof window.L === 'undefined') {
      el('browseMapCount').textContent = 'Map could not load. You can still browse the cards.';
      return;
    }
    if (!map) {
      map = window.L.map('tenantBrowseMap').setView([12.7192, 121.4719], 13);
      dormMapFullMap(window.L, map, window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map), null, {
        getListings: () => currentMapListings,
        onSelect: item => {
          map.setView([item.latitude, item.longitude], 17);
          markers.get(item.id)?.openPopup();
        },
        onDetails: showBranchGallery,
        onDirections: item => {
          window.open(`https://www.openstreetmap.org/directions?to=${Number(item.latitude)},${Number(item.longitude)}`, '_blank', 'noopener');
        }
      });
      markerLayer = window.L.layerGroup().addTo(map);
      map.on('dormmap:expanded', () => {
        if (!currentMapListings.length) return;
        const desktop = map.getContainer().clientWidth > 700;
        map.fitBounds(currentMapListings.map(item => [item.latitude, item.longitude]), {
          paddingTopLeft: desktop ? [380, 40] : [25, 40],
          paddingBottomRight: desktop ? [40, 40] : [25, map.getContainer().clientHeight * .32],
          maxZoom: 16, animate: false
        });
      });
    }
    markerLayer.clearLayers();
    markers.clear();
    located.forEach(item => {
      const popup = window.dormMapListingPopup(item, {
        onDetails: () => showBranchGallery(item)
      });
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = activeApplication(item) ? 'Message owner' : 'Inquire & Apply';
      button.addEventListener('click', () => {
        window.dormMapCloseExpanded(map);
        activeApplication(item) ? window.openConversationWith(item.ownerId) : inquire(item);
      });
      popup.querySelector('.dormmap-listing-actions').append(button);
      const marker = window.L.marker([item.latitude, item.longitude], {
        icon: window.dormMapPropertyPin(window.L, item.registrationStatus === 'unregistered', item),
        title: title(item)
      }).addTo(markerLayer).bindPopup(popup, { className: 'dormmap-listing-pin-popup' });
      marker.on('popupopen', () => {
        window.dormMapRefreshListingDistance(window.L, popup, item);
        map.fire('dormmap:listing-selected', { id: item.id });
      });
      markers.set(item.id, marker);
    });
    map.fire('dormmap:listings-updated');
    map.invalidateSize();
    if (located.length) map.fitBounds(located.map(item => [item.latitude, item.longitude]), { padding: [25, 25], maxZoom: 15 });
  }

  async function toggleSave(item) {
    if (saving.has(item.id)) return;
    saving.add(item.id);
    filterBrowseListings();
    try {
      const response = await fetch(`/tenant-dashboard/api/saved-dorms/${encodeURIComponent(item.id)}`, { method: item.isSaved ? 'DELETE' : 'PUT', headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save this dorm.');
      item.isSaved = data.isSaved;
      saving.delete(item.id);
      filterBrowseListings();
    } catch (error) {
      saving.delete(item.id);
      filterBrowseListings();
      status(error.message || 'Connection failed. Your saved dorms were not changed.', true);
    }
  }

  function updateComparison() {
    el('browseCompareButton').textContent = `Compare (${selected.size}/3)`;
    el('browseCompareButton').disabled = selected.size < 2;
    el('browseComparisonHint').textContent = selected.size
      ? `Selected: ${listings.filter(item => selected.has(item.id)).map(item => item.name).join(', ')}`
      : 'Select two or three dorms to compare rent, rooms, amenities, and house rules.';
  }

  function plainList(value) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.join(', ') : String(value || 'Not provided'); }
    catch { return String(value || 'Not provided'); }
  }

  function showComparison() {
    const items = listings.filter(item => selected.has(item.id));
    if (items.length < 2) return;
    const rows = [
      ['Monthly rent', item => rate(item)], ['Barangay', item => item.barangay || 'Not provided'],
      ['Address', item => item.address || 'Not provided'], ['Available rooms', item => item.roomsAvailable],
      ['Available slots', item => item.availableSlots], ['Amenities', item => plainList(item.amenities)],
      ['House rules', item => plainList(item.houseRules)], ['Owner', item => item.ownerName],
      ['Contact', item => item.ownerContact || 'Not provided'],
    ];
    el('dormCompareTable').innerHTML = `<thead><tr><th scope="col">Details</th>${items.map(item => `<th scope="col">${escapeHtml(title(item))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${label}</th>${items.map(item => `<td>${escapeHtml(value(item))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    el('dormCompareDialog').showModal();
  }

  el('browseDormsGrid').addEventListener('click', event => {
    const control = event.target.closest('[data-action]');
    if (!control || control.dataset.action === 'compare') return;
    const item = listings.find(dorm => dorm.id === control.closest('[data-dorm]').dataset.dorm);
    if (!item) return;
    if (control.dataset.action === 'photos') showBranchGallery(item);
    if (control.dataset.action === 'save') toggleSave(item);
    if (control.dataset.action === 'apply') inquire(item);
    if (control.dataset.action === 'reserve') inquire(item, true);
    if (control.dataset.action === 'message') window.openConversationWith(item.ownerId);
    if (control.dataset.action === 'map') {
      const marker = markers.get(item.id);
      if (marker && map) {
        map.setView(marker.getLatLng(), 16);
        marker.openPopup();
        el('tenantBrowseMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });
  el('browseDormsGrid').addEventListener('change', event => {
    const control = event.target;
    if (control.dataset.action !== 'compare') return;
    const key = control.closest('[data-dorm]').dataset.dorm;
    if (control.checked && selected.size >= 3) {
      control.checked = false;
      status('You can compare up to three dorms. Uncheck one to choose another.', true);
      return;
    }
    if (control.checked) selected.add(key); else selected.delete(key);
    updateComparison();
  });
  el('browseCompareButton').addEventListener('click', showComparison);
  el('browseClearComparison').addEventListener('click', () => { selected.clear(); filterBrowseListings(); });
  el('browseResetFilters').addEventListener('click', () => {
    el('browseSearchInput').value = '';
    el('browseBarangayFilter').value = 'all';
    el('browseMaxBudget').value = '';
    el('browseSort').value = 'name';
    el('browseSavedOnly').checked = false;
    el('browseAvailableOnly').checked = false;
    filterBrowseListings();
  });
  window.loadBrowseBoardingHouses = loadBrowseBoardingHouses;
  window.filterBrowseListings = filterBrowseListings;
})();
