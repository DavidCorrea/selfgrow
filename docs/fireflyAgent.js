// fireflyAgent.js – autonomous firefly creatures for night time
// Spawns after sunset, disappears at sunrise. Each firefly glows with a pulsating CSS animation
// and moves slowly in a random walk. If ambient sound is enabled, a faint nighttime chirp plays.

(() => {
  const containerId = 'firefly-container';
  const fireflyClass = 'firefly';
  const NUM_FIREFLIES = 12; // configurable number of fireflies
  const SPEED_PX_PER_MS = 0.02; // ~20 pixels per second

  let isNight = false;
  let isReducedMotion = false;
  let gardenRect = null;
  let animationId = null;
  let fireflies = [];
  let audio = null;

  // Ambient sound toggle reference (same as ambientSound.js)
  const ambientToggleId = 'ambientSoundToggle';

  function initContainer() {
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.pointerEvents = 'none';
      container.style.display = 'none';
      container.style.zIndex = '11';
      document.body.appendChild(container);
    }
    return container;
  }

  function createFireflyElements(container) {
    for (let i = 0; i < NUM_FIREFLIES; i++) {
      const el = document.createElement('div');
      el.classList.add(fireflyClass);
      el.style.display = 'none'; // hidden until night
      container.appendChild(el);
      fireflies.push({ el, x: 0, y: 0, targetX: 0, targetY: 0, speed: SPEED_PX_PER_MS });
    }
  }

  function updateGardenRect() {
    const garden = document.getElementById('garden');
    if (garden) gardenRect = garden.getBoundingClientRect();
  }

  function randomPos() {
    if (!gardenRect) return { x: 0, y: 0 };
    const x = Math.random() * gardenRect.width;
    const y = Math.random() * gardenRect.height;
    return { x, y };
  }

  function initFireflyState(f) {
    const pos = randomPos();
    f.x = pos.x;
    f.y = pos.y;
    const target = randomPos();
    f.targetX = target.x;
    f.targetY = target.y;
    f.el.style.transform = `translate(${f.x}px, ${f.y}px)`;
    f.el.style.display = 'block';
  }

  function pickNewTarget(f) {
    const t = randomPos();
    f.targetX = t.x;
    f.targetY = t.y;
  }

  function stepFirefly(f, delta) {
    const dx = f.targetX - f.x;
    const dy = f.targetY - f.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      pickNewTarget(f);
      return;
    }
    const moveDist = f.speed * delta;
    const ratio = moveDist / dist;
    if (ratio >= 1) {
      f.x = f.targetX;
      f.y = f.targetY;
      pickNewTarget(f);
    } else {
      f.x += dx * ratio;
      f.y += dy * ratio;
    }
    f.el.style.transform = `translate(${f.x}px, ${f.y}px)`;
  }

  function animate(timestamp) {
    if (!animationId) animationId = timestamp; // store start timestamp if not set
    const delta = timestamp - animationId;
    animationId = timestamp;
    fireflies.forEach(f => stepFirefly(f, delta));
    if (isNight && !isReducedMotion) {
      requestAnimationFrame(animate);
    }
  }

  function startAnimation() {
    if (animationId) return; // already running
    requestAnimationFrame(animate);
  }

  function stopAnimation() {
    animationId = null; // next frame will not schedule
  }

  // Audio handling – faint chirp loop
  const FIREfly_AUDIO_DATA_URI =
    'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAABhTEFNRTMuMTAwA8MAAAAAAAAAAAAA//sQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wAAACJmaWx0ZXI=';
  function initAudio() {
    audio = new Audio(FIREfly_AUDIO_DATA_URI);
    audio.loop = true;
    audio.volume = 0.15;
    audio.preload = 'auto';
  }

  function updateAudioPlayback() {
    const ambientEnabled = document.getElementById(ambientToggleId)?.checked;
    if (isNight && ambientEnabled && !window.reducedMotionEnabled) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  function showFireflies() {
    if (isReducedMotion) return;
    updateGardenRect();
    fireflies.forEach(initFireflyState);
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'block';
    isNight = true;
    startAnimation();
    updateAudioPlayback();
  }

  function hideFireflies() {
    isNight = false;
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'none';
    fireflies.forEach(f => {
      f.el.style.display = 'none';
    });
    stopAnimation();
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  function onTimeChange(e) {
    const night = e?.detail?.night ?? false;
    if (night && !isNight) {
      showFireflies();
    } else if (!night && isNight) {
      hideFireflies();
    }
  }

  function checkReducedMotion() {
    const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const userReduced = window.reducedMotionEnabled === true;
    return osReduced || userReduced;
  }

  function onReducedMotionChange() {
    const newReduced = checkReducedMotion();
    if (newReduced !== isReducedMotion) {
      isReducedMotion = newReduced;
      if (isReducedMotion) {
        hideFireflies();
      } else if (document.body.classList.contains('night')) {
        showFireflies();
      }
    }
  }

  function onAmbientToggleChange() {
    updateAudioPlayback();
  }

  function init() {
    isReducedMotion = checkReducedMotion();
    const container = initContainer();
    createFireflyElements(container);
    initAudio();

    document.addEventListener('timeChange', onTimeChange);

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    mediaQuery.addEventListener('change', onReducedMotionChange);

    const rmToggle = document.getElementById('reducedMotionToggle');
    if (rmToggle) rmToggle.addEventListener('change', onReducedMotionChange);

    const ambientToggle = document.getElementById(ambientToggleId);
    if (ambientToggle) ambientToggle.addEventListener('change', onAmbientToggleChange);

    // Initial state based on body class
    if (document.body.classList.contains('night')) {
      showFireflies();
    }

    window.addEventListener('beforeunload', () => {
      hideFireflies();
      document.removeEventListener('timeChange', onTimeChange);
      mediaQuery.removeEventListener('change', onReducedMotionChange);
      if (rmToggle) rmToggle.removeEventListener('change', onReducedMotionChange);
      if (ambientToggle) ambientToggle.removeEventListener('change', onAmbientToggleChange);
    });
  }

  init();
})();
