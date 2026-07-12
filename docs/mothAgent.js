// Moth autonomous agent — slow night-time wanderer
// Respects reduced-motion preference (both OS and user toggle)
// Appears after sunset, disappears at sunrise
// Animates along a smooth, eased Lissajous-like path within the garden bounds

(() => {
  const container = document.getElementById('moth-container');
  if (!container) {
    console.warn('Moth container not found');
    return;
  }

  // Create moth SVG element
  const moth = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  moth.setAttribute('viewBox', '0 0 32 32');
  moth.setAttribute('width', '24');
  moth.setAttribute('height', '24');
  moth.classList.add('moth');
  moth.style.position = 'absolute';
  moth.style.pointerEvents = 'none';
  moth.style.transition = 'transform 0.1s linear'; // smooth interpolation between frames
  moth.style.display = 'none'; // hidden until night
  // Simple moth silhouette — lightweight path
  moth.innerHTML = `
    <g fill="currentColor" stroke="currentColor" stroke-width="0.5" color="#444">
      <path d="M16 2c-5 0-9 4-9 9s4 9 9 9 9-4 9-9-4-9-9-9zm0 16c-4 0-7-3-7-7s3-7 7-7 7 3 7 7-3 7-7 7z"/>
      <path d="M16 4c-3 0-6 2-6 6s2 6 6 6 6-2 6-6-2-6-6-6zm0 10c-2 0-4-2-4-4s2-4 4-4 4 2 4 4-2 4-4 4z"/>
    </g>`;
  container.appendChild(moth);

  // Animation state
  let animationFrameId = null;
  let startTime = 0;
  let isNight = false;
  let isReducedMotion = false;
  let gardenRect = null;

  // Path parameters — slow, gentle Lissajous curve
  const PATH_DURATION = 60000; // 60 seconds for a full cycle (very slow)
  const AMPLITUDE_X_RATIO = 0.35; // 35% of garden width
  const AMPLITUDE_Y_RATIO = 0.25; // 25% of garden height
  const FREQ_X = 1; // 1 cycle horizontally
  const FREQ_Y = 1.3; // 1.3 cycles vertically — gentle figure-8
  const PHASE_OFFSET = Math.PI / 3; // offset for organic feel

  // Reduced motion check — reads both OS preference and user toggle
  function checkReducedMotion() {
    const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const userReduced = window.reducedMotionEnabled === true;
    return osReduced || userReduced;
  }

  // Update garden bounds (call on resize and before starting animation)
  function updateGardenBounds() {
    const garden = document.getElementById('garden');
    if (garden) {
      gardenRect = garden.getBoundingClientRect();
    }
  }

  // Compute moth position for a given time t (0 to 1 over PATH_DURATION)
  function getPosition(t) {
    if (!gardenRect) updateGardenBounds();
    if (!gardenRect) return { x: 0, y: 0 };

    const centerX = gardenRect.width / 2;
    const centerY = gardenRect.height / 2;
    const ampX = gardenRect.width * AMPLITUDE_X_RATIO;
    const ampY = gardenRect.height * AMPLITUDE_Y_RATIO;

    // Eased time for even gentler motion at turnarounds
    const easedT = easeInOutCubic(t);

    // Lissajous curve with phase offset
    const angleX = easedT * Math.PI * 2 * FREQ_X;
    const angleY = easedT * Math.PI * 2 * FREQ_Y + PHASE_OFFSET;

    const x = centerX + Math.sin(angleX) * ampX;
    const y = centerY + Math.cos(angleY) * ampY;

    // Clamp to garden bounds (with margin for moth size)
    const margin = 16; // half of moth size
    return {
      x: Math.max(margin, Math.min(gardenRect.width - margin, x)),
      y: Math.max(margin, Math.min(gardenRect.height - margin, y))
    };
  }

  // Cubic ease-in-out for gentle acceleration/deceleration
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Animation loop
  function animate(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = (timestamp - startTime) % PATH_DURATION;
    const t = elapsed / PATH_DURATION;

    const pos = getPosition(t);
    // Use transform for GPU-accelerated animation
    moth.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

    // Continue only if still night and not reduced motion
    if (isNight && !isReducedMotion) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      animationFrameId = null;
      startTime = 0;
    }
  }

  // Show moth and start animation
  function showMoth() {
    if (isReducedMotion) return;
    updateGardenBounds();
    isNight = true;
    moth.style.display = 'block';
    startTime = 0;
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(animate);
    }
  }

  // Hide moth and stop animation
  function hideMoth() {
    isNight = false;
    moth.style.display = 'none';
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    startTime = 0;
  }

  // Handle reduced motion toggle changes
  function onReducedMotionChange() {
    const newReduced = checkReducedMotion();
    if (newReduced === isReducedMotion) return;
    isReducedMotion = newReduced;
    if (isReducedMotion) {
      hideMoth();
    } else if (isNight) {
      showMoth();
    }
  }

  // Handle time change events (from app.js — day/night cycle)
  function onTimeChange(event) {
    const night = event?.detail?.night ?? false;
    if (night && !isNight) {
      showMoth();
    } else if (!night && isNight) {
      hideMoth();
    }
  }

  // Handle window resize
  function onResize() {
    updateGardenBounds();
    // If currently animating, the next frame will use new bounds
  }

  // Initialization
  function init() {
    isReducedMotion = checkReducedMotion();

    // Listen for timeChange events (dispatched by app.js)
    document.addEventListener('timeChange', onTimeChange);

    // Listen for reduced-motion changes
    // The reducedMotion.js script toggles a class on <html> and updates window.reducedMotionEnabled
    // We also listen to the media query for OS-level changes
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    mediaQuery.addEventListener('change', onReducedMotionChange);

    // Also listen for the user toggle — reducedMotion.js fires a change event on the checkbox
    const toggle = document.getElementById('reducedMotionToggle');
    if (toggle) {
      toggle.addEventListener('change', onReducedMotionChange);
    }

    // Listen for window resize
    window.addEventListener('resize', onResize);

    // Check initial night state (app.js sets body.night class)
    if (document.body.classList.contains('night')) {
      showMoth();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      document.removeEventListener('timeChange', onTimeChange);
      mediaQuery.removeEventListener('change', onReducedMotionChange);
      if (toggle) toggle.removeEventListener('change', onReducedMotionChange);
      window.removeEventListener('resize', onResize);
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();