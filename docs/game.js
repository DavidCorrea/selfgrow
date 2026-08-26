/**
 * BELLOWSDEEP — core game engine.
 *
 * Mounts into the #game container on page load. Manages game state, the turn
 * loop (player acts → automaton acts → turn advances), rendering, and
 * keyboard input. Exports `createInitialState`, `advanceTurn`, and
 * `newDescent` for selftest.
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
import './galleries/condenser-room.js';
import './automata/sentinel.js';
import './automata/winder.js';
import './devices/vent.js';
import './devices/steam-cloak.js';
import './devices/safety-valve.js';
import './devices/condenser-valve.js';

/* ───── Game state ───── */

let currentGame = null;
let seedDisplayEl = null;
let seedInputEl = null;
let announceEl = null;

/* ───── Turn log (module-level, not on state) ───── */
let turnLog = [];

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
    maxPressure: 50,
    devicesUsed: 0,
    memory: memory || { descents: 0, lastOutcome: 'none', lastSeed: null },
    automatonState: {},
    deviceStates: {},
    foundDevices: ['vent'],
    announcement: null,
  };

  // Initialise automata
  const automaton = getAutomaton('sentinel');
  if (automaton && automaton.initialize) {
    automaton.initialize(state);
  }

  const winder = getAutomaton('winder');
  if (winder && winder.initialize) {
    winder.initialize(state);
  }

  return state;
}

/* ───── Turn loop ───── */

/**
 * Determine the machine's mood band from a pressure value.
 * Returns 'calm', 'normal', or 'agitated'.
 */
function pressureBand(p) {
  if (p <= 30) return 'calm';
  if (p >= 70) return 'agitated';
  return 'normal';
}

/**
 * Advance one full turn: player action → automaton acts → check death → render.
 * `action` is either 'wait' or 'use:<deviceId>'.
 */
export function advanceTurn(state, action) {
  if (state.ended) return;

  // Capture pre-turn state for announcement building
  const pressureAtTurnStart = state.pressure;
  const posBefore = state.automatonState.position;
  const bandBefore = pressureBand(pressureAtTurnStart);
  const parts = [];
  let usedDeviceId = null;

  // --- Player action ---
  if (action && action.startsWith('use:')) {
    const deviceId = action.slice(4);
    const device = getDevice(deviceId);
    if (device && device.canUse(state)) {
      device.use(state);
      state.devicesUsed += 1;
      usedDeviceId = deviceId;
      // Device effect announcement
      if (device.announceEffect) {
        parts.push(device.announceEffect(state));
      } else {
        parts.push(`You used the ${device.name || deviceId}.`);
      }
    }
  }
  // 'descend' moves to the next gallery in the sequence
  if (action === 'descend') {
    if (state.galleryIndex < state.gallerySequence.length - 1) {
      state.galleryIndex += 1;
      state.location = state.gallerySequence[state.galleryIndex];
      // Grant any device found in this gallery
      const deviceIds = listDevices();
      for (const id of deviceIds) {
        const device = getDevice(id);
        if (device && device.foundIn && device.foundIn === state.location && !state.foundDevices.includes(id)) {
          state.foundDevices.push(id);
        }
      }
      const gallery = getGallery(state.location);
      parts.push(`You descended into the ${gallery ? gallery.name || state.location : state.location}.`);
    }
  }
  if (action === 'wait') {
    parts.push('You waited.');
  }
  // 'wait' does nothing else — player chooses to let the turn pass

  // Escape action — only available in the final gallery when pressure ≤ 20.
  // Processed before pressure accumulation so the player can escape at the brink.
  if (action === 'escape') {
    if (state.galleryIndex === state.gallerySequence.length - 1 && state.pressure <= 20) {
      state.ended = true;
      state.active = false;
      state.endReason = 'You escaped through an exhaust vent, the machine\'s breath hot on your heels.';
      saveMemory('escaped', state.seed);
    }
    return;
  }

  // --- Winder acts before pressure accumulation ---
  // Reset to base rate, then let the Winder modify it if active
  state.pressureAccumulationRate = 5;
  const winder = getAutomaton('winder');
  if (winder && state.winderState) {
    state.winderState.active = (state.location === 'boiler-room');
    if (state.winderState.active) {
      winder.act(state);
    }
  }

  // Capture accumulated rate after Winder/condenser for Winder announcement
  const accumulatedRate = state.pressureAccumulationRate;

  // --- Condenser Valve cooling effect (reduces rate if active) ---
  if (state.deviceStates && state.deviceStates.condenserValveCooling > 0) {
    state.pressureAccumulationRate = Math.max(1, state.pressureAccumulationRate - 3);
    state.deviceStates.condenserValveCooling -= 1;
  }

  // --- Pressure accumulation (applied after the Winder adjusts the rate) ---
  state.pressure += state.pressureAccumulationRate;
  state.maxPressure = Math.max(state.maxPressure, state.pressure);

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

  // --- Sentinel movement announcement ---
  const posAfter = state.automatonState.position;
  const steps = Math.max(0, posBefore - posAfter);
  const distance = posAfter;
  if (distance > 0) {
    if (steps > 0) {
      parts.push(`The Sentinel advances ${steps} step${steps === 1 ? '' : 's'} — it is ${distance} turn${distance === 1 ? '' : 's'} away.`);
    } else {
      parts.push(`The Sentinel pauses — it is ${distance} turn${distance === 1 ? '' : 's'} away.`);
    }
  } else {
    parts.push('The Sentinel is upon you.');
  }

  // --- Check death conditions ---
  checkDeathConditions(state);
  if (state.ended) {
    return;
  }

  // --- Winder announcement ---
  if (state.winderState && state.winderState.active && accumulatedRate > 5) {
    parts.push('The Winder winds the pressure valves — pressure is building faster.');
  }

  // --- Pressure band crossing announcement ---
  const bandAfter = pressureBand(state.pressure);
  if (bandBefore !== bandAfter) {
    if (bandAfter === 'agitated') {
      parts.push(`Pressure rose to ${state.pressure} — past 70, the machine is agitated.`);
    } else if (bandAfter === 'calm') {
      parts.push(`Pressure fell to ${state.pressure} — below 30, the machine is calm.`);
    } else if (bandAfter === 'normal' && bandBefore === 'calm') {
      parts.push(`Pressure rose to ${state.pressure} — above 30 again, the machine is steady.`);
    } else if (bandAfter === 'normal' && bandBefore === 'agitated') {
      parts.push(`Pressure fell to ${state.pressure} — below 70 again, the machine is steady.`);
    }
  }

  // --- Advance turn ---
  if (!state.ended) {
    state.turn += 1;
  }

  // Build the combined announcement
  state.announcement = parts.join(' ');
}

/**
 * Check and set death conditions. Returns true if the descent has ended.
 */
/**
 * Map an endReason string to a short outcome token for memory.
 */
export function categorizeOutcome(endReason) {
  if (!endReason) return 'none';
  if (endReason.includes('cornered')) return 'cornered';
  if (endReason.includes('escaped')) return 'escaped';
  if (endReason.includes('rupture') || endReason.includes('burst')) return 'rupture';
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

/**
 * Check whether the player can escape in the current state.
 * Escape is only available in the final gallery when pressure ≤ 20.
 */
function canEscape(state) {
  return state.galleryIndex === state.gallerySequence.length - 1 && state.pressure <= 20;
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
  if (seedInputEl) {
    seedInputEl.value = state.seed;
    seedInputEl.dispatchEvent(new Event('input'));
  }

  // Update descent info from machine memory
  const descentCountEl = document.getElementById('descent-count');
  const descentOutcomeEl = document.getElementById('descent-outcome');
  if (descentCountEl && descentOutcomeEl) {
    const currentDescent = state.memory.descents + 1;
    descentCountEl.textContent = `Descent #${currentDescent}`;
    if (state.memory.descents === 0) {
      descentOutcomeEl.textContent = 'first descent';
    } else {
      const outcomeLabels = {
        'rupture': 'ruptured',
        'cornered': 'cornered',
        'escaped': 'escaped',
        'none': 'unknown'
      };
      const label = outcomeLabels[state.memory.lastOutcome] || state.memory.lastOutcome;
      descentOutcomeEl.textContent = `last: ${label}`;
    }
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

  // Next-turn pressure projection
  const projectedPressure = state.pressure + state.pressureAccumulationRate;
  const projectionDisplay = document.createElement('div');
  projectionDisplay.className = 'pressure-projection';
  projectionDisplay.textContent = `Next turn (wait): ${projectedPressure} / ${state.ruptureThreshold}`;
  pressureSection.appendChild(projectionDisplay);

  panelInner.appendChild(pressureSection);

  // Automaton status
  const autoSection = document.createElement('div');
  autoSection.className = 'automaton-section';
  const autoDesc = document.createElement('p');
  const automaton = getAutomaton('sentinel');
  autoDesc.textContent = automaton ? automaton.describe(state) : '';
  autoSection.appendChild(autoDesc);

  // Winder status (only shown when active in the Boiler Room)
  const winderAutomaton = getAutomaton('winder');
  if (winderAutomaton && state.winderState && state.winderState.active) {
    const winderDesc = document.createElement('p');
    winderDesc.className = 'winder-description';
    winderDesc.textContent = winderAutomaton.describe(state);
    autoSection.appendChild(winderDesc);
  }

  panelInner.appendChild(autoSection);

  // Capture the current announcement into the turn log
  // (must happen before the turn-log is built and before state.announcement is cleared)
  if (state.announcement) {
    appendTurnLogLine(turnLog, formatTurnLogLine(state, state.announcement));
  }

  // Turn log — rendered from the module-level array (no new game-state fields)
  const turnLogSection = document.createElement('div');
  turnLogSection.className = 'turn-log';

  const turnLogHeading = document.createElement('div');
  turnLogHeading.className = 'turn-log-heading';
  turnLogHeading.textContent = 'TURN LOG';
  turnLogSection.appendChild(turnLogHeading);

  for (const line of turnLog) {
    const lineEl = document.createElement('p');
    lineEl.className = 'turn-log-line';
    lineEl.textContent = line;
    turnLogSection.appendChild(lineEl);
  }

  panelInner.appendChild(turnLogSection);

  // Device area
  const deviceSection = document.createElement('div');
  deviceSection.className = 'device-section';

  const deviceIds = listDevices();
  for (const id of deviceIds) {
    const device = getDevice(id);
    if (!device) continue;
    // Only show devices the player has found
    if (!state.foundDevices.includes(id)) continue;

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

  // Escape button — only in the final gallery
  if (state.galleryIndex === state.gallerySequence.length - 1) {
    const escapeBtn = document.createElement('button');
    escapeBtn.className = 'action-btn escape-btn';
    escapeBtn.dataset.action = 'escape';
    escapeBtn.textContent = 'Escape through the exhaust vent';
    if (state.pressure <= 20) {
      escapeBtn.disabled = false;
    } else {
      escapeBtn.disabled = true;
      escapeBtn.title = 'Pressure too high — the vent is sealed. Reduce pressure to 20 or below to escape.';
    }
    actionSection.appendChild(escapeBtn);
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
  let hintText = '';
  if (state.foundDevices.includes('vent')) hintText += 'V: use Vent  |  ';
  if (state.foundDevices.includes('steam-cloak')) hintText += 'S: use Steam Cloak  |  ';
  if (state.foundDevices.includes('safety-valve')) hintText += 'A: use Safety Valve  |  ';
  if (state.foundDevices.includes('condenser-valve')) hintText += 'C: use Condenser Valve  |  ';
  hintText += 'W: wait  |  R: restart';
  if (state.galleryIndex < state.gallerySequence.length - 1) {
    hintText += '  |  D: descend';
  }
  if (state.galleryIndex === state.gallerySequence.length - 1) {
    hintText += '  |  E: escape';
  }
  hint.textContent = hintText;
  panelInner.appendChild(hint);

  // Focus the first button
  const firstBtn = panelInner.querySelector('button');
  if (firstBtn) firstBtn.focus();

  // Announce the turn summary or the initial gallery description
  const message = state.announcement || (getGallery(state.location) ? getGallery(state.location).describe(state) : '');
  announce(message);
  state.announcement = null;
}

/**
 * Determine the end screen content based on the end reason.
 * Returns { heading, className, isEscape } where:
 * - heading: the heading text ('ESCAPED' for escape, 'DESCENT ENDED' otherwise)
 * - className: the CSS class for the heading ('escape-heading' or 'death-heading')
 * - isEscape: boolean indicating if this is an escape outcome
 */
export function endScreenContent(endReason) {
  if (endReason && endReason.includes('escaped')) {
    return { heading: 'ESCAPED', className: 'escape-heading', isEscape: true };
  }
  return { heading: 'DESCENT ENDED', className: 'death-heading', isEscape: false };
}

function renderDeathScreen(container, state) {
  container.innerHTML = '';
  container.className = 'panel-inner death-screen';
  container.setAttribute('role', 'alertdialog');
  container.setAttribute('aria-label', 'Descent ended');

  const content = endScreenContent(state.endReason);

  const heading = document.createElement('h2');
  heading.className = content.className;
  heading.textContent = content.heading;
  container.appendChild(heading);

  const reason = document.createElement('p');
  reason.className = 'death-reason';
  reason.textContent = state.endReason || 'The descent has ended.';
  container.appendChild(reason);

  // Descent statistics
  const stats = document.createElement('div');
  stats.className = 'death-stats';

  const turnsEl = document.createElement('p');
  turnsEl.className = 'death-stat';
  turnsEl.textContent = `Turns survived: ${state.turn}`;
  stats.appendChild(turnsEl);

  const galleriesEl = document.createElement('p');
  galleriesEl.className = 'death-stat';
  galleriesEl.textContent = `Galleries visited: ${state.galleryIndex + 1} of ${state.gallerySequence.length}`;
  stats.appendChild(galleriesEl);

  const pressureEl = document.createElement('p');
  pressureEl.className = 'death-stat';
  pressureEl.textContent = `Maximum pressure: ${state.maxPressure}`;
  stats.appendChild(pressureEl);

  const devicesEl = document.createElement('p');
  devicesEl.className = 'death-stat';
  devicesEl.textContent = `Devices used: ${state.devicesUsed}`;
  stats.appendChild(devicesEl);

  container.appendChild(stats);

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
    const val = seedInputEl ? seedInputEl.value.trim() : '';
    startNewDescent(val || undefined);
    return;
  }

  // If game is ended, only restart works
  if (state.ended) return;

  if (key === 'v' && state.foundDevices.includes('vent')) {
    e.preventDefault();
    advanceTurn(state, 'use:vent');
    render(state);
  } else if (key === 's' && state.foundDevices.includes('steam-cloak')) {
    e.preventDefault();
    advanceTurn(state, 'use:steam-cloak');
    render(state);
  } else if (key === 'a' && state.foundDevices.includes('safety-valve')) {
    e.preventDefault();
    advanceTurn(state, 'use:safety-valve');
    render(state);
  } else if (key === 'c' && state.foundDevices.includes('condenser-valve')) {
    e.preventDefault();
    advanceTurn(state, 'use:condenser-valve');
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
  } else if (key === 'e') {
    e.preventDefault();
    if (state.galleryIndex === state.gallerySequence.length - 1) {
      advanceTurn(state, 'escape');
      render(state);
    }
  }
}

/* ───── Start a new descent ───── */

/* ───── Turn log helpers ───── */

/**
 * Append a line to a turn log array, capping at maxLines (newest last).
 * Pure helper — does not touch the module-level log.
 */
export function appendTurnLogLine(log, line, maxLines = 5) {
  log.push(line);
  if (log.length > maxLines) {
    log.shift();
  }
  return log;
}

/**
 * Format a turn announcement into a log line.
 * Uses the already-incremented state.turn (completed-turn count).
 */
export function formatTurnLogLine(state, announcement) {
  return `Turn ${state.turn}: ${announcement} Pressure now ${state.pressure}/${state.ruptureThreshold}.`;
}

/* ───── Start a new descent ───── */

export function startNewDescent(seed) {
  const actualSeed = seed || generateSeed();
  const memory = loadMemory();
  currentGame = createInitialState(actualSeed, memory);
  turnLog = [];
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

  seedInputEl = document.getElementById('seed-input');
  if (seedInputEl) {
    seedInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = seedInputEl.value.trim();
        if (val) {
          startNewDescent(val);
        }
      }
    });

    // Enable/disable the Replay button based on input content
    const replayBtn = document.getElementById('replay-btn');
    if (replayBtn) {
      const updateReplayBtn = () => {
        replayBtn.disabled = !seedInputEl.value.trim();
      };
      seedInputEl.addEventListener('input', updateReplayBtn);
      updateReplayBtn();
    }
  }

  // Replay button: start a new descent with the entered seed
  const replayBtn = document.getElementById('replay-btn');
  if (replayBtn) {
    replayBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = seedInputEl.value.trim();
      if (val) {
        startNewDescent(val);
      }
    });
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

  // Ensure descent info is shown immediately on mount
  const descentCountEl = document.getElementById('descent-count');
  const descentOutcomeEl = document.getElementById('descent-outcome');
  if (descentCountEl && descentOutcomeEl) {
    const memory = loadMemory();
    const currentDescent = memory.descents + 1;
    descentCountEl.textContent = `Descent #${currentDescent}`;
    if (memory.descents === 0) {
      descentOutcomeEl.textContent = 'first descent';
    } else {
      const outcomeLabels = {
        'rupture': 'ruptured',
        'cornered': 'cornered',
        'escaped': 'escaped',
        'none': 'unknown'
      };
      const label = outcomeLabels[memory.lastOutcome] || memory.lastOutcome;
      descentOutcomeEl.textContent = `last: ${label}`;
    }
  }

  startNewDescent();
}

// Auto-mount when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}