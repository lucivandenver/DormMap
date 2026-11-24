(() => {
  const price = value => Number(value).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });

  function setup(root) {
    const get = name => root.querySelector(`[data-reserve-${name}]`);
    const toggle = get('toggle');
    const method = get('method');
    const reference = get('reference');
    const qr = get('qr');
    const status = get('status');
    const fee = get('amount');
    const forced = root.hasAttribute('data-reservation-forced');
    let listing;
    let room;
    let quote;
    let generation = 0;

    function report(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function cleanReference() {
      const value = method.value === 'GCash' ? reference.value.replace(/\D/g, '').slice(0, 13)
        : reference.value.replace(/[^a-z0-9]/gi, '').slice(0, 100);
      if (reference.value !== value) reference.value = value;
    }

    function updateMethod() {
      const url = quote?.qrCodes?.[method.value];
      const gcash = method.value === 'GCash';
      qr.hidden = !url;
      if (url) qr.src = url;
      else qr.removeAttribute('src');
      get('qr-fields').hidden = !url;
      get('cash').hidden = method.value !== 'Cash';
      reference.disabled = !url;
      reference.required = Boolean(url);
      reference.inputMode = gcash ? 'numeric' : 'text';
      if (gcash) reference.removeAttribute('maxlength');
      else reference.maxLength = 100;
      reference.pattern = gcash ? '[0-9]{13}' : '[A-Za-z0-9]{1,100}';
      get('reference-hint').textContent = gcash ? 'Enter the 13 digits from your GCash receipt.' : 'Enter the letters or numbers printed on your QR Ph receipt.';
    }

    async function load() {
      const request = ++generation;
      const active = Boolean(listing && room && toggle.checked);
      get('details').hidden = !active;
      fee.disabled = !active;
      method.required = active;
      method.disabled = !active;
      get('retry').hidden = true;
      const initialMethod = method.value || method.dataset.initialMethod;
      method.replaceChildren(new Option('Select a payment method', ''));
      fee.value = '';
      quote = null;
      updateMethod();
      get('fee').textContent = '';
      report(active ? 'Loading reservation payment options…' : '');
      if (!active) return;

      try {
        const response = await fetch(`/api/boarding-houses/${encodeURIComponent(listing)}/reservation?roomId=${encodeURIComponent(room)}`);
        const data = await response.json();
        if (request !== generation) return;
        if (!response.ok) throw new Error(data.error || 'Payment options could not be loaded.');
        quote = data;
        fee.value = data.fee;
        const basis = { room: 'room', person: 'person', bed: 'bedspace' }[data.rentalBasis] || 'slot';
        get('fee').textContent = `10% reservation fee: ${price(data.fee)} · ${price(data.monthlyRent)} per ${basis} / month`;
        method.append(...data.methods.map(value => new Option(value === 'Cash' ? 'Cash on Hand' : value, value)));
        if (data.methods.includes(initialMethod)) method.value = initialMethod;
        updateMethod();
        report('');
      } catch (error) {
        if (request !== generation) return;
        report(error instanceof TypeError ? 'Payment options could not be loaded. Try again.' : error.message);
        get('retry').hidden = false;
      }
    }

    toggle.addEventListener('change', load);
    method.addEventListener('change', () => { reference.value = ''; updateMethod(); });
    reference.addEventListener('input', cleanReference);
    reference.addEventListener('paste', event => {
      if (method.value !== 'GCash' || !event.clipboardData) return;
      event.preventDefault();
      reference.setRangeText(event.clipboardData.getData('text').replace(/\D/g, ''), reference.selectionStart, reference.selectionEnd, 'end');
      cleanReference();
    });
    get('retry').addEventListener('click', load);
    qr.addEventListener('error', () => {
      if (quote?.qrCodes?.[method.value]) report('This QR code could not be loaded. Ask the owner before paying or reload the payment options.');
      get('retry').hidden = false;
    });

    return {
      select(listingId, roomId, { restore = false, activate = false } = {}) {
        if (listing === listingId && room === roomId) return;
        listing = listingId;
        room = roomId;
        root.hidden = !listing || !room;
        toggle.disabled = root.hidden;
        if (!restore) {
          toggle.checked = (forced || activate) && !root.hidden;
          reference.value = '';
          method.dataset.initialMethod = '';
          method.value = '';
        }
        load();
      },
      values() {
        return toggle.checked && !toggle.disabled ? { reserveRoom: true, reservationFee: fee.value,
          reservationMethod: method.value, reservationReference: reference.disabled ? '' : reference.value } : {};
      }
    };
  }

  window.DormReservations = { setup };
})();
