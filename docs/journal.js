// journal.js – handles garden event journal UI and storage

(() => {
  const STORAGE_KEY = 'gardenJournal';
  const panel = document.createElement('div');
  panel.id = 'journalPanel';
  document.body.appendChild(panel);

  // Load entries from localStorage
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

  function render() {
    const entries = loadEntries();
    // Clear panel
    panel.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = 'Garden Journal';
    title.style.fontSize = '1.1rem';
    title.style.marginTop = '0';
    panel.appendChild(title);
    const list = document.createElement('div');
    // Show most recent first
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const entryDiv = document.createElement('div');
      entryDiv.className = 'journal-entry';
      const tsSpan = document.createElement('span');
      tsSpan.className = 'journal-timestamp';
      tsSpan.textContent = formatTimestamp(e.timestamp);
      const typeSpan = document.createElement('span');
      typeSpan.textContent = ` ${e.type}`;
      const detailsSpan = document.createElement('span');
      if (e.details) {
        detailsSpan.textContent = ` – ${e.details}`;
      }
      entryDiv.appendChild(tsSpan);
      entryDiv.appendChild(typeSpan);
      entryDiv.appendChild(detailsSpan);
      list.appendChild(entryDiv);
    }
    panel.appendChild(list);
  }

  // Expose logging API
  function logEvent(type, details) {
    const entries = loadEntries();
    entries.push({ timestamp: Date.now(), type, details });
    saveEntries(entries);
    render();
  }

  // Attach to global garden object
  window.garden = window.garden || {};
  window.garden.logEvent = logEvent;

  // Initial render
  render();

  // Toggle button handling moved to settings.js for accessibility and unified behavior.
})();
