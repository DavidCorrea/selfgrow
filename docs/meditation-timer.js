// Meditation Timer Overlay Module
// Provides an optional 5‑minute timer that appears after the morning greeting.
// The overlay contains a translucent circular progress bar, start/pause and dismiss controls.
// A gentle chime (Web Audio oscillator) plays on completion.

export function maybeShowMeditationTimer() {
  // Ensure we only create once per session
  if (document.querySelector('.meditation-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'meditation-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'meditation-card';

  // SVG circular progress
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'timer-svg');
  svg.setAttribute('viewBox', '0 0 100 100');

  const radius = 45;
  const circumference = 2 * Math.PI * radius;

  const bgCircle = document.createElementNS(svgNS, 'circle');
  bgCircle.setAttribute('class', 'timer-circle');
  bgCircle.setAttribute('cx', '50');
  bgCircle.setAttribute('cy', '50');
  bgCircle.setAttribute('r', radius.toString());

  const progressCircle = document.createElementNS(svgNS, 'circle');
  progressCircle.setAttribute('class', 'timer-progress');
  progressCircle.setAttribute('cx', '50');
  progressCircle.setAttribute('cy', '50');
  progressCircle.setAttribute('r', radius.toString());
  progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
  progressCircle.style.strokeDashoffset = `${circumference}`;

  svg.appendChild(bgCircle);
  svg.appendChild(progressCircle);

  const controls = document.createElement('div');
  controls.className = 'controls';
  const startBtn = document.createElement('button');
  startBtn.textContent = 'Start';
  const pauseBtn = document.createElement('button');
  pauseBtn.textContent = 'Pause';
  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  controls.appendChild(startBtn);
  controls.appendChild(pauseBtn);
  controls.appendChild(dismissBtn);

  card.appendChild(svg);
  card.appendChild(controls);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Timer logic
  const totalDuration = 5 * 60 * 1000; // 5 minutes in ms
  let startTime = 0;
  let elapsed = 0;
  let rafId = null;
  let running = false;

  function updateProgress() {
    const now = performance.now();
    elapsed = now - startTime + (running ? 0 : elapsed);
    const progress = Math.min(elapsed / totalDuration, 1);
    const offset = circumference * (1 - progress);
    progressCircle.style.strokeDashoffset = offset.toString();
    if (progress < 1) {
      rafId = requestAnimationFrame(updateProgress);
    } else {
      // Completed
      running = false;
      playChime();
    }
  }

  function startTimer() {
    if (running) return;
    running = true;
    startTime = performance.now();
    rafId = requestAnimationFrame(updateProgress);
  }

  function pauseTimer() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    // Accumulate elapsed time
    const now = performance.now();
    elapsed += now - startTime;
  }

  function dismiss() {
    running = false;
    cancelAnimationFrame(rafId);
    overlay.remove();
  }

  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  dismissBtn.addEventListener('click', dismiss);

  // Keyboard accessibility: Escape dismisses overlay
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  });

  // Focus first button for accessibility
  startBtn.focus();
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch (e) {
    // Fallback – no audio support
    console.warn('Audio context not supported', e);
  }
}
