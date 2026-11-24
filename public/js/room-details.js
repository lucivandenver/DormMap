(() => {
 const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(rooms = []) {
   if (!rooms.length) return '<p class="text-xs text-slate-500">Detailed room inventory has not been added by this owner yet.</p>';
   const beds = rooms.filter(room=>room.rentalBasis==='bed').reduce((sum,room)=>sum+Number(room.availableSlots || 0),0);
   const personSlots = rooms.filter(room=>room.rentalBasis==='person').reduce((sum,room)=>sum+Number(room.availableSlots || 0),0);
   const whole = rooms.filter(room=>room.rentalBasis==='room' && room.availableSlots>0).length;
   const reserved = rooms.reduce((sum, room) => sum + Number(room.reservedForTenants || 0), 0);
   const reservationLabel = room => Number(room.reservedForTenants || 0) === 0 ? '' : room.rentalBasis === 'room' ? 'Whole room reserved'
     : `${Number(room.reservedForTenants)} ${room.rentalBasis === 'bed' ? 'bedspace(s)' : 'slot(s)'} reserved`;
   return `<details class="room-inventory-details"><summary>${rooms.length} rooms · ${beds} bedspaces free · ${personSlots} person slots free · ${whole} whole rooms available${reserved ? ` · ${reserved} reserved` : ''}</summary><p class="text-xs text-slate-500 my-2">Availability reflects assigned occupants, confirmed reservations, and slots marked unavailable by the owner.</p><div class="room-inventory-scroll" tabindex="0" aria-label="Room availability table"><table><thead><tr><th>Floor / room</th><th>Type / beds</th><th>Occupancy</th><th>Availability</th><th>Monthly rate</th></tr></thead><tbody>${rooms.map(room=>`<tr><td>${escape(room.floor)}<br><b>${escape(room.roomNumber)}</b></td><td>${escape(room.roomType)}<br>${room.bedCount == null ? 'Beds not specified' : Number(room.bedCount)+' beds'}</td><td>${Number(room.occupiedPeople || 0)} assigned people / ${Number(room.capacity)} capacity${room.occupiedBeds == null ? '' : '<br>'+Number(room.occupiedBeds)+' assigned beds'}<br>${Number(room.unavailableReported || 0)} owner-reported unavailable</td><td>${room.status === 'maintenance' ? 'Maintenance' : room.rentalBasis==='room' ? room.availableSlots>0 ? 'Whole room available' : 'Room unavailable' : Number(room.availableSlots)+' '+(room.rentalBasis==='bed'?'beds':'slots')+' available'}${reservationLabel(room) ? `<br><strong>${reservationLabel(room)}</strong>` : ''}</td><td>₱${Number(room.rentalPrice).toLocaleString('en-PH')} / ${escape(room.rentalBasis || 'person')}<br>${escape(room.genderPref || 'Any')} occupancy</td></tr>`).join('')}</tbody></table></div></details>`;
 }
 globalThis.DormRoomDetails = { render };
})();
