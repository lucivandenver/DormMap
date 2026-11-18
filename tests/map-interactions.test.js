import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ownerPaymentConfig, validatePaymentMethods } from '../services/ownerPaymentConfig.js';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.events = {};
    this.selectors = new Map();
    this.classList = { toggle() {} };
    this.isConnected = true;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parent) node.remove();
      this.children.push(node);
      node.parent = this;
    }
  }
  before(node) {
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index, 0, node);
    node.parent = this.parent;
  }
  replaceWith(node) {
    const parent = this.parent;
    const index = parent.children.indexOf(this);
    node.remove();
    parent.children[index] = node;
    node.parent = parent;
    this.parent = null;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);
    this.parent = null;
  }
  replaceChildren() { this.children = []; }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  focus() {}
}

function fixture() {
  const body = new Element('body');
  const original = new Element();
  const container = new Element();
  body.append(original);
  original.append(container);
  const layers = new Set();
  const events = new Map();
  let wheel = false;
  let zoomPosition = 'topleft';
  const map = {
    getContainer: () => container,
    scrollWheelZoom: {
      enabled: () => wheel, enable: () => { wheel = true; }, disable: () => { wheel = false; }
    },
    zoomControl: { getPosition: () => zoomPosition, setPosition: value => { zoomPosition = value; } },
    addLayer(layer) { layers.add(layer); layer.map = this; },
    removeLayer(layer) { layers.delete(layer); },
    invalidateSize() {},
    on(name, callback) { events.set(name, callback); },
    off(name) { events.delete(name); },
    fire(name, event) { events.get(name)?.(event); }
  };
  const tiles = [];
  const leaflet = {
    tileLayer(url) {
      const layer = {
        url,
        on(value) { this.events = value; }, off() {},
        addTo(target) { target.addLayer(this); return this; },
        remove() { this.map?.removeLayer(this); }
      };
      tiles.push(layer);
      return layer;
    },
    control() { return { addTo() {} }; },
    DomUtil: { create: () => new Element() },
    DomEvent: { disableClickPropagation() {} },
    divIcon: options => options,
    latLng: (lat, lng) => ({ lat, lng, distanceTo: () => 2750 })
  };
  const context = {
    window: { location: { href: 'https://dormmap.example/' }, addEventListener() {}, removeEventListener() {} },
    document: { body, querySelector: () => null, createElement: tag => new Element(tag), createComment: () => new Element() },
    navigator: { geolocation: { getCurrentPosition: resolve => resolve({ coords: { latitude: 12.72, longitude: 121.47 } }) } },
    URL, Date, Promise, WeakMap, Map, Number, String,
    requestAnimationFrame: callback => callback(),
    ResizeObserver: class { observe() {} disconnect() {} }
  };
  vm.createContext(context);
  for (const name of ['property-pin', 'full-map', 'branch-gallery']) {
    vm.runInContext(fs.readFileSync(new URL('../public/js/' + name + '.js', import.meta.url), 'utf8'), context);
  }
  return { context, map, leaflet, body, original, container, layers, tiles };
}

test('full map and satellite switches keep listing markers and restore the preview container', () => {
  const { context, map, leaflet, body, original, container, layers, tiles } = fixture();
  const street = leaflet.tileLayer('street').addTo(map);
  const marker = { id: 'boarding-house-marker' };
  map.addLayer(marker);
  const open = context.window.dormMapFullMap(leaflet, map, street);
  open(new Element('button'));
  const dialog = body.children.find(node => node.tagName === 'dialog');
  assert.equal(dialog.open, true);
  assert.equal(map.scrollWheelZoom.enabled(), true);
  assert.equal(map.zoomControl.getPosition(), 'topright');
  assert.notEqual(container.parent, original);

  dialog.querySelector('[data-satellite]').onclick();
  assert.ok([...layers].some(layer => layer.url?.includes('World_Imagery')));
  assert.ok(!tiles.some(layer => layer.url.includes('cartocdn.com')));
  assert.ok(layers.has(marker));
  dialog.querySelector('[data-street]').onclick();
  assert.ok(layers.has(street));
  assert.ok(layers.has(marker));

  dialog.querySelector('[data-satellite]').onclick();
  const satellite = tiles.find(layer => layer.url.includes('World_Imagery'));
  assert.match(satellite.url, /blankTile=false/);
  satellite.events.tileerror();
  satellite.events.load({ target: satellite });
  assert.ok([...layers].some(layer => layer.url?.includes('s2cloudless')));

  dialog.close();
  assert.equal(container.parent, original);
  assert.equal(map.scrollWheelZoom.enabled(), false);
  assert.equal(map.zoomControl.getPosition(), 'topleft');
  assert.ok(layers.has(street));
  assert.ok(layers.has(marker));
});

test('listing pins use owner photos and popups show branch, barangay, town and current distance', async () => {
  const { context, leaflet } = fixture();
  const house = {
    propertyName: 'Sample House', branchNumber: 2, fullName: 'Sample Owner',
    ownerProfilePicture: 'https://lh3.googleusercontent.com/owner',
    barangay: 'Labasan', town: 'Bongabong', latitude: 12.774, longitude: 121.47
  };
  const pin = context.window.dormMapPropertyPin(leaflet, false, house);
  assert.equal(pin.html.children[0].children[0].src, house.ownerProfilePicture);
  assert.equal(context.window.dormMapListingTitle(house), 'Sample House · Branch 2');
  assert.equal(context.window.dormMapListingLocation(house), 'Labasan, Bongabong');
  const unregistered = context.window.dormMapPropertyPin(leaflet, true, house);
  assert.match(unregistered.html.className, /is-unregistered/);
  const popup = context.window.dormMapListingPopup(house, { onDetails() {} });
  const [directions, details] = popup.children.at(-1).children;
  assert.equal(new URL(directions.href).searchParams.get('destination'), '12.774,121.47');
  assert.equal(directions.target, '_blank');
  assert.equal(details.textContent, 'View Details');
  assert.equal(context.window.dormMapGoogleDirectionsUrl({ latitude: '', longitude: 121.47 }), null);
  await context.window.dormMapRefreshListingDistance(leaflet, popup, house);
  assert.match(popup.querySelector('[data-map-listing-distance]').textContent, /2.75 km from your location/);
});

test('public photo captions show the branch while stored category labels stay available', () => {
  const { context } = fixture();
  const listing = { branchNumber: 1, branchGalleries: [{
    branchNumber: 1, photos: [{ url: '/uploads/photo.jpg', label: 'Bathroom' }]
  }] };
  const slides = context.window.DormBranchGallery.slidesFor(listing);
  assert.equal(slides[0].caption, 'Branch 1');
  assert.equal(listing.branchGalleries[0].photos[0].label, 'Bathroom');
});

test('deferred registration keeps selected methods while dashboard setup still requires a GCash QR', () => {
  assert.deepEqual(validatePaymentMethods(['Cash', 'GCash'], false, { requireQr: false }), ['Cash', 'GCash']);
  assert.throws(() => validatePaymentMethods(['Cash', 'GCash'], false), /Upload your GCash QR/);
  const config = ownerPaymentConfig({ paymentMethods: '["Cash","GCash"]' });
  assert.deepEqual(config.selectedMethods, ['Cash', 'GCash']);
  assert.deepEqual(config.methods, ['Cash']);
});
