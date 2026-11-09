document.querySelectorAll('[data-owner-counts]').forEach(section => {
  const count = section.querySelector('[name="declaredBranches"]');
  const branches = section.querySelector('[data-additional-branches]');
  const update = () => {
    const total = Math.min(100, Math.max(1, Number(count.value) || 1));
    for (let number = 2; number <= total; number++) {
      if (branches.children[number - 2]) continue;
      const branch = document.createElement('fieldset');
      branch.innerHTML = `<legend>Branch ${number}</legend><div class="owner-count-grid">
        <label>Floors<input type="number" name="branchFloors${number}" min="1" max="50" required></label>
        <label>Rooms<input type="number" name="branchRooms${number}" min="1" max="100" required></label>
      </div>`;
      branches.append(branch);
    }
    [...branches.children].forEach((branch, index) => {
      branch.hidden = index + 2 > total;
      branch.disabled = branch.hidden;
    });
  };
  count.addEventListener('input', update);
  update();
});
