// journal.js – handles garden event journal UI and storage, including automatic seasonal entries

(() => {
  const STORAGE_KEY = 'gardenJournal';
  const panel = document.createElement('div');
  panel.id = 'journalPanel';
  document.body.appendChild(panel);

  // --- UI: Filter for seasonal entries -------------------------------------
  const filterDiv = document.createElement('div');
  filterDiv.id = 'filter';
  const filterCheckbox = document.createElement('input');
  filterCheckbox.type = 'checkbox';
  filterCheckbox.id = 'seasonalFilter';
  const filterLabel = document.createElement('label');
  filterLabel.htmlFor = 'seasonalFilter';
  filterLabel.textContent = 'Show seasonal only';
  filterDiv.appendChild(filterCheckbox);
  filterDiv.appendChild(filterLabel);
  panel.appendChild(filterDiv);
  let showSeasonalOnly = false;
  filterCheckbox.addEventListener('change', () => {
    showSeasonalOnly = filterCheckbox.checked;
    render();
  });

  // --- Persistence --------------------------------------------------------
  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load journal entries', e);
      return [];
    }
  }
  function saveEntries(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to save journal entries', e);
    }
  }
  function formatTimestamp(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
  }

  // --- Automatic seasonal entry ------------------------------------------
  function generateSeasonEntryIfNeeded() {
    if (!window.seasonManager || typeof window.seasonManager.getSeason !== 'function') return;
    const currentSeason = window.seasonManager.getSeason();
    if (!currentSeason) return;
    const lastSeason = localStorage.getItem('lastSeason');
    if (lastSeason !== currentSeason) {
      const template = `Welcome to ${currentSeason}! New growth emerges, creatures stir, and the weather shifts.`;
      const entries = loadEntries();
      entries.push({ timestamp: Date.now(), type: 'Seasonal', details: template });
      saveEntries(entries);
      localStorage.setItem('lastSeason', currentSeason);
    }
  }

  // --- Rendering ----------------------------------------------------------
  function render() {
    generateSeasonEntryIfNeeded();
    const entries = loadEntries();
    // Preserve filter UI across renders
    panel.innerHTML = '';
    if (filterDiv) panel.appendChild(filterDiv);
    const title = document.createElement('h2');
    title.textContent = 'Garden Journal';
    panel.appendChild(title);
    const list = document.createElement('div');
    // Show most recent first
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (showSeasonalOnly && e.type !== 'Seasonal') continue;
      const entryDiv = document.createElement('div');
      entryDiv.className = 'journal-entry' + (e.type === 'Seasonal' ? ' seasonal' : '');
      const tsSpan = document.createElement('span');
      tsSpan.className = 'journal-timestamp';
      tsSpan.textContent = formatTimestamp(e.timestamp);
      const typeSpan = document.createElement('span');
      typeSpan.textContent = ` ${e.type}`;
      const detailsSpan = document.createElement('span');
      if (e.details) detailsSpan.textContent = ` – ${e.details}`;
      entryDiv.appendChild(tsSpan);
      entryDiv.appendChild(typeSpan);
      entryDiv.appendChild(detailsSpan);
      list.appendChild(entryDiv);
    }
    panel.appendChild(list);
  }

  // --- Public logging API -------------------------------------------------
  function logEvent(type, details) {
    const entries = loadEntries();
    entries.push({ timestamp: Date.now(), type, details });
    saveEntries(entries);
    render();
  }

  // Expose API
  window.garden = window.garden || {};
  window.garden.logEvent = logEvent;

  // --- Panel toggle -------------------------------------------------------
  const toggleBtn = document.getElementById('journalToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', panel.classList.contains('open'));
    });
  }

  // Ensure we have a stored lastSeason on first load
  if (!localStorage.getItem('lastSeason') && window.seasonManager && typeof window.seasonManager.getSeason === 'function') {
    const initSeason = window.seasonManager.getSeason();
    if (initSeason) localStorage.setItem('lastSeason', initSeason);
  }

  // Initial render
  render();
})();