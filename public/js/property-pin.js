(() => {
  function profileImage(house) {
    const value = house?.ownerProfilePicture || house?.profilePicture;
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, window.location.href);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function avatar(house, className) {
    const circle = document.createElement('span');
    circle.className = className;
    circle.textContent = String(house.fullName || house.ownerName || house.propertyName || house.name || 'D').trim().charAt(0).toUpperCase();
    const source = profileImage(house);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.remove(), { once: true });
      circle.append(image);
    }
    return circle;
  }

  window.dormMapPropertyPin = (leaflet, unregistered = false, house) => {
    if (house) {
      const pin = document.createElement('span');
      pin.className = 'dormmap-avatar-pin' + (unregistered ? ' is-unregistered' : '');
      pin.append(avatar(house, 'dormmap-pin-photo'));
      return leaflet.divIcon({
        className: 'dormmap-property-pin', html: pin,
        iconSize: [48, 62], iconAnchor: [24, 61], popupAnchor: [0, -55]
      });
    }
    return leaflet.divIcon({
      className: 'dormmap-property-pin',
      html: `<svg width="32" height="42" viewBox="0 0 32 42" aria-hidden="true"><path d="M16 40C13 35 1 23 1 16a15 15 0 1 1 30 0c0 7-12 19-15 24Z" fill="${unregistered ? '#b91c1c' : '#047857'}" stroke="white" stroke-width="2"/><circle cx="16" cy="15" r="5" fill="white"/></svg>`,
      iconSize: [32, 42], iconAnchor: [16, 40], popupAnchor: [0, -37]
    });
  };

  window.dormMapListingTitle = house => house.propertyName && house.branchNumber
    ? `${house.propertyName} · Branch ${house.branchNumber}`
    : house.boardingHouseName || house.name || 'Boarding house';
  window.dormMapListingLocation = house => {
    const street = String(house.address || house.boardingHouseAddress || '').trim();
    const barangay = String(house.barangay || '').trim();
    const town = house.town || 'Bongabong';
    return [...new Set([street, barangay, town].filter(Boolean))].join(', ');
  };

  let position;
  let requestedAt = 0;
  let pendingPosition;
  function currentPosition() {
    if (position && Date.now() - requestedAt < 60000) return Promise.resolve(position);
    if (!navigator.geolocation) return Promise.reject(new Error('Location unavailable'));
    if (!pendingPosition) {
      pendingPosition = new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10000, maximumAge: 30000
        });
      }).then(value => {
        position = value;
        requestedAt = Date.now();
        return value;
      }).finally(() => { pendingPosition = null; });
    }
    return pendingPosition;
  }

  window.dormMapRefreshListingDistance = async (leaflet, container, house) => {
    const distance = container.querySelector('[data-map-listing-distance]');
    if (!distance) return;
    distance.textContent = 'Getting distance from your location…';
    try {
      const location = await currentPosition();
      const km = leaflet.latLng(location.coords.latitude, location.coords.longitude)
        .distanceTo(leaflet.latLng(Number(house.latitude), Number(house.longitude))) / 1000;
      distance.textContent = `${km.toFixed(2)} km from your location`;
      distance.title = 'Straight-line distance from your current location';
    } catch {
      distance.textContent = 'Allow location access to see your distance';
    }
  };

  window.dormMapGoogleDirectionsUrl = house => {
    const coordinates = [house.latitude, house.longitude];
    if (!coordinates.every((value, index) => value != null && String(value).trim() &&
      Number.isFinite(Number(value)) && Math.abs(Number(value)) <= (index === 0 ? 90 : 180))) return null;
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', coordinates.map(Number).join(','));
    return url.href;
  };

  window.dormMapGoogleDirectionsLink = house => {
    const url = window.dormMapGoogleDirectionsUrl(house);
    if (!url) return null;
    const link = document.createElement('a');
    link.className = 'dormmap-google-directions';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Directions in Google Maps';
    link.setAttribute('aria-label', 'Directions in Google Maps (opens in a new tab)');
    link.innerHTML = '<span aria-hidden="true"></span>';
    return link;
  };

  window.dormMapListingPopup = (house, { onDetails, onDirections } = {}) => {
    const popup = document.createElement('article');
    popup.className = 'dormmap-listing-popup';
    const heading = document.createElement('div');
    heading.className = 'dormmap-listing-heading';
    const title = document.createElement('strong');
    title.textContent = window.dormMapListingTitle(house);
    heading.append(avatar(house, 'dormmap-listing-avatar'), title);
    const location = document.createElement('p');
    location.textContent = window.dormMapListingLocation(house);
    const distance = document.createElement('p');
    distance.dataset.mapListingDistance = '';
    distance.className = 'dormmap-listing-distance';
    distance.textContent = 'Tap the pin to see your distance';
    const rooms = document.createElement('p');
    rooms.className = 'dormmap-listing-rooms';
    rooms.textContent = `${house.roomsAvailable ?? 0} available rooms`;
    popup.append(heading, location, distance, rooms);
    const actions = document.createElement('div');
    actions.className = 'dormmap-listing-actions';
    const googleDirections = window.dormMapGoogleDirectionsLink(house);
    if (googleDirections) actions.append(googleDirections);
    for (const [label, callback] of [['View Details', onDetails], ['Get Directions', onDirections]]) {
      if (!callback) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (callback === onDetails) button.className = 'dormmap-listing-details';
      button.addEventListener('click', callback);
      actions.append(button);
    }
    popup.append(actions);
    return popup;
  };
})();
