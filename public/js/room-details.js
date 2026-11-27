(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const photoUrl = value => /^\/uploads\/[a-z0-9_.-]+$/i.test(value || '') ? value : '';
  const price = room => '₱' + Number(room.rentalPrice || 0).toLocaleString('en-PH') + '/mo';
  const status = room => room.status === 'maintenance' ? 'Maintenance' : room.availableSlots > 0 ? 'Available' : 'Full';

  function amenities(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* Older records store a plain text list. */ }
    return String(value).split(/[,\n]+/).map(item => item.trim()).filter(Boolean);
  }

  function metrics(room) {
    const count = Number(room.ratingCount || 0);
    const average = Number(room.ratingAverage || 0).toFixed(1);
    const available = Number(room.availableSlots || 0);
    const slots = room.rentalBasis === 'room' ? (available ? 'Whole room free' : 'Whole room unavailable')
      : `${available} ${room.rentalBasis === 'bed' ? (available === 1 ? 'bed' : 'beds') : (available === 1 ? 'slot' : 'slots')}`;
    return `<div class="room-card-badges">
      <span>${price(room)}</span><span>${slots}</span>
      <span class="room-rating-chip" aria-label="${count ? `${average} out of 5 from ${count} reviews` : 'No room ratings yet'}">
        <b aria-hidden="true">★</b> ${average} (${count})
      </span>
      <span class="${available ? 'room-card-available' : ''}">${status(room)}</span>
    </div>`;
  }

  function render(rooms = [], listing = {}, { open = false } = {}) {
    if (!rooms.length) return '<p class="text-sm text-slate-500">Detailed room inventory has not been added by this owner yet.</p>';
    const property = listing.name || listing.boardingHouseName || '';
    const address = [listing.address || listing.boardingHouseAddress, listing.barangay].filter(Boolean);
    const location = [...new Set(address)].join(' · ');
    const id = /^(?:bh|owner)-[1-9]\d*$/.test(listing.id || '') ? listing.id : '';
    const link = id && listing.latitude != null && listing.longitude != null ? '/?pin=' + encodeURIComponent(id) + '#map' : '';
    return `<details class="room-inventory-details room-cards" ${open ? 'open' : ''}>
      <summary>View property rooms <span class="room-cards-count">${rooms.length}</span></summary>
      <div class="room-card-list" data-paginate>
      ${rooms.map(room => {
        const roomTitle = `Room ${room.roomNumber}`;
        const photo = photoUrl(room.photo) || photoUrl(listing.picture || listing.boardingHousePicture);
        const addressText = location ? `<p class="room-card-address">${escape(location)}</p>` : '';
        const features = amenities(room.amenities || listing.amenities).slice(0, 4);
        const info = escape(JSON.stringify({ ...room, photo, property, listingId: id }));
        return `<article class="room-card">
          ${photo ? `<img src="${escape(photo)}" loading="lazy" alt="${escape(room.photo ? roomTitle : property || 'Property')}">` : ''}
          <div class="room-card-body">
            <div class="room-card-heading"><h3>${escape(roomTitle)}</h3><span>${Number(room.occupiedPeople || 0)}/${Number(room.capacity || 0)} pax</span></div>
            ${property ? `<p class="room-card-property">${escape(property)}</p>` : ''}
            ${addressText}${metrics(room)}
            ${features.length ? `<div class="room-card-badges room-card-amenities">${features.map(feature => `<span>${escape(feature)}</span>`).join('')}</div>` : ''}
            <div class="room-card-actions">
              ${link ? `<a href="${link}">Locate on map</a>` : ''}
              <button type="button" data-room-info="${info}">View room</button>
            </div>
          </div>
        </article>`;
      }).join('')}
      </div>
    </details>`;
  }

  function openRoom(room) {
    const dialog = document.createElement('dialog');
    dialog.className = 'room-review-dialog';
    dialog.setAttribute('aria-labelledby', 'publicRoomDialogTitle');
    const title = `Room ${room.roomNumber}`;
    const photo = photoUrl(room.photo);
    dialog.innerHTML = `
      <div class="room-card-heading">
        <div><h2 id="publicRoomDialogTitle">${escape(title)}</h2><p class="room-card-property">${escape(room.property || '')}</p></div>
        <form method="dialog"><button type="submit" autofocus>Close</button></form>
      </div>
      ${photo ? `<img class="room-review-photo" src="${escape(photo)}" alt="" loading="lazy">` : ''}
      <p>${[room.floor, room.roomType, room.rentalBasis ? 'Per ' + room.rentalBasis : ''].filter(Boolean).map(escape).join(' · ')}</p>
      ${metrics(room)}
      <p>${Number(room.occupiedPeople || 0)} / ${Number(room.capacity || 0)} people · ${Number(room.reservedForTenants || 0)} reserved · ${Number(room.unavailableReported || 0)} marked unavailable</p>
      ${room.description ? `<p class="room-review-text">${escape(room.description)}</p>` : ''}
      <h3>Tenant feedback</h3><div data-room-feedback aria-live="polite"></div>
    `;
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();

    const output = dialog.querySelector('[data-room-feedback]');
    async function load(page = 1) {
      output.textContent = 'Loading feedback…';
      try {
        const response = await fetch('/api/boarding-houses/' + encodeURIComponent(room.listingId) + '/rooms/' +
          encodeURIComponent(room.id) + '/reviews?page=' + page);
        if (!response.ok) throw new Error('Feedback is unavailable for this room.');
        const { data, pages } = await response.json();
        output.innerHTML = data.map(review => `
          <article class="room-review-entry"><b>${Number(review.rating)} / 5 ★</b>
            <p class="room-review-text">${escape(review.comment)}</p></article>`
        ).join('') || '<p>No written feedback yet.</p>';
        if (pages > 1) {
          const nav = document.createElement('nav');
          nav.className = 'portal-pagination';
          nav.setAttribute('aria-label', 'Feedback pages');
          for (const [label, target] of [['Previous', page - 1], ['Next', page + 1]]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.disabled = target < 1 || target > pages;
            button.onclick = () => load(target);
            if (label === 'Next') nav.append(`Page ${page} of ${pages}`);
            nav.append(button);
          }
          output.append(nav);
        }
      } catch (error) { output.textContent = error.message; }
    }
    if (room.listingId && room.ratingCount) load();
    else output.textContent = 'No written feedback yet.';
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-room-info]');
    if (button) openRoom(JSON.parse(button.dataset.roomInfo));
  });

  globalThis.DormRoomDetails = { render };
})();
