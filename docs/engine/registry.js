/**
 * Module registry — a lightweight registration system for automata, devices,
 * galleries, and afflictions. Each part registers itself with the game rather
 * than being wired in by hand. The registry is the single source of truth for
 * what modules exist.
 *
 * Registry pattern: modules import `register*` and call it at module scope.
 * The game engine imports the modules (for side effects) and uses `get*` to
 * look up registered parts.
 */

const _automata = {};
const _devices = {};
const _galleries = {};
const _afflictions = {};

export function registerAutomaton(id, impl) {
  _automata[id] = impl;
}
export function registerDevice(id, impl) {
  _devices[id] = impl;
}
export function registerGallery(id, impl) {
  _galleries[id] = impl;
}
export function registerAffliction(id, impl) {
  _afflictions[id] = impl;
}

export function getAutomaton(id) {
  return _automata[id] || null;
}
export function getDevice(id) {
  return _devices[id] || null;
}
export function getGallery(id) {
  return _galleries[id] || null;
}
export function getAffliction(id) {
  return _afflictions[id] || null;
}

export function listAutomata() {
  return Object.keys(_automata);
}
export function listDevices() {
  return Object.keys(_devices);
}
export function listGalleries() {
  return Object.keys(_galleries);
}
export function listAfflictions() {
  return Object.keys(_afflictions);
}