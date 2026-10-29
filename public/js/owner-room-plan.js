(() => {
  const types = ['Bedspace','Solo Room','Shared Room','Studio','Family Room','Apartment Room'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  function initialize(root) {
    if (root.dataset.ready) return; root.dataset.ready = 'true';
    const form = root.closest('form'); if (!form) return;
    const rows = root.querySelector('[data-room-rows]');
    const floorCount = root.querySelector('[name="floorCount"]');
    const label = (text, field) => `<label>${text}${field}</label>`;
    function addRoom(previous = {}) {
      if (rows.children.length >= 100) return;
      const row = document.createElement('fieldset'); row.className = 'room-plan-row';
      row.innerHTML = `<legend>Room ${rows.children.length+1}</legend><div class="room-plan-grid">
      ${label('Room number', `<input data-field="roomNumber" required maxlength="40" value="${escape(previous.roomNumber || String(rows.children.length+1).padStart(3,'0'))}">`)}
      ${label('Floor', `<input data-field="floor" type="number" min="1" max="50" value="${escape(previous.floor || 1)}" required>`)}
      ${label('Room type', `<select data-field="roomType">${types.map(type => `<option ${type === (previous.roomType || 'Solo Room') ? 'selected' : ''}>${type}</option>`).join('')}</select>`)}
      ${label('Occupant capacity', `<input data-field="capacity" type="number" min="1" max="100" value="${escape(previous.capacity || 1)}" required>`)}
      ${label('Physical beds', `<input data-field="bedCount" type="number" min="1" max="100" value="${escape(previous.bedCount || 1)}" required>`)}
      ${label('Price basis', `<select data-field="rentalBasis"><option value="room">Whole room</option><option value="bed">Per bed</option><option value="person">Per person</option></select>`)}
      ${label('Monthly price (₱)', `<input data-field="rentalPrice" type="number" min="0.01" step="0.01" max="99999999.99" value="${escape(previous.rentalPrice || '')}" required>`)}
      ${label('Currently unavailable slots', `<input data-field="unavailable" type="number" min="0" max="100" value="${escape(previous.unavailable || 0)}" required>`)}</div>
      <button type="button" data-room-remove aria-label="Remove this room">Remove room</button>`;
      rows.append(row); row.querySelector('[data-field="rentalBasis"]').value = previous.rentalBasis || 'room';
      row.addEventListener('change', event => {
        const type = row.querySelector('[data-field="roomType"]').value;
        if (event.target.dataset.field === 'roomType') {
          row.querySelector('[data-field="rentalBasis"]').value = type === 'Bedspace' ? 'bed' : type === 'Shared Room' ? 'person' : 'room';
          if (type === 'Solo Room') { row.querySelector('[data-field="capacity"]').value = 1; row.querySelector('[data-field="bedCount"]').value = 1; }
        }
        if (type === 'Bedspace' && ['capacity','roomType'].includes(event.target.dataset.field)) row.querySelector('[data-field="bedCount"]').value = row.querySelector('[data-field="capacity"]').value;
        serialize();
      });
      row.querySelector('[data-room-remove]').addEventListener('click', () => { row.remove(); serialize(); });
      row.addEventListener('input', serialize);
      if (root.closest('[data-register-section]')?.classList.contains('hidden')) row.querySelectorAll('input,select').forEach(input => { input.dataset.wasRequired = String(input.required); input.required = false; input.disabled = true; });
      serialize();
    }
    function values() { return [...rows.children].map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field,input.value]))); }
    function serialize() {
      const data = values(); root.querySelector('[name="roomPlan"]').value = JSON.stringify(data);
      let capacity = 0, available = 0, availableRooms = 0, freeBeds = 0, wholeRooms = 0;
      data.forEach(room => { capacity += Number(room.capacity || 0); const slots = room.rentalBasis === 'room' && Number(room.unavailable)>0 ? 0 : Math.max(0,Number(room.capacity || 0)-Number(room.unavailable || 0)); available += slots; if (slots) availableRooms++; if (room.rentalBasis === 'bed') freeBeds+=slots; if (room.rentalBasis === 'room' && slots)wholeRooms++; });
      const counter = form.querySelector('[name="roomsAvailable"]'); if (counter) { counter.value = availableRooms; counter.readOnly = true; counter.min = '0'; }
      root.querySelector('[data-room-summary]').textContent = `${data.length} rooms · ${capacity} total occupant capacity · ${freeBeds} bedspaces free · ${wholeRooms} whole rooms available · ${availableRooms} rooms with space`;
      for (const row of rows.children) row.querySelector('[data-field="floor"]').max = floorCount.value || '1';
      return data;
    }
    root.validate = () => {
      const data = serialize(), error = root.querySelector('[data-room-error]'); error.textContent = '';
      if (!data.length) { error.textContent = 'Add at least one actual room.'; root.scrollIntoView({block:'center'}); return false; }
      const seen = new Set();
      for (const row of rows.children) {
        for (const input of row.querySelectorAll('input')) if (!input.checkValidity()) { input.reportValidity(); return false; }
        const entry = Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field,input.value]));
        const key = entry.floor + ':' + entry.roomNumber.trim().toLowerCase();
        if (seen.has(key) || Number(entry.unavailable)>Number(entry.capacity) || (entry.roomType === 'Solo Room' && Number(entry.capacity)!==1) || (entry.roomType === 'Bedspace' && (Number(entry.bedCount)!==Number(entry.capacity) || entry.rentalBasis!=='bed'))) { error.textContent = 'Check duplicate room numbers on a floor, capacity, unavailable slots, and bedspace pricing.'; row.scrollIntoView({block:'center'}); return false; }
        seen.add(key);
      }
      return true;
    };
    root.querySelector('[data-room-add]').addEventListener('click', () => addRoom());
    root.querySelector('[data-room-generate]').addEventListener('click', () => { const count = Math.max(1,Math.min(25,Number(root.querySelector('[data-generate-count]').value)||1)); const previous = values().at(-1) || {}; for(let i=0;i<count;i++) addRoom({...previous,roomNumber:String(rows.children.length+1).padStart(3,'0')}); });
    floorCount.addEventListener('input', serialize);
    form.addEventListener('submit', event => { if (!root.closest('[data-register-section]')?.classList.contains('hidden') && !root.validate()) event.preventDefault(); });
    if (root.dataset.initialFloors) floorCount.value = root.dataset.initialFloors;
    if (root.dataset.initialType) root.querySelector('[name="propertyType"]').value = root.dataset.initialType;
    if (root.dataset.initialAddress) root.querySelector('[name="streetAddress"]').value = root.dataset.initialAddress;
    let previous; try { previous = JSON.parse(root.dataset.initialPlan || '[]'); } catch {}
    if (Array.isArray(previous) && previous.length) previous.slice(0,100).filter(row=>row && typeof row==='object').forEach(addRoom); else addRoom();
  }
  function boot() { document.querySelectorAll('[data-room-plan]').forEach(initialize); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
