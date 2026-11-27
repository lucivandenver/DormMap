(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
  const availableSlots = room => Number(room.availableSlots || 0);
  const reservedSlots = room => Number(room.reservedForTenants || 0);

  function availability(room) {
    const basis = room.rentalBasis;
    let label;
    if (room.status === 'maintenance') label = 'Maintenance';
    else if (basis === 'room') label = availableSlots(room) > 0 ? 'Whole room available' : 'Room unavailable';
    else label = `${availableSlots(room)} ${basis === 'bed' ? 'beds' : 'slots'} available`;

    const reserved = reservedSlots(room);
    if (!reserved) return label;
    const reservation = basis === 'room'
      ? 'Whole room reserved'
      : `${reserved} ${basis === 'bed' ? 'bedspace(s)' : 'slot(s)'} reserved`;
    return `${label}<br><strong>${reservation}</strong>`;
  }

  function renderRow(room) {
    const beds = room.bedCount == null ? 'Beds not specified' : `${Number(room.bedCount)} beds`;
    const assignedBeds = room.occupiedBeds == null ? '' : `<br>${Number(room.occupiedBeds)} assigned beds`;
    const rate = Number(room.rentalPrice).toLocaleString('en-PH');
    return `<tr>
      <td>${escape(room.floor)}<br><b>${escape(room.roomNumber)}</b></td>
      <td>${escape(room.roomType)}<br>${beds}</td>
      <td>${Number(room.occupiedPeople || 0)} assigned people / ${Number(room.capacity)} capacity
        ${assignedBeds}<br>${Number(room.unavailableReported || 0)} owner-reported unavailable</td>
      <td>${availability(room)}</td>
      <td>₱${rate} / ${escape(room.rentalBasis || 'person')}<br>${escape(room.genderPref || 'Any')} occupancy</td>
    </tr>`;
  }

  function render(rooms = []) {
    if (!rooms.length) return '<p class="text-xs text-slate-500">Detailed room inventory has not been added by this owner yet.</p>';
    const slotsFor = basis => rooms.filter(room => room.rentalBasis === basis)
      .reduce((sum, room) => sum + availableSlots(room), 0);
    const whole = rooms.filter(room => room.rentalBasis === 'room' && availableSlots(room) > 0).length;
    const reserved = rooms.reduce((sum, room) => sum + reservedSlots(room), 0);
    return `<details class="room-inventory-details">
      <summary>${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · ${slotsFor('bed')} bedspaces free · ${slotsFor('person')} person slots free · ${whole} whole rooms available${reserved ? ` · ${reserved} reserved` : ''}</summary>
      <p class="my-2 text-xs text-slate-500">Availability reflects assigned occupants, confirmed reservations, and slots marked unavailable by the owner.</p>
      <div class="room-inventory-scroll" tabindex="0" aria-label="Room availability table">
        <table>
          <thead><tr><th>Floor / room</th><th>Type / beds</th><th>Occupancy</th><th>Availability</th><th>Monthly rate</th></tr></thead>
          <tbody data-paginate>${rooms.map(renderRow).join('')}</tbody>
        </table>
      </div>
    </details>`;
  }

  window.DormRoomDetails = { render };
})();
