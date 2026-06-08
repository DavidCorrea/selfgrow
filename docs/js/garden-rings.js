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
  // Cap to prevent unbounded memory / localStorage growth
  if (ringsData.length > SVG_MAX_RINGS) {
    ringsData = ringsData.slice(ringsData.length - SVG_MAX_RINGS);
  }
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

  // Concentric rings container — uses a single SVG instead of N DOM elements
  var ringsEl = document.createElement('div');
  ringsEl.classList.add('rings-concentric');
  ringsEl.id = 'ringsConcentric';

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('rings-svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  var svgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svgGroup.setAttribute('transform', 'translate(100, 100)');
  svgGroup.id = 'ringsSvgGroup';
  svg.appendChild(svgGroup);

  ringsEl.appendChild(svg);
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

// ── SVG ring geometry constants ──
var SVG_BASE_RADIUS = 20;
var SVG_RADIUS_STEP = 6;
var SVG_MAX_RINGS = 20;
var SVG_STROKE_WIDTH = 2.5;

// ── Re-render all rings as SVG circles ──
function renderRings() {
  var svgGroup = document.getElementById('ringsSvgGroup');
  if (!svgGroup) return;

  // Clear existing circles
  while (svgGroup.firstChild) {
    svgGroup.removeChild(svgGroup.firstChild);
  }

  var count = ringsData.length;
  if (count === 0) return;

  // Determine which rings to show
  var startIdx = count > SVG_MAX_RINGS ? count - SVG_MAX_RINGS : 0;

  for (var i = startIdx; i < count; i++) {
    var ringIndex = i - startIdx;
    var bloom = ringsData[i];
    var radius = SVG_BASE_RADIUS + ringIndex * SVG_RADIUS_STEP;

    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', bloom.color);
    circle.setAttribute('stroke-width', SVG_STROKE_WIDTH);
    circle.setAttribute('opacity', '0');
    circle.classList.add('ring-circle');
    circle.style.animationDelay = (ringIndex * 0.08) + 's';

    // Tooltip info
    circle.setAttribute('data-label', 'Bloom ' + (i + 1) + ': tile ' + (bloom.tileIndex + 1) + ', cycle ' + bloom.cycle);

    svgGroup.appendChild(circle);
  }

  updateCaption(count);
}

// ── Update caption text ──
function updateCaption(count) {
  var caption = document.getElementById('gardenRingsCaption');
  if (!caption) return;

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

  // Cap to prevent unbounded memory / localStorage growth
  if (ringsData.length > SVG_MAX_RINGS) {
    ringsData = ringsData.slice(ringsData.length - SVG_MAX_RINGS);
  }

  persistBloomHistory();

  if (!ringsContainer) {
    createRingsContainer();
  }

  if (ringsContainer) {
    if (!ringsRevealed && ringsData.length >= 1) {
      revealRings();
    }

    var svgGroup = document.getElementById('ringsSvgGroup');
    if (svgGroup) {
      var count = ringsData.length;
      var startIdx = count > SVG_MAX_RINGS ? count - SVG_MAX_RINGS : 0;
      var ringIndex = count - 1 - startIdx;
      var radius = SVG_BASE_RADIUS + ringIndex * SVG_RADIUS_STEP;

      // If we exceeded max rings, remove the innermost circle and shift radii
      var existingCircles = svgGroup.querySelectorAll('.ring-circle');
      if (existingCircles.length >= SVG_MAX_RINGS) {
        svgGroup.removeChild(existingCircles[0]);
        // Re-index remaining circles with new radii
        var remaining = svgGroup.querySelectorAll('.ring-circle');
        for (var j = 0; j < remaining.length; j++) {
          var newR = SVG_BASE_RADIUS + j * SVG_RADIUS_STEP;
          remaining[j].setAttribute('r', newR);
        }
      }

      // Add the new ring circle with bloom-in animation
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', radius);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', SVG_STROKE_WIDTH);
      circle.setAttribute('opacity', '0');
      circle.classList.add('ring-circle', 'ring-circle--new');
      circle.setAttribute('data-label', 'Bloom ' + count + ': tile ' + (tileIndex + 1) + ', cycle ' + (cycle || 1));

      svgGroup.appendChild(circle);

      updateCaption(count);
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
