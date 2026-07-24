// welcomeBack.js – shows a welcome-back toast summarizing garden changes since last visit
(() => {
  const THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
  const STORAGE_KEY = 'welcomeBackLastVisit';

  // Wait for DOM and required globals
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    const now = Date.now();
    const lastVisit = localStorage.getItem(STORAGE_KEY);

    // If first visit or visited recently, just update timestamp and exit
    if (!lastVisit || (now - parseInt(lastVisit, 10)) < THRESHOLD_MS) {
      localStorage.setItem(STORAGE_KEY, now.toString());
      return;
    }

    const elapsed = now - parseInt(lastVisit, 10);

    // Gather stats
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const timeParts = [];
    if (days > 0) timeParts.push(`${days} day${days === 1 ? '' : 's'}`);
    const hoursRem = hours % 24;
    if (hoursRem > 0) timeParts.push(`${hoursRem} hour${hoursRem === 1 ? '' : 's'}`);
    const minsRem = minutes % 60;
    if (minsRem > 0 || timeParts.length === 0) {
      timeParts.push(`${minsRem} minute${minsRem === 1 ? '' : 's'}`);
    }
    const timeAgo = timeParts.join(', ');

    // Season
    const season = window.seasonManager && window.seasonManager.getSeason
      ? window.seasonManager.getSeason()
      : 'unknown';

    // Creatures count
    const creatureCount = document.querySelectorAll('.creature').length;

    // Flora count (plants)
    const floraCount = document.querySelectorAll('.plant').length;

    // Build message
    let message = `Welcome back. Since your last visit: ${timeAgo}, season is ${season}, ${creatureCount} creatures spotted, ${floraCount} plants growing.`;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.role = 'status';
    toast.ariaLive = 'polite';
    toast.textContent = message;

    // Dismiss on click
    toast.addEventListener('click', () => {
      toast.remove();
    });

    // Append to body
    document.body.appendChild(toast);

    // Trigger show (reflow)
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.remove('show');
        // Wait for transition end (if not reduced motion) then remove
        const onTransitionEnd = () => {
          toast.remove();
          toast.removeEventListener('transitionend', onTransitionEnd);
        };
        toast.addEventListener('transitionend', onTransitionEnd);
        // Fallback for reduced motion (transition may not fire)
        if (window.reducedMotionEnabled) {
          setTimeout(() => {
            if (toast.parentNode) toast.remove();
          }, 0);
        }
      }
    }, 8000);

    // Update last visit timestamp
    localStorage.setItem(STORAGE_KEY, now.toString());
  }

  init();
})();