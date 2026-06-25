// pause.js – handles the "Pause & Breathe" UI
// Toggles a dimmed overlay with a breathing animation and soft sound.
// When activated, it pauses garden lighting and autonomous plant spawning.

const pauseBtn = document.getElementById('pauseBtn');
const pauseOverlay = document.getElementById('pauseOverlay');
const breathAudio = document.getElementById('breathAudio');

if (!pauseBtn || !pauseOverlay || !breathAudio) {
  console.error('Pause UI elements missing');
}

let isPaused = false;

function showPause() {
  isPaused = true;
  pauseOverlay.hidden = false;
  // Play breathing audio (respect user media preferences)
  breathAudio.currentTime = 0;
  breathAudio.play().catch(() => {}); // silence promise rejection if autoplay blocked
  // Pause garden lighting and plant spawning
  if (typeof window.pauseLighting === 'function') window.pauseLighting();
  if (typeof window.setGardenPaused === 'function') window.setGardenPaused(true);
  // Persist state
  try { localStorage.setItem('gardenPaused', 'true'); } catch (_) {}
}

function hidePause() {
  isPaused = false;
  pauseOverlay.hidden = true;
  breathAudio.pause();
  // Resume garden lighting and plant spawning
  if (typeof window.resumeLighting === 'function') window.resumeLighting();
  if (typeof window.setGardenPaused === 'function') window.setGardenPaused(false);
  try { localStorage.removeItem('gardenPaused'); } catch (_) {}
}

function togglePause() {
  if (isPaused) hidePause(); else showPause();
}

pauseBtn.addEventListener('click', togglePause);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPaused) {
    hidePause();
  }
});

// Restore persisted pause state on load
(function init() {
  try {
    const persisted = localStorage.getItem('gardenPaused') === 'true';
    if (persisted) {
      showPause();
    }
  } catch (_) {}
})();
