// journal.js – handles garden event journal UI and storage, including automatic seasonal entries and daily reflection prompts
(() => {
  let prompts = {};
  // Load prompts data asynchronously
  fetch('./prompts.json')
    .then(r => r.json())
    .then(data => { prompts = data; render(); })
    .catch(err => console.error('Failed to load prompts', err));

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

  // --- Automatic daily reflection prompt -----------------------------------
  function getPseudoWeather(date) {
    const dayCount = Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
    const states = ['sunny', 'cloudy', 'rainy'];
    return states[dayCount % states.length];
  }

  function generateReflectionIfNeeded() {
    const today = new Date();
    const todayKey = today.toISOString().split('T')[0]; // YYYY-MM-DD
    if (localStorage.getItem('lastPromptDate') === todayKey) return;
    if (!window.seasonManager || typeof window.seasonManager.getSeason !== 'function') return;
    const season = window.seasonManager.getSeason();
    const weather = getPseudoWeather(today);
    const seasonPrompts = prompts[season?.toLowerCase()] || {};
    const weatherPrompts = seasonPrompts[weather] || [];
    if (weatherPrompts.length === 0) return;
    const idx = Math.floor(today.getTime() / (1000 * 60 * 60 * 24)) % weatherPrompts.length;
    const prompt = weatherPrompts[idx];
    const entries = loadEntries();
    entries.push({ timestamp: Date.now(), type: 'Reflection', details: prompt, saved: false, dismissed: false });
    saveEntries(entries);
    localStorage.setItem('lastPromptDate', todayKey);
  }

  // --- Rendering ----------------------------------------------------------
  function render() {
    generateSeasonEntryIfNeeded();
    generateReflectionIfNeeded();
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
      entryDiv.className = 'journal-entry' + (e.type === 'Seasonal' ? ' seasonal' : '') + (e.type === 'Reflection' ? ' reflection' : '');
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

      // Actions for reflection entries
      if (e.type === 'Reflection') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'journal-actions';
        const dismissBtn = document.createElement('button');
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.classList.add('secondary');
        dismissBtn.addEventListener('click', () => {
          const all = loadEntries();
          const idx = all.findIndex(item => item.timestamp === e.timestamp && item.type === 'Reflection');
          if (idx !== -1) {
            all.splice(idx, 1);
            saveEntries(all);
            render();
          }
        });
        const saveBtn = document.createElement('button');
        saveBtn.textContent = e.saved ? 'Saved' : 'Save';
        saveBtn.disabled = e.saved;
        saveBtn.classList.add('primary');
        saveBtn.addEventListener('click', () => {
          const all = loadEntries();
          const idx = all.findIndex(item => item.timestamp === e.timestamp && item.type === 'Reflection');
          if (idx !== -1) {
            all[idx].saved = true;
            saveEntries(all);
            render();
          }
        });
        actionsDiv.appendChild(saveBtn);
        actionsDiv.appendChild(dismissBtn);
        entryDiv.appendChild(actionsDiv);
      }
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