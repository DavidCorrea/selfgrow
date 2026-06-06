import { dom, journalEntries, tileColorMap } from './state.js';

var ringsData = [];
var ringsContainer = null;
var ringsRevealed = false;

// ── Persistence key for bloom history ──
var STORAGE_KEY = 'selfgrow_bloomHistory';

function loadBloomHistory() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      ringsData = JSON.parse(raw);
    }
  } catch (e) {
    ringsData = [];
  }
}

function persistBloomHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ringsData));
  } catch (e) {
    // silently fail if storage is full
  }
}

// ── Rebuild bloom history from journal entries ──
// This ensures accuracy after restores / module re-init
function rebuildFromJournal() {
  var history = [];
  for (var i = 0; i < journalEntries.length; i++) {
    var entry = journalEntries[i];
    if (entry.type === 'plant' || entry.type === 'cycle' || entry.type === 'volunteer') {
      var color = tileColorMap[entry.tileIndex];
      if (color) {
        history.push({
          tileIndex: entry.tileIndex,
          cycle: entry.cycle || 1,
          color: color,
          timestamp: entry.timestamp || Date.now()
        });
      }
    }
  }
  ringsData = history;
  persistBloomHistory();
}

// ── Create the rings DOM element inside the stats panel ──
function createRingsContainer() {
  if (ringsContainer) return;

  var statsPoem = dom.statsPoem;
  if (!statsPoem) return;

  // Wrapper section
  var section = document.createElement('div');
  section.classList.add('garden-rings');
  section.setAttribute('aria-label', 'Garden bloom history rings');
  section.setAttribute('role', 'img');

  // Header
  var header = document.createElement('div');
  header.classList.add('garden-rings-header');
  header.innerHTML =
    '<span class="garden-rings-icon">🌳</span>' +
    '<span class="garden-rings-title">garden rings</span>';
  section.appendChild(header);

  // Rings viewport
  var viewport = document.createElement('div');
  viewport.classList.add('garden-rings-viewport');

  // Concentric rings container
  var ringsEl = document.createElement('div');
  ringsEl.classList.add('rings-concentric');
  ringsEl.id = 'ringsConcentric';
  viewport.appendChild(ringsEl);

  section.appendChild(viewport);

  // Subtle caption
  var caption = document.createElement('p');
  caption.classList.add('garden-rings-caption');
  caption.id = 'gardenRingsCaption';
  caption.textContent = 'each ring marks a bloom in your garden\'s life';
  section.appendChild(caption);

  // Insert after the poem in the stats panel
  statsPoem.parentNode.insertBefore(section, statsPoem.nextSibling);

  ringsContainer = section;
}

// ── Re-render all rings from ringsData ──
function renderRings() {
  var concentric = document.getElementById('ringsConcentric');
  if (!concentric) return;

  // Clear existing rings
  concentric.innerHTML = '';

  var count = ringsData.length;
  if (count === 0) return;

  // Determine how many rings to show (max 20 for visual sanity)
  var maxRings = 20;
  var startIdx = count > maxRings ? count - maxRings : 0;
  var visibleCount = count - startIdx;

  // Base ring size and growth per ring
  var baseSize = 2.5; // rem
  var ringStep = 0.65; // rem added per ring

  for (var i = startIdx; i < count; i++) {
    var ringIndex = i - startIdx;
    var bloom = ringsData[i];
    var size = baseSize + ringIndex * ringStep;

    var ring = document.createElement('div');
    ring.classList.add('ring');
    ring.style.width = size + 'rem';
    ring.style.height = size + 'rem';
    ring.style.borderColor = bloom.color;
    ring.style.boxShadow = '0 0 0.8rem ' + bloom.color + '40, inset 0 0 0.4rem ' + bloom.color + '20';
    ring.style.animationDelay = (ringIndex * 0.08) + 's';

    // Tooltip info
    ring.setAttribute('aria-label', 'Bloom ' + (i + 1) + ': tile ' + (bloom.tileIndex + 1) + ', cycle ' + bloom.cycle);

    concentric.appendChild(ring);
  }

  // Update caption
  var caption = document.getElementById('gardenRingsCaption');
  if (caption) {
    if (count === 1) {
      caption.textContent = 'one bloom has graced your garden';
    } else if (count <= 5) {
      caption.textContent = count + ' blooms woven into your garden\'s story';
    } else if (count <= 12) {
      caption.textContent = count + ' rings of life — your garden remembers each bloom';
    } else {
      caption.textContent = count + ' rings of life — a rich tapestry of growth';
    }
  }
}

// ── Reveal the rings section with animation ──
function revealRings() {
  if (ringsRevealed) return;
  ringsRevealed = true;

  if (!ringsContainer) createRingsContainer();
  if (!ringsContainer) return;

  ringsContainer.classList.add('visible');
}

// ── Public: record a bloom event ──
// Called whenever a tile blooms (new plant or new cycle)
export function recordBloom(tileIndex, cycle) {
  var color = tileColorMap[tileIndex];
  if (!color) return;

  ringsData.push({
    tileIndex: tileIndex,
    cycle: cycle || 1,
    color: color,
    timestamp: Date.now()
  });

  persistBloomHistory();

  if (!ringsContainer) {
    createRingsContainer();
  }

  if (ringsContainer) {
    if (!ringsRevealed && ringsData.length >= 1) {
      revealRings();
    }

    // Add just the new ring with animation for a delightful feel
    var concentric = document.getElementById('ringsConcentric');
    if (concentric) {
      var count = ringsData.length;
      var maxRings = 20;
      var startIdx = count > maxRings ? count - maxRings : 0;
      var ringIndex = count - 1 - startIdx;
      var baseSize = 2.5;
      var ringStep = 0.65;
      var size = baseSize + ringIndex * ringStep;

      var ring = document.createElement('div');
      ring.classList.add('ring', 'ring--new');
      ring.style.width = size + 'rem';
      ring.style.height = size + 'rem';
      ring.style.borderColor = color;
      ring.style.boxShadow = '0 0 0.8rem ' + color + '40, inset 0 0 0.4rem ' + color + '20';
      ring.setAttribute('aria-label', 'Bloom ' + count + ': tile ' + (tileIndex + 1) + ', cycle ' + (cycle || 1));

      concentric.appendChild(ring);

      // If we exceeded max rings, remove the innermost
      var existingRings = concentric.querySelectorAll('.ring');
      if (existingRings.length > maxRings) {
        var oldest = existingRings[0];
        oldest.classList.add('ring--fadeout');
        setTimeout(function () { oldest.remove(); }, 600);
      }

      // Update caption
      var caption = document.getElementById('gardenRingsCaption');
      if (caption) {
        if (count === 1) {
          caption.textContent = 'one bloom has graced your garden';
        } else if (count <= 5) {
          caption.textContent = count + ' blooms woven into your garden\'s story';
        } else if (count <= 12) {
          caption.textContent = count + ' rings of life — your garden remembers each bloom';
        } else {
          caption.textContent = count + ' rings of life — a rich tapestry of growth';
        }
      }
    }
  }
}

// ── Public: initialize the garden rings module ──
export function initGardenRings() {
  loadBloomHistory();

  // Rebuild from journal to ensure sync
  rebuildFromJournal();

  createRingsContainer();

  if (ringsData.length > 0) {
    revealRings();
    renderRings();
  }
}

// ── Public: called when stats panel is revealed ──
export function notifyStatsRevealed() {
  if (ringsData.length > 0 && !ringsRevealed) {
    revealRings();
    renderRings();
  }
}
