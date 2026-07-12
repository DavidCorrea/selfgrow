// wind.js – subtle wind simulation for foliage (plant elements)
// Applies a gentle, low‑frequency sway to all .plant elements.
// The sway amplitude varies slowly over time and follows the seasonal progress.
// Respects reduced‑motion preferences: when reduced motion is enabled, foliage remains static.

(() => {
  const garden = document.getElementById('garden');
  if (!garden) return; // no garden, nothing to do

  // Determine if we should disable motion.
  // Helper to check reduced‑motion flag dynamically.
  const isReduced = () => {
    if (window.reducedMotionEnabled) return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  // Do not early‑return; we always set up observers and animation, but the animation will respect reduced‑motion dynamically.

  // Base sway amplitude in degrees (maximum rotation).
  const BASE_AMPLITUDE = 2; // small rotation for gentle sway

  // Store the original transform for each plant so we can prepend the sway.
  const setBaseTransform = (el) => {
    // Preserve any existing transform (e.g., scale from growth).
    const current = el.style.transform || '';
    el.dataset.baseTransform = current;
  };

  // Initialize existing plants.
  garden.querySelectorAll('.plant').forEach(setBaseTransform);

  // Observe additions of new plant elements and set their base transform.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('plant')) {
          setBaseTransform(node);
        }
        // Also handle subtree additions.
        if (node.nodeType === Node.ELEMENT_NODE) {
          node.querySelectorAll('.plant').forEach(setBaseTransform);
        }
      }
    }
  });
  observer.observe(garden, { childList: true, subtree: true });

  const animate = (timestamp) => {
    // If reduced motion is enabled, ensure plants have only their base transform.
    if (isReduced()) {
      const plants = garden.querySelectorAll('.plant');
      plants.forEach((el) => {
        const base = el.dataset.baseTransform || '';
        el.style.transform = base;
      });
      requestAnimationFrame(animate);
      return;
    }
    // Seasonal progress provides a slow variation of amplitude (0‑1).
    const seasonProgress = (window.seasonManager && typeof window.seasonManager.getProgress === 'function')
      ? window.seasonManager.getProgress()
      : 0;
    // Modulate amplitude with a sine wave over the season.
    const seasonalFactor = 0.5 + 0.5 * Math.sin(seasonProgress * 2 * Math.PI);
    const amplitude = BASE_AMPLITUDE * seasonalFactor;

    // Low‑frequency wind using a slow sine wave.
    const angle = Math.sin(timestamp * 0.0005) * amplitude; // 0.0005 rad/ms ≈ 0.5 rad per second

    // Apply to every plant.
    const plants = garden.querySelectorAll('.plant');
    plants.forEach((el) => {
      const base = el.dataset.baseTransform || '';
      // Ensure we keep any existing transform chain.
      el.style.transform = `${base} rotate(${angle}deg)`;
    });

    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);
})();
