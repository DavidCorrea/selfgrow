/**
 * BELLOWSDEEP — core game engine.
 *
 * Mounts into the #game container on page load. Manages game state, the turn
 * loop (player acts → automaton acts → turn advances), rendering, and
 * keyboard input. Exports `createInitialState` and `newDescent` for selftest.
 */

import { createPRNG } from './engine/prng.js';
import { generateGallerySequence } from './engine/gallery-generator.js';
import {
  getAutomaton,
  getDevice,
  getGallery,
  listDevices,
} from './engine/registry.js';
import { loadMemory, saveMemory } from './engine/memory.js';

// Import modules for registration side-effects
import './galleries/engine-room.js';
import './galleries/boiler-room.js';
import './galleries/pipe-gallery.js';
import './automata/sentinel.js';
import './devices/vent.js';
import './devices/steam-cloak.js';
import './devices/safety-valve.js';

/* ───── Game state ───── */

let currentGame = null;
let seedDisplayEl = null;
let announceEl = null;

/**
 * Create a new initial game state from a seed string.
 * Pure — no side-effects, no DOM.
 */
export function createInitialState(seed, memory) {
  const rng = createPRNG(seed);

  // Generate the gallery sequence from the seed — deterministic
  const gallerySequence = generateGallerySequence(rng);

  const state = {
    seed,
    rng,
    pressure: 50,
    ruptureThreshold: 100,
    pressureAccumulationRate: 5,
    location: gallerySequence[0] || 'engine-room',
    gallerySequence,
    galleryIndex: 0,
    turn: 0,
    active: true,
    ended: false,
    endReason: null,
    memory: memory || { descents: 0, lastOutcome: 'none', lastSeed: null },
    automatonState: {},
    deviceStates: {},
  };

  // Initialise automaton
  const automaton = getAutomaton('sentinel');
  if (automaton && automaton.initialize) {
    automaton.initialize(state);
  }

  return state;
}

/* ───── Turn loop ───── */

/**
 * Advance one full turn: player action → automaton acts → check death → render.
 * `action` is either 'wait' or 'use:<deviceId>'.
 */
function advanceTurn(state, action) {
  if (state.ended) return;

  // --- Player action ---
  if (action && action.startsWith('use:')) {
    const deviceId = action.slice(4);
    const device = getDevice(deviceId);
    if (device && device.canUse(state)) {
      device.use(state);
    }
  }
  // 'descend' moves to the next gallery in the sequence
  if (action === 'descend') {
    if (state.galleryIndex < state.gallerySequence.length - 1) {
      state.galleryIndex += 1;
      state.location = state.gallerySequence[state.galleryIndex];
    }
  }
  // 'wait' does nothing — player chooses to let the turn pass

  // --- Pressure accumulation (applied before automaton acts) ---
  state.pressure += state.pressureAccumulationRate;

  // --- Check death (rupture from accumulation) ---
  checkDeathConditions(state);
  if (state.ended) {
    return;
  }

  // --- Automaton action ---
  // Check if the Steam Cloak caused the Sentinel to skip its next advance
  const shouldSkip = state.automatonState && state.automatonState.skipNextAct;
  if (shouldSkip) {
    state.automatonState.skipNextAct = false;
  } else {
    const automaton = getAutomaton('sentinel');
    if (automaton && automaton.act) {
      automaton.act(state);
    }
  }

  // --- Check death conditions ---
  checkDeathConditions(state);

  // --- Advance turn ---
  if (!state.ended) {
    state.turn += 1;
  }
}

/**
 * Check and set death conditions. Returns true if the descent has ended.
 */
/**
 * Map an endReason string to a short outcome token for memory.
 */
function categorizeOutcome(endReason) {
  if (!endReason) return 'none';
  if (endReason.includes('rupture')) return 'rupture';
  if (endReason.includes('cornered')) return 'cornered';
  return 'none';
}

function checkDeathConditions(state) {
  // Rupture: pressure at or above threshold
  if (state.pressure >= state.ruptureThreshold) {
    state.ended = true;
    state.active = false;
    state.endReason = 'Your pressure gauge burst. The machine\'s own breath tore you apart.';
    saveMemory(categorizeOutcome(state.endReason), state.seed);
    return true;
  }

  // Defeat: automaton reaches the player
  if (state.automatonState.position <= 0) {
    state.ended = true;
    state.active = false;
    state.endReason = 'The Sentinel cornered you. There was nowhere left to run.';
    saveMemory(categorizeOutcome(state.endReason), state.seed);
    return true;
  }

  return false;
}

/* ───── Generate a random seed ───── */

function generateSeed() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/* ───── Rendering ───── */

function render(state) {
  const gameContainer = document.getElementById('game');
  if (!gameContainer) return;

  const panelInner = gameContainer.querySelector('.panel-inner');
  if (!panelInner) return;

  // Update seed display
  if (seedDisplayEl) {
    seedDisplayEl.textContent = state.seed;
  }

  if (state.ended) {
    renderDeathScreen(panelInner, state);
    return;
  }

  // Build the game UI — reset class from any previous death screen
  panelInner.innerHTML = '';
  panelInner.className = 'panel-inner';
  panelInner.setAttribute('role', 'region');
  panelInner.setAttribute('aria-label', 'Descent status');

  // ARIA live region for announcements
  const liveRegion = document.createElement('div');
  liveRegion.id = 'game-announce';
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('aria-live', 'assertive');
  liveRegion.setAttribute('aria-atomic', 'true');
  panelInner.appendChild(liveRegion);
  announceEl = liveRegion;

  // Gallery description
  const gallery = getGallery(state.location);
  const gallerySection = document.createElement('div');
  gallerySection.className = 'gallery-description';
  gallerySection.setAttribute('tabindex', '-1');
  const descPara = document.createElement('p');
  descPara.textContent = gallery ? gallery.describe(state) : 'You are somewhere unknown.';
  gallerySection.appendChild(descPara);

  // Gallery progress indicator
  const progress = document.createElement('div');
  progress.className = 'gallery-progress';
  progress.textContent = `Gallery ${state.galleryIndex + 1} of ${state.gallerySequence.length}`;
  gallerySection.appendChild(progress);

  panelInner.appendChild(gallerySection);

  // Pressure gauge
  const pressureSection = document.createElement('div');
  pressureSection.className = 'pressure-section';

  const gaugeLabel = document.createElement('div');
  gaugeLabel.className = 'pressure-label';
  gaugeLabel.textContent = 'PRESSURE';
  pressureSection.appendChild(gaugeLabel);

  const gaugeBarOuter = document.createElement('div');
  gaugeBarOuter.className = 'pressure-gauge-outer';
  gaugeBarOuter.setAttribute('role', 'meter');
  gaugeBarOuter.setAttribute('aria-valuenow', String(state.pressure));
  gaugeBarOuter.setAttribute('aria-valuemin', '0');
  gaugeBarOuter.setAttribute('aria-valuemax', String(state.ruptureThreshold));
  gaugeBarOuter.setAttribute('aria-label', `Pressure ${state.pressure} of ${state.ruptureThreshold}`);

  const gaugeFill = document.createElement('div');
  gaugeFill.className = 'pressure-gauge-fill';
  const pct = Math.min(100, (state.pressure / state.ruptureThreshold) * 100);
  gaugeFill.style.width = `${pct}%`;
  gaugeBarOuter.appendChild(gaugeFill);

  // Danger indicator
  if (state.pressure >= state.ruptureThreshold * 0.8) {
    gaugeFill.classList.add('danger');
  }

  pressureSection.appendChild(gaugeBarOuter);

  const gaugeNumbers = document.createElement('div');
  gaugeNumbers.className = 'pressure-numbers';
  gaugeNumbers.textContent = `${state.pressure} / ${state.ruptureThreshold}`;
  pressureSection.appendChild(gaugeNumbers);

  // Pressure accumulation rate display
  const rateDisplay = document.createElement('div');
  rateDisplay.className = 'pressure-rate';
  rateDisplay.textContent = `+${state.pressureAccumulationRate} per turn`;
  pressureSection.appendChild(rateDisplay);

  panelInner.appendChild(pressureSection);

  // Automaton status
  const autoSection = document.createElement('div');
  autoSection.className = 'automaton-section';
  const autoDesc = document.createElement('p');
  const automaton = getAutomaton('sentinel');
  autoDesc.textContent = automaton ? automaton.describe(state) : '';
  autoSection.appendChild(autoDesc);
  panelInner.appendChild(autoSection);

  // Device area
  const deviceSection = document.createElement('div');
  deviceSection.className = 'device-section';

  const deviceIds = listDevices();
  for (const id of deviceIds) {
    const device = getDevice(id);
    if (!device) continue;

    const btn = document.createElement('button');
    btn.className = 'device-btn';
    btn.dataset.action = `use:${id}`;
    btn.textContent = device.describe(state);
    btn.disabled = !device.canUse(state);
    if (!device.canUse(state)) {
      btn.title = 'Not enough pressure to use this device';
    }
    deviceSection.appendChild(btn);
  }

  panelInner.appendChild(deviceSection);

  // Action buttons
  const actionSection = document.createElement('div');
  actionSection.className = 'action-section';

  const waitBtn = document.createElement('button');
  waitBtn.className = 'action-btn';
  waitBtn.dataset.action = 'wait';
  waitBtn.textContent = 'Wait (advance turn)';
  actionSection.appendChild(waitBtn);

  // Descend button — only if there are more galleries to visit
  if (state.galleryIndex < state.gallerySequence.length - 1) {
    const descendBtn = document.createElement('button');
    descendBtn.className = 'action-btn descend-btn';
    descendBtn.dataset.action = 'descend';
    descendBtn.textContent = 'Descend deeper (next gallery)';
    actionSection.appendChild(descendBtn);
  }

  panelInner.appendChild(actionSection);

  // Turn counter
  const turnDisplay = document.createElement('div');
  turnDisplay.className = 'turn-display';
  turnDisplay.textContent = `Turn ${state.turn + 1}`;
  panelInner.appendChild(turnDisplay);

  // Keyboard hint
  const hint = document.createElement('p');
  hint.className = 'keyboard-hint';
  const descendHint = state.galleryIndex < state.gallerySequence.length - 1 ? '  |  D: descend' : '';
  hint.textContent = `V: use Vent  |  S: use Steam Cloak  |  A: use Safety Valve  |  W: wait  |  R: restart${descendHint}`;
  panelInner.appendChild(hint);

  // Focus the first button
  const firstBtn = panelInner.querySelector('button');
  if (firstBtn) firstBtn.focus();

  // Announce the gallery description
  const galleryForAnnounce = getGallery(state.location);
  announce(galleryForAnnounce ? galleryForAnnounce.describe(state) : '');
}

function renderDeathScreen(container, state) {
  container.innerHTML = '';
  container.className = 'panel-inner death-screen';
  container.setAttribute('role', 'alertdialog');
  container.setAttribute('aria-label', 'Descent ended');

  const heading = document.createElement('h2');
  heading.className = 'death-heading';
  heading.textContent = 'DESCENT ENDED';
  container.appendChild(heading);

  const reason = document.createElement('p');
  reason.className = 'death-reason';
  reason.textContent = state.endReason || 'The descent has ended.';
  container.appendChild(reason);

  const seedInfo = document.createElement('p');
  seedInfo.className = 'death-seed';
  seedInfo.textContent = `Seed: ${state.seed}`;
  container.appendChild(seedInfo);

  const restartHint = document.createElement('p');
  restartHint.className = 'death-restart';
  restartHint.textContent = 'Press R to begin a new descent.';
  container.appendChild(restartHint);

  // Focus the container for keyboard input
  container.setAttribute('tabindex', '-1');
  container.focus();
}

function announce(message) {
  if (announceEl) {
    announceEl.textContent = '';
    // Force reflow for screen readers
    requestAnimationFrame(() => {
      announceEl.textContent = message;
    });
  }
}

/* ───── Keyboard handling ───── */

function handleKeydown(e) {
  if (!currentGame) return;

  const state = currentGame;
  const key = e.key.toLowerCase();

  // Restart (works both during game and on death screen)
  if (key === 'r') {
    e.preventDefault();
    startNewDescent();
    return;
  }

  // If game is ended, only restart works
  if (state.ended) return;

  if (key === 'v') {
    e.preventDefault();
    advanceTurn(state, 'use:vent');
    render(state);
  } else if (key === 's') {
    e.preventDefault();
    advanceTurn(state, 'use:steam-cloak');
    render(state);
  } else if (key === 'a') {
    e.preventDefault();
    advanceTurn(state, 'use:safety-valve');
    render(state);
  } else if (key === 'w') {
    e.preventDefault();
    advanceTurn(state, 'wait');
    render(state);
  } else if (key === 'd') {
    e.preventDefault();
    if (state.galleryIndex < state.gallerySequence.length - 1) {
      advanceTurn(state, 'descend');
      render(state);
    }
  }
}

/* ───── Start a new descent ───── */

export function startNewDescent(seed) {
  const actualSeed = seed || generateSeed();
  const memory = loadMemory();
  currentGame = createInitialState(actualSeed, memory);
  render(currentGame);
}

/* ───── Mount on page load ───── */

function mount() {
  seedDisplayEl = document.getElementById('seed-value');
  if (!seedDisplayEl) {
    // Create one if missing
    const dd = document.querySelector('#seed-value') || document.createElement('dd');
    dd.id = 'seed-value';
    dd.setAttribute('aria-live', 'polite');
    const dl = document.querySelector('.seed-display dl');
    if (dl && !document.getElementById('seed-value')) {
      dl.appendChild(dd);
    }
    seedDisplayEl = document.getElementById('seed-value') || dd;
  }

  document.addEventListener('keydown', handleKeydown);

  // Also handle button clicks
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (!currentGame || currentGame.ended) return;

    const action = btn.dataset.action;
    e.preventDefault();
    advanceTurn(currentGame, action);
    render(currentGame);
  });

  startNewDescent();
}

// Auto-mount when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}