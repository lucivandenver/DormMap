function setupFloors(property) {
  const count = property.querySelector('[data-floor-count]');
  const layout = property.querySelector('[data-floor-layout]');
  const rows = property.querySelector('[data-floor-rows]');
  const total = property.querySelector('[data-total-rooms]');
  let restored = [];
  try { restored = JSON.parse(layout.value || '[]'); } catch {}
  if (!Array.isArray(restored)) restored = [];

  function update() {
    const floors = count.validity.valid ? Number(count.value) : 0;
    for (let floor = rows.children.length + 1; floor <= floors; floor++) {
      const row = document.createElement('label');
      row.className = 'owner-count-grid';
      row.innerHTML = `<span>Floor ${floor}</span><input type="number" aria-label="Rooms on floor ${floor}" placeholder="Rooms" min="0" max="100" required>`;
      row.lastElementChild.value = restored[floor - 1] ?? '';
      rows.append(row);
    }
    const counts = [];
    Array.from(rows.children).forEach((row, index) => {
      row.hidden = index >= floors;
      row.style.display = row.hidden ? 'none' : '';
      const input = row.lastElementChild;
      input.disabled = row.hidden;
      input.setCustomValidity('');
      if (!row.hidden) counts.push(input.value === '' ? null : Number(input.value));
    });
    const rooms = counts.reduce((sum, value) => sum + (value ?? 0), 0);
    if (counts.length && counts.every(value => value !== null) && (rooms < 1 || rooms > 100)) {
      rows.firstElementChild.lastElementChild.setCustomValidity('Set between 1 and 100 total rooms for this branch.');
    }
    layout.value = JSON.stringify(counts);
    total.textContent = floors ? `Total rooms: ${rooms}` : '';
  }
  count.addEventListener('input', update);
  rows.addEventListener('input', update);
  update();
}

document.querySelectorAll('[data-owner-counts]').forEach(section => {
  const count = section.querySelector('[name="declaredBranches"]');
  const branches = section.querySelector('[data-additional-branches]');
  setupFloors(section.querySelector('fieldset'));
  const update = () => {
    const total = Math.min(100, Math.max(1, Number(count.value) || 1));
    for (let number = 2; number <= total; number++) {
      if (branches.children[number - 2]) continue;
      const branch = document.createElement('fieldset');
      branch.innerHTML = `<legend>Branch ${number}</legend>
        <label>Number of floors<input type="number" name="branchFloors${number}" data-floor-count min="1" max="50" required></label>
        <input type="hidden" name="branch${number}_roomsPerFloor" data-floor-layout>
        <div data-floor-rows></div><p data-total-rooms aria-live="polite"></p>`;
      branches.append(branch);
      setupFloors(branch);
    }
    Array.from(branches.children).forEach((branch, index) => {
      branch.hidden = index + 2 > total;
      branch.disabled = branch.hidden;
    });
  };
  count.addEventListener('input', update);
  update();
});
