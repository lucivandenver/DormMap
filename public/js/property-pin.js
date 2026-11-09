window.dormMapPropertyPin = (leaflet, unregistered = false) => leaflet.divIcon({
  className: 'dormmap-property-pin',
  html: `<svg width="32" height="42" viewBox="0 0 32 42" aria-hidden="true"><path d="M16 40C13 35 1 23 1 16a15 15 0 1 1 30 0c0 7-12 19-15 24Z" fill="${unregistered ? '#b91c1c' : '#047857'}" stroke="white" stroke-width="2"/><circle cx="16" cy="15" r="5" fill="white"/></svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 40],
  popupAnchor: [0, -37]
});
