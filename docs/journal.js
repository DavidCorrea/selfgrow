// journal.js – handles garden event logging UI
// Listens for custom events and records them with timestamps in localStorage.
// Provides a slide‑in panel UI to view and clear the log.

const JOURNAL_KEY = 'gardenJournal';

// Utility: format timestamp nicely
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

// Load existing entries from localStorage or initialize empty array
function loadEntries() {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

// Persist entries array
function saveEntries(entries) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch (_) {}
}

// Add a new entry and update UI
function addEntry(eventName, detail) {
  const entry = {
    time: Date.now(),
    event: eventName,
    detail: detail || null,
  };
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  // prepend to UI (newest on top)
  const li = document.createElement('li');
  li.textContent = `${formatTime(entry.time)} – ${eventName}${detail ? ': ' + JSON.stringify(detail) : ''}`;
  const list = document.getElementById('journalList');
  if (list) list.insertBefore(li, list.firstChild);
}

// UI creation
function createUI() {
  // Panel
  const panel = document.createElement('div');
  panel.id = 'journalPanel';
  panel.innerHTML = `
    <h2>Garden Journal <button class="clearBtn" aria-label="Clear journal">Clear</button></h2>
    <ul id="journalList"></ul>
  `;
  document.body.appendChild(panel);

  // Toggle button
  const toggle = document.createElement('button');
  toggle.id = 'journalToggle';
  toggle.textContent = 'Journal';
  document.body.appendChild(toggle);

  // Populate existing entries
  const entries = loadEntries();
  const list = document.getElementById('journalList');
  entries.forEach(e => {
    const li = document.createElement('li');
    li.textContent = `${formatTime(e.time)} – ${e.event}${e.detail ? ': ' + JSON.stringify(e.detail) : ''}`;
    list.appendChild(li);
  });

  // Event listeners
  toggle.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('button.clearBtn').addEventListener('click', () => {
    localStorage.removeItem(JOURNAL_KEY);
    while (list.firstChild) list.removeChild(list.firstChild);
  });
}

// Register global event listeners for garden events
function registerListeners() {
  document.addEventListener('seedSprouted', () => addEntry('seedSprouted'));
  document.addEventListener('creatureCreated', () => addEntry('creatureCreated'));
  document.addEventListener('weatherChanged', e => addEntry('weatherChanged', e.detail));
}

// Initialise after DOM
window.addEventListener('load', () => {
  createUI();
  registerListeners();
});
