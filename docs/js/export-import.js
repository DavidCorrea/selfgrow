import { dom, journalEntries, wateredTiles, fertilizedTiles, prunedTiles, tileCycleState, tileColorMap, tileFlowerTypeMap, plantedCount, totalVolunteers, gridRevealed, journalRevealed, tendingRevealed } from './state.js';
import { getCurrentWeather } from './weather.js';

var importModal = null;
var importInput = null;

// ─── Export ───

function getGardenStateJSON() {
  var state = {
    _comment: "🌱 selfgrow garden export — a snapshot of your living garden, captured in time. Plant it anew elsewhere and watch it flourish.",
    _app: "selfgrow",
    _version: 1,
    _exportedAt: new Date().toISOString(),
    lastTended: Date.now(),
    plantedTiles: {},
    wateredTiles: {},
    fertilizedTiles: {},
    prunedTiles: {},
    tileCycleState: {},
    tileColorMap: {},
    tileFlowerTypeMap: {},
    journalEntries: journalEntries,
    plantedCount: plantedCount.value,
    totalVolunteers: totalVolunteers.value,
    gridRevealed: gridRevealed.value,
    journalRevealed: journalRevealed.value,
    tendingRevealed: tendingRevealed.value,
    weather: getCurrentWeather()
  };

  var tiles = dom.tiles;
  if (tiles) {
    tiles.forEach(function (tile) {
      var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
      if (tile.classList.contains('planted')) {
        state.plantedTiles[tileIndex] = true;
      }
      if (wateredTiles[tileIndex]) {
        state.wateredTiles[tileIndex] = true;
      }
      if (fertilizedTiles[tileIndex]) {
        state.fertilizedTiles[tileIndex] = true;
      }
      if (prunedTiles[tileIndex]) {
        state.prunedTiles[tileIndex] = true;
      }
      if (tileCycleState[tileIndex]) {
        state.tileCycleState[tileIndex] = {
          cycle: tileCycleState[tileIndex].cycle,
          stage: tileCycleState[tileIndex].stage || 'planted',
          isVolunteer: tileCycleState[tileIndex].isVolunteer || false
        };
      }
      if (tileColorMap[tileIndex]) {
        state.tileColorMap[tileIndex] = tileColorMap[tileIndex];
      }
      if (tileFlowerTypeMap[tileIndex]) {
        state.tileFlowerTypeMap[tileIndex] = tileFlowerTypeMap[tileIndex];
      }
    });
  }

  return state;
}

function formatExportFilename() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  return 'selfgrow-garden-' + y + '-' + m + '-' + d + '.json';
}

export function exportGarden() {
  var state = getGardenStateJSON();
  var json = JSON.stringify(state, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);

  var a = document.createElement('a');
  a.href = url;
  a.download = formatExportFilename();
  document.body.appendChild(a);
  a.click();

  setTimeout(function () {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ─── Import ───

function showImportModal(onConfirm) {
  if (importModal) {
    importModal.remove();
  }

  importModal = document.createElement('div');
  importModal.classList.add('import-modal');
  importModal.setAttribute('role', 'dialog');
  importModal.setAttribute('aria-modal', 'true');
  importModal.setAttribute('aria-label', 'Import garden confirmation');
  importModal.setAttribute('tabindex', '-1');

  importModal.innerHTML =
    '<div class="import-modal__overlay"></div>' +
    '<div class="import-modal__content">' +
      '<button class="import-modal__close" aria-label="Close import dialog">&times;</button>' +
      '<div class="import-modal__icon">🌿</div>' +
      '<h2 class="import-modal__title">import garden</h2>' +
      '<p class="import-modal__message">This will replace your current garden with the imported one. Your existing garden will be lost.</p>' +
      '<p class="import-modal__filename" id="importFilename"></p>' +
      '<div class="import-modal__actions">' +
        '<button class="import-modal__btn import-modal__btn--cancel" id="importCancelBtn">keep my garden</button>' +
        '<button class="import-modal__btn import-modal__btn--confirm" id="importConfirmBtn">import</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(importModal);

  // Animate in
  requestAnimationFrame(function () {
    importModal.classList.add('visible');
    importModal.focus();
  });

  var closeBtn = importModal.querySelector('.import-modal__close');
  var cancelBtn = importModal.querySelector('#importCancelBtn');
  var confirmBtn = importModal.querySelector('#importConfirmBtn');

  function closeModal() {
    importModal.classList.remove('visible');
    setTimeout(function () {
      importModal.remove();
      importModal = null;
    }, 400);
  }

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  confirmBtn.addEventListener('click', function () {
    closeModal();
    onConfirm();
  });

  // Close on overlay click
  importModal.querySelector('.import-modal__overlay').addEventListener('click', closeModal);

  // Close on Escape
  importModal.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeModal();
    }
  });
}

function parseImportFile(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        resolve(data);
      } catch (err) {
        reject(new Error('The file could not be read. Please make sure it is a valid selfgrow garden export.'));
      }
    };
    reader.onerror = function () {
      reject(new Error('Could not read the file.'));
    };
    reader.readAsText(file);
  });
}

function validateImportData(data) {
  if (!data || typeof data !== 'object') {
    return 'This file does not contain a valid garden.';
  }
  // Accept both exported files (with _app marker) and raw localStorage format
  var isExportFile = data._app === 'selfgrow' || data._comment;
  var isRawSave = data.version === 1 && (data.plantedTiles || data.journalEntries);
  if (!isExportFile && !isRawSave) {
    return 'This file does not appear to be a selfgrow garden export.';
  }
  return null;
}

function showImportError(message) {
  var errorEl = document.createElement('div');
  errorEl.classList.add('import-error');
  errorEl.setAttribute('role', 'alert');
  errorEl.innerHTML =
    '<span class="import-error__icon">🍂</span>' +
    '<span class="import-error__text">' + message + '</span>';
  document.body.appendChild(errorEl);

  requestAnimationFrame(function () {
    errorEl.classList.add('visible');
  });

  setTimeout(function () {
    errorEl.classList.remove('visible');
    setTimeout(function () {
      errorEl.remove();
    }, 400);
  }, 3500);
}

export function importGarden() {
  if (!importInput) {
    importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json';
  }

  // Reset so the same file can be re-selected
  importInput.value = '';

  importInput.onchange = function () {
    if (!importInput.files || importInput.files.length === 0) return;

    var file = importInput.files[0];

    parseImportFile(file)
      .then(function (data) {
        var validationError = validateImportData(data);
        if (validationError) {
          showImportError(validationError);
          return;
        }

        // Show the filename in the modal
        var filenameEl = document.getElementById('importFilename');
        if (filenameEl) {
          filenameEl.textContent = file.name;
        }

        showImportModal(function () {
          // Save current state to localStorage first (as a safety net)
          // Then restore from imported data
          try {
            localStorage.setItem('selfgrow_garden_state_backup', localStorage.getItem('selfgrow_garden_state'));
          } catch (e) {
            // ignore
          }

          // Write imported data to localStorage
          try {
            localStorage.setItem('selfgrow_garden_state', JSON.stringify(data));
          } catch (e) {
            showImportError('Could not save the garden. Storage may be full.');
            return;
          }

          // Reload the page to trigger a clean restore
          window.location.reload();
        });
      })
      .catch(function (err) {
        showImportError(err.message);
      });
  };

  importInput.click();
}


