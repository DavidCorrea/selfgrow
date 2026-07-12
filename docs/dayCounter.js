// dayCounter.js – displays current day number of the seasonal cycle
// The counter is a subtle overlay in the top‑left corner. It updates automatically
// based on the season manager's start timestamp. The full year spans 30 real days,
// so each day is 30 * 24 * 60 * 60 * 1000 / 30 = 24 * 60 * 60 * 1000 ms (24 hours).

(() => {
  // Guard against missing season manager
  if (!window.seasonManager) return;

  const DAY_MS = (30 * 24 * 60 * 60 * 1000) / 30; // 1 day in ms (24h)

  const counterEl = document.createElement('div');
  counterEl.id = 'day-counter';
  counterEl.className = 'day-counter';
  counterEl.setAttribute('aria-live', 'polite');
  counterEl.style.position = 'fixed';
  counterEl.style.top = '0.5rem';
  counterEl.style.left = '0.5rem';
  counterEl.style.zIndex = '5';
  counterEl.style.pointerEvents = 'none';
  document.body.appendChild(counterEl);

  function update() {
    const now = Date.now();
    const elapsed = now - window.seasonManager.start;
    const day = Math.floor(elapsed / DAY_MS) + 1; // start at Day 1
    // Clamp to 1‑30 range (full year)
    const dayInYear = ((day - 1) % 30) + 1;
    counterEl.textContent = `Day ${dayInYear}`;
  }

  // Initial render
  update();

  // Update periodically – every minute is sufficient for a day counter.
  const intervalId = setInterval(update, 60_000);

  // Expose for debugging / pause handling (optional)
  window._dayCounter = { update, intervalId };
})();
