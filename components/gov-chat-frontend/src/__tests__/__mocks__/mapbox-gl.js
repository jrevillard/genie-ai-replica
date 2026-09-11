// Stub for mapbox-gl in jsdom tests.
// The real package ships ESM + WebGL bindings that Jest cannot parse or run,
// and MapView is only imported for registration in these suites.
class Map {
  on() {}
  addControl() {}
  remove() {}
  getSource() {}
  addSource() {}
  addLayer() {}
  removeLayer() {}
  fitBounds() {}
}
class Marker {
  setLngLat() {
    return this;
  }
  setPopup() {
    return this;
  }
  addTo() {
    return this;
  }
}
class Popup {
  setText() {
    return this;
  }
}
class NavigationControl {}
module.exports = { Map, Marker, Popup, NavigationControl, accessToken: '' };
module.exports.default = module.exports;
