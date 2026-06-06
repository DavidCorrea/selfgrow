import { dom, plantedCount, totalTiles } from './state.js';
import { notifyStatsChange } from './stats.js';

var celebrationTriggered = false;
var celebrationTimer = null;

// ── Golden Glow Overlay ──
// Creates a full-screen golden glow overlay that fades in and out
function createGlowOverlay() {
  var overlay = document.createElement('div');
  overlay.classList.add('celebration-glow-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  // Trigger reflow so the transition plays
  void overlay.offsetWidth;
  overlay.classList.add('active');

  return overlay;
}

// ── Drifting Particles ──
// Creates soft luminous particles that drift upward from each planted tile
function createDriftingParticles() {
  var tiles = dom.tiles;
  if (!tiles) return;

  var particleContainer = document.createElement('div');
  particleContainer.classList.add('celebration-particles');
  particleContainer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(particleContainer);

  tiles.forEach(function (tile, index) {
    if (!tile.classList.contains('planted')) return;

    var rect = tile.getBoundingClientRect();
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height * 0.35;

    // Create 3-5 particles per tile
    var count = 3 + Math.floor(Math.random() * 3);
    for (var i = 0; i < count; i++) {
      var particle = document.createElement('div');
      particle.classList.add('celebration-particle');

      // Random golden/warm color
      var colors = [
        'rgba(251, 191, 36, 0.8)',
        'rgba(253, 230, 138, 0.7)',
        'rgba(245, 158, 11, 0.75)',
        'rgba(252, 211, 77, 0.8)',
        'rgba(234, 179, 8, 0.7)',
      ];
      var color = colors[Math.floor(Math.random() * colors.length)];
      particle.style.background = color;
      particle.style.boxShadow = '0 0 0.3rem ' + color;

      // Start position
      particle.style.left = centerX + 'px';
      particle.style.top = centerY + 'px';

      // Random drift direction and distance
      var driftX = (Math.random() - 0.5) * 60;
      var driftY = -(40 + Math.random() * 80); // always upward
      particle.style.setProperty('--drift-x', driftX + 'px');
      particle.style.setProperty('--drift-y', driftY + 'px');

      // Staggered delay
      var delay = index * 120 + i * 80;
      particle.style.animationDelay = delay + 'ms';

      // Random size
      var size = 0.15 + Math.random() * 0.2;
      particle.style.width = size + 'rem';
      particle.style.height = size + 'rem';

      particleContainer.appendChild(particle);
    }
  });

  return particleContainer;
}

// ── Grid Golden Glow ──
// Adds a warm golden glow class to the garden grid wrapper
function addGridGlow() {
  var wrapper = dom.gardenGridWrapper;
  if (wrapper) {
    wrapper.classList.add('celebration-grid-glow');
  }
}

function removeGridGlow() {
  var wrapper = dom.gardenGridWrapper;
  if (wrapper) {
    wrapper.classList.remove('celebration-grid-glow');
  }
}

// ── Garden Complete Journal Entry ──
function addCompletionJournalEntry() {
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;

  if (!gardenJournal) return;

  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  var now = new Date();
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry', 'journal-entry--completion');
  entryEl.setAttribute('role', 'listitem');

  entryEl.innerHTML =
    '<div class="entry-timeline-dot entry-timeline-dot--completion"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text">🌾 your garden is whole — nine seeds, nine stories, one living tapestry</p>' +
      '<p class="entry-time">' + timeStr + ' &mdash; the garden breathes as one</p>' +
    '</div>' +
    '<div class="entry-swatch entry-swatch--completion" aria-hidden="true"></div>';

  if (journalTimeline) {
    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
    journalTimeline.scrollTop = 0;
  }

  // Pulse the journal
  gardenJournal.classList.remove('pulse');
  void gardenJournal.offsetWidth;
  gardenJournal.classList.add('pulse');
}

// ── Main Celebration Trigger ──
export function triggerGardenComplete() {
  if (celebrationTriggered) return;
  if (plantedCount.value < totalTiles) return;

  celebrationTriggered = true;

  // 1. Golden glow overlay
  var overlay = createGlowOverlay();

  // 2. Drifting particles (respects prefers-reduced-motion via CSS)
  var particles = createDriftingParticles();

  // 3. Grid golden glow
  addGridGlow();

  // 4. Special journal entry
  addCompletionJournalEntry();

  // 5. Notify stats to update mood to "complete"
  notifyStatsChange();

  // 6. Clean up after ~8 seconds
  var celebrationDuration = 8000;

  celebrationTimer = setTimeout(function () {
    // Fade out overlay
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(function () {
        overlay.remove();
      }, 2000);
    }

    // Remove particles
    if (particles) {
      particles.classList.add('fading');
      setTimeout(function () {
        particles.remove();
      }, 1500);
    }

    // Remove grid glow
    setTimeout(function () {
      removeGridGlow();
    }, 2000);

    celebrationTimer = null;
  }, celebrationDuration);
}

// ── Reset (for testing or future use) ──
export function resetCelebration() {
  celebrationTriggered = false;
  if (celebrationTimer) {
    clearTimeout(celebrationTimer);
    celebrationTimer = null;
  }
  var overlay = document.querySelector('.celebration-glow-overlay');
  if (overlay) overlay.remove();
  var particles = document.querySelector('.celebration-particles');
  if (particles) particles.remove();
  removeGridGlow();
}
