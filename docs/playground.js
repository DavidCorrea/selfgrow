import { run } from './lang/run.js';
import { highlight } from './lang/syntax.js';
import { samples } from './samples.js';

const editor = document.getElementById('editor');
const output = document.getElementById('output');
const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const runStatus = document.getElementById('runStatus');

function setStatus(message) {
  runStatus.textContent = message;
}

function setOutput(text, isError = false) {
  output.textContent = text;
  output.className = isError ? 'output-error' : 'output-value';
}

function clear() {
  editor.value = '';
  output.textContent = '';
  output.className = '';
  editor.focus();
  setStatus('');
}

// --- Worker-based execution ---

let worker = null;
const pendingRequests = new Map();
let requestId = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./lang/worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const { id, result, error } = event.data;
      const { resolve, reject } = pendingRequests.get(id) || {};
      pendingRequests.delete(id);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
    worker.addEventListener('error', (event) => {
      const errData = {
        type: 'RuntimeError',
        message: event.message || 'Worker error',
        expected: null,
        found: null,
        location: null,
      };
      for (const [, { reject }] of pendingRequests) {
        reject(errData);
      }
      pendingRequests.clear();
      worker.terminate();
      worker = null;
    });
  }
  return worker;
}

function handleRun() {
  const source = editor.value.trim();
  if (!source) {
    setStatus('Empty program');
    setOutput('', false);
    return;
  }
  runBtn.disabled = true;
  const id = requestId++;
  const promise = new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
  });
  getWorker().postMessage({ source, id });
  promise
    .then((result) => {
      const resultText = result === undefined ? '' : String(result);
      setOutput(resultText, false);
      setStatus('');
    })
    .catch((errData) => {
      const formatted = formatError(errData);
      setOutput(formatted, true);
      setStatus(`Error: ${errData.message || String(errData)}`);
      highlightErrorLocation(errData);
    })
    .finally(() => {
      runBtn.disabled = false;
    });
}

function formatError(errData) {
  const type = errData.type || 'Error';
  const message = errData.message || 'Unknown error';
  let formatted = `${type}: ${message}`;
  if (errData.expected && errData.found) {
    formatted += `\n  Expected: ${errData.expected}\n  Found: ${errData.found}`;
  }
  if (errData.location) {
    const { line, column, offset } = errData.location;
    formatted += `\n  at line ${line}, column ${column} (offset ${offset})`;
  }
  return formatted;
}

function highlightErrorLocation(errData) {
  if (!errData.location || typeof errData.location.offset !== 'number') {
    return;
  }
  const offset = errData.location.offset;
  const totalLength = editor.value.length;
  if (offset < 0 || offset > totalLength) return;
  editor.focus();
  try {
    editor.setSelectionRange(offset, offset);
  } catch (_) {
    // setSelectionRange can throw in some edge cases; gracefully ignore
  }
}

// Skip link: move focus to the editor, not just scroll
document.getElementById('skipLink').addEventListener('click', (e) => {
  e.preventDefault();
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  editor.focus();
});

clearBtn.addEventListener('click', clear);
runBtn.addEventListener('click', handleRun);

// --- Sample loader (button + menu pattern) ---

const sampleBtn = document.getElementById('sampleBtn');
const sampleMenu = document.getElementById('sampleMenu');

// Populate the sample menu with buttons
for (const sample of samples) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.role = 'menuitem';
  btn.textContent = sample.name;
  btn.setAttribute('aria-label', `Load sample: ${sample.name}`);
  btn.addEventListener('click', () => {
    editor.value = sample.source;
    editor.focus();
    closeSampleMenu();
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      editor.value = sample.source;
      editor.focus();
      closeSampleMenu();
    } else if (e.key === 'Escape') {
      closeSampleMenu();
      sampleBtn.focus();
    }
  });
  sampleMenu.appendChild(btn);
}

function openSampleMenu() {
  sampleBtn.setAttribute('aria-expanded', 'true');
  sampleMenu.setAttribute('aria-hidden', 'false');
  // Focus first menu item
  const firstItem = sampleMenu.querySelector('button');
  if (firstItem) firstItem.focus();
}

function closeSampleMenu() {
  sampleBtn.setAttribute('aria-expanded', 'false');
  sampleMenu.setAttribute('aria-hidden', 'true');
}

sampleBtn.addEventListener('click', () => {
  const isExpanded = sampleBtn.getAttribute('aria-expanded') === 'true';
  if (isExpanded) {
    closeSampleMenu();
  } else {
    openSampleMenu();
  }
});

sampleBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault();
    openSampleMenu();
  } else if (e.key === 'Escape') {
    closeSampleMenu();
  }
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!sampleBtn.contains(e.target) && !sampleMenu.contains(e.target)) {
    closeSampleMenu();
  }
});

// Keyboard shortcuts
editor.addEventListener('keydown', (e) => {
  // Tab for indentation
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
    return;
    }
    // Enter to run, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      handleRun();
      return;
    }
    // Escape to clear output
    if (e.key === 'Escape') {
      e.preventDefault();
      clear();
      return;
    }
  });

  // --- Syntax highlighting ---

  const highlightOverlay = document.getElementById('highlightOverlay');

  function updateHighlight() {
    highlightOverlay.innerHTML = highlight(editor.value);
  }

  editor.addEventListener('input', updateHighlight);
  editor.addEventListener('keydown', (e) => {
    // Update highlight after Tab key too (it modifies the value)
    if (e.key === 'Tab') {
      // Defer so the value has been updated by the browser
      requestAnimationFrame(updateHighlight);
    }
  });

  // Initial highlight
  updateHighlight();

  // --- Scroll synchronization between textarea and highlight overlay ---

  function syncScroll() {
    highlightOverlay.scrollTop = editor.scrollTop;
    highlightOverlay.scrollLeft = editor.scrollLeft;
  }

  editor.addEventListener('scroll', syncScroll);