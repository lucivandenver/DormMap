function ownerRegistrationLocations(form, step, onChange) {
  const first = step.querySelector('[data-branch-location]');
  const map = first.querySelector('[data-shared-registration-map]');
  const template = first.cloneNode(true);
  template.querySelector('[data-shared-registration-map]').remove();
  const heading = step.querySelector('[data-branch-heading]');
  const panels = [first];
  let index = 0;
  const count = () => Number(form.elements.declaredBranches.value);
  const active = () => panels[index];
  const field = name => active().querySelector(`[data-location-field="${name}"]`);

  first.querySelectorAll('[name]').forEach(input => { input.dataset.locationField = input.name; });
  step.addEventListener('input', event => {
    if (event.target.dataset.locationField === 'streetAddress') event.target.setCustomValidity('');
    if (event.target.dataset.locationField === 'boardingHouseAddress') field('streetAddress').setCustomValidity('');
  });

  function select(next) {
    index = next;
    panels.forEach((panel, number) => { panel.hidden = number !== index; });
    heading.textContent = `Branch ${index + 1} of ${panels.length}${index === 0 ? ' · Main property' : ''}`;
    active().querySelector('[data-map-placement]').after(map);
    onChange();
  }

  function prepare() {
    const total = count();
    if (!Number.isInteger(total) || total < 1 || total > 100) return false;
    while (panels.length > total) panels.pop().remove();
    while (panels.length < total) {
      const panel = template.cloneNode(true);
      panel.querySelectorAll('[name]').forEach(input => {
        input.removeAttribute('id');
        input.dataset.locationField = input.name;
        input.name = `branch${panels.length + 1}_${input.name}`;
        input.value = '';
      });
      panels.at(-1).after(panel);
      panels.push(panel);
      document.dispatchEvent(new Event('registration-fields-added'));
    }
    select(Math.min(index, total - 1));
    return true;
  }

  function issue(panel) {
    const street = panel.querySelector('[data-location-field="streetAddress"]');
    const barangay = panel.querySelector('[data-location-field="boardingHouseAddress"]');
    const address = street.value.trim().toLowerCase();
    street.setCustomValidity(address && address !== barangay.value.trim().toLowerCase()
      ? '' : 'Enter the street, purok, or sitio for this branch.');
    const invalid = panel.querySelector('input:invalid, select:invalid, textarea:invalid');
    if (invalid) return invalid;
    const latitude = panel.querySelector('[data-location-field="boardingHouseLatitude"]');
    const longitude = panel.querySelector('[data-location-field="boardingHouseLongitude"]');
    return latitude.value && longitude.value ? null : 'pin';
  }

  function validate() {
    const invalid = issue(active());
    if (!invalid) return true;
    if (invalid !== 'pin') invalid.reportValidity();
    else {
      const hint = active().querySelector('[data-owner-map-hint]');
      if (hint) hint.textContent = 'Pick the boarding house location on the map before continuing.';
      else alert('Pick the boarding house location on the map before continuing.');
    }
    return false;
  }

  return {
    active, field, prepare, select, validate,
    next() { if (index + 1 >= panels.length) return false; select(index + 1); heading.scrollIntoView({ block: 'center' }); return true; },
    back() { if (!index) return false; select(index - 1); heading.scrollIntoView({ block: 'center' }); return true; },
    last() { select(panels.length - 1); },
    validateAll() {
      const invalid = panels.findIndex(panel => issue(panel));
      if (invalid === -1) return true;
      select(invalid);
      return validate();
    }
  };
}
