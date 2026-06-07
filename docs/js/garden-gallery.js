import { dom, tileColorMap, journalEntries } from './state.js';

var galleryModal = null;
var galleryCanvas = null;
var galleryCtx = null;
var galleryAnimFrame = null;
var galleryVisible = false;

// Flower color palette for canvas rendering
var flowerColors = [
  '#f472b6', '#ec4899', '#db2777',
  '#fb923c', '#f97316', '#ea580c',
  '#a78bfa', '#8b5cf6', '#7c3aed',
  '#60a5fa', '#3b82f6', '#2563eb',
  '#fbbf24', '#f59e0b', '#d97706',
  '#34d399', '#38bdf8', '#c084fc',
];

function countFlowersByColor() {
  var counts = {};
  for (var key in tileColorMap) {
    var color = tileColorMap[key];
    if (color) {
      counts[color] = (counts[color] || 0) + 1;
    }
  }
  return counts;
}

function getBloomTimeline() {
  var timeline = [];
  for (var i = 0; i < journalEntries.length; i++) {
    var entry = journalEntries[i];
    if (entry.type === 'plant' || entry.type === 'cycle' || entry.type === 'volunteer') {
      timeline.push({
        time: entry.timestamp || (Date.now() - (journalEntries.length - i) * 60000),
        color: entry.petalColor || flowerColors[i % flowerColors.length],
        tile: entry.tileIndex
      });
    }
  }
  return timeline;
}

function getTotalBloomed() {
  var total = 0;
  for (var i = 0; i < journalEntries.length; i++) {
    var entry = journalEntries[i];
    if (entry.type === 'plant' || entry.type === 'cycle' || entry.type === 'volunteer') {
      total++;
    }
  }
  if (total === 0) {
    var tiles = dom.tiles;
    if (tiles) {
      tiles.forEach(function (tile) {
        if (tile.classList.contains('planted')) {
          total++;
        }
      });
    }
  }
  return total;
}

function createGalleryModal() {
  if (galleryModal) return;

  // Modal overlay
  galleryModal = document.createElement('div');
  galleryModal.id = 'gardenGalleryModal';
  galleryModal.classList.add('gallery-modal');
  galleryModal.setAttribute('role', 'dialog');
  galleryModal.setAttribute('aria-modal', 'true');
  galleryModal.setAttribute('aria-label', 'Garden Gallery — Bloomed Flowers');
  galleryModal.setAttribute('tabindex', '-1');

  galleryModal.innerHTML =
    '<div class="gallery-modal__overlay"></div>' +
    '<div class="gallery-modal__content">' +
      '<button class="gallery-modal__close" aria-label="Close gallery" tabindex="0">' +
        '<span aria-hidden="true">&times;</span>' +
      '</button>' +
      '<h2 class="gallery-modal__title">Garden Gallery</h2>' +
      '<p class="gallery-modal__subtitle">your bloomed flowers</p>' +
      '<canvas class="gallery-modal__canvas" id="galleryCanvas" aria-label="Animated garden scene showing your bloomed flowers"></canvas>' +
      '<div class="gallery-modal__stats" id="galleryStats"></div>' +
    '</div>';

  document.body.appendChild(galleryModal);

  galleryCanvas = document.getElementById('galleryCanvas');
  galleryCtx = galleryCanvas.getContext('2d');

  // Close on overlay click
  galleryModal.querySelector('.gallery-modal__overlay').addEventListener('click', closeGallery);
  // Close on button click
  galleryModal.querySelector('.gallery-modal__close').addEventListener('click', closeGallery);
  // Close on Escape
  galleryModal.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGallery();
    }
  });

  // Handle resize
  window.addEventListener('resize', function () {
    if (galleryVisible) {
      resizeCanvas();
    }
  });
}

function resizeCanvas() {
  if (!galleryCanvas) return;
  var rect = galleryCanvas.parentElement.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  var w = Math.floor(rect.width - 2);
  var h = Math.min(300, Math.floor(window.innerHeight * 0.35));
  galleryCanvas.width = w * dpr;
  galleryCanvas.height = h * dpr;
  galleryCanvas.style.width = w + 'px';
  galleryCanvas.style.height = h + 'px';
  galleryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Animated flower data for canvas scene
var canvasFlowers = [];
var canvasTime = 0;

function initCanvasFlowers() {
  canvasFlowers = [];
  var total = getTotalBloomed();
  var colorCounts = countFlowersByColor();
  var colors = Object.keys(colorCounts);
  if (colors.length === 0) {
    // Generate fake flowers from total count
    for (var i = 0; i < Math.min(total, 50); i++) {
      canvasFlowers.push({
        x: 0, y: 0,
        size: 3 + Math.random() * 5,
        color: flowerColors[i % flowerColors.length],
        swayOffset: Math.random() * Math.PI * 2,
        swaySpeed: 0.5 + Math.random() * 1.5,
        stemHeight: 10 + Math.random() * 25
      });
    }
  } else {
    var count = 0;
    for (var c = 0; c < colors.length && count < 50; c++) {
      var n = Math.min(colorCounts[colors[c]], 50 - count);
      for (var j = 0; j < n; j++) {
        canvasFlowers.push({
          x: 0, y: 0,
          size: 3 + Math.random() * 5,
          color: colors[c],
          swayOffset: Math.random() * Math.PI * 2,
          swaySpeed: 0.5 + Math.random() * 1.5,
          stemHeight: 10 + Math.random() * 25
        });
        count++;
      }
    }
  }
}

function drawGalleryScene() {
  if (!galleryCtx || !galleryCanvas || !galleryVisible) return;

  var dpr = window.devicePixelRatio || 1;
  var w = galleryCanvas.width / dpr;
  var h = galleryCanvas.height / dpr;

  galleryCtx.clearRect(0, 0, w, h);

  // Background gradient
  var bgGrad = galleryCtx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, 'rgba(8, 12, 20, 0)');
  bgGrad.addColorStop(1, 'rgba(15, 20, 16, 0.3)');
  galleryCtx.fillStyle = bgGrad;
  galleryCtx.fillRect(0, 0, w, h);

  // Ground line
  var groundY = h * 0.85;
  galleryCtx.beginPath();
  galleryCtx.moveTo(0, groundY);
  galleryCtx.lineTo(w, groundY);
  galleryCtx.strokeStyle = 'rgba(90, 110, 80, 0.2)';
  galleryCtx.lineWidth = 1;
  galleryCtx.stroke();

  // Draw flowers
  var flowerCount = canvasFlowers.length;
  if (flowerCount === 0) return;

  var spacing = w / (flowerCount + 1);

  for (var i = 0; i < flowerCount; i++) {
    var flower = canvasFlowers[i];
    var fx = spacing * (i + 1);
    var fy = groundY;

    // Animate sway
    var sway = Math.sin(canvasTime * flower.swaySpeed + flower.swayOffset) * 2;

    // Stem
    galleryCtx.beginPath();
    galleryCtx.moveTo(fx, fy);
    galleryCtx.quadraticCurveTo(fx + sway, fy - flower.stemHeight * 0.5, fx + sway * 1.5, fy - flower.stemHeight);
    galleryCtx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
    galleryCtx.lineWidth = 1.5;
    galleryCtx.stroke();

    // Flower head
    var headX = fx + sway * 1.5;
    var headY = fy - flower.stemHeight;

    // Petals
    for (var p = 0; p < 6; p++) {
      var angle = (Math.PI * 2 * p) / 6 + canvasTime * 0.1 + flower.swayOffset;
      var px = headX + Math.cos(angle) * flower.size * 0.6;
      var py = headY + Math.sin(angle) * flower.size * 0.6;
      galleryCtx.beginPath();
      galleryCtx.arc(px, py, flower.size * 0.35, 0, Math.PI * 2);
      galleryCtx.fillStyle = flower.color;
      galleryCtx.globalAlpha = 0.7;
      galleryCtx.fill();
    }

    // Center
    galleryCtx.beginPath();
    galleryCtx.arc(headX, headY, flower.size * 0.25, 0, Math.PI * 2);
    galleryCtx.fillStyle = '#fbbf24';
    galleryCtx.globalAlpha = 0.9;
    galleryCtx.fill();
    galleryCtx.globalAlpha = 1;
  }

  // Soft glow at top
  var glowGrad = galleryCtx.createRadialGradient(w / 2, 0, 0, w / 2, 0, w * 0.6);
  glowGrad.addColorStop(0, 'rgba(74, 222, 128, 0.03)');
  glowGrad.addColorStop(1, 'transparent');
  galleryCtx.fillStyle = glowGrad;
  galleryCtx.fillRect(0, 0, w, h);

  canvasTime += 0.016;

  if (galleryVisible) {
    galleryAnimFrame = requestAnimationFrame(drawGalleryScene);
  }
}

function updateGalleryStats() {
  var statsEl = document.getElementById('galleryStats');
  if (!statsEl) return;

  var total = getTotalBloomed();
  var colorCounts = countFlowersByColor();
  var timeline = getBloomTimeline();

  var html = '<div class="gallery-stat-row">' +
    '<span class="gallery-stat-number">' + total + '</span> ' +
    '<span class="gallery-stat-text">total flowers bloomed</span></div>';

  // Color breakdown
  var colors = Object.keys(colorCounts).sort(function (a, b) {
    return colorCounts[b] - colorCounts[a];
  });

  if (colors.length > 0) {
    html += '<div class="gallery-color-bars">';
    var maxCount = colorCounts[colors[0]] || 1;
    for (var i = 0; i < Math.min(colors.length, 8); i++) {
      var color = colors[i];
      var count = colorCounts[color];
      var pct = (count / maxCount) * 100;
      html += '<div class="gallery-color-bar">' +
        '<span class="gallery-color-swatch" style="background:' + color + '"></span>' +
        '<span class="gallery-color-fill" style="width:' + pct + '%;background:' + color + '"></span>' +
        '<span class="gallery-color-count">' + count + '</span>' +
        '</div>';
    }
    html += '</div>';
  }

  // Bloom timeline (last 10)
  if (timeline.length > 0) {
    html += '<div class="gallery-timeline">';
    html += '<span class="gallery-timeline-label">recent blooms</span>';
    var recent = timeline.slice(-10);
    for (var t = 0; t < recent.length; t++) {
      html += '<span class="gallery-timeline-dot" style="background:' + recent[t].color + '" title="Tile ' + (recent[t].tile !== undefined ? recent[t].tile + 1 : '?') + '"></span>';
    }
    html += '</div>';
  }

  statsEl.innerHTML = html;
}

export function openGallery() {
  createGalleryModal();
  galleryVisible = true;
  galleryModal.classList.add('visible');
  galleryModal.focus();

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  resizeCanvas();
  initCanvasFlowers();
  updateGalleryStats();

  // Start animation loop
  canvasTime = 0;
  drawGalleryScene();
}

export function closeGallery() {
  if (!galleryModal) return;
  galleryVisible = false;
  galleryModal.classList.remove('visible');
  document.body.style.overflow = '';

  if (galleryAnimFrame) {
    cancelAnimationFrame(galleryAnimFrame);
    galleryAnimFrame = null;
  }
}

export function isGalleryOpen() {
  return galleryVisible;
}

export function initGardenGallery() {
  // Add gallery button to stats panel
  var gardenStats = dom.gardenStats || document.getElementById('gardenStats');
  if (!gardenStats) return;

  // Check if button already exists
  if (document.getElementById('galleryBtn')) return;

  var btn = document.createElement('button');
  btn.id = 'galleryBtn';
  btn.classList.add('gallery-btn');
  btn.setAttribute('aria-label', 'Open Garden Gallery');
  btn.setAttribute('title', 'View your bloomed flowers');
  btn.innerHTML = '<span class="gallery-btn__icon">🌺</span><span class="gallery-btn__label">garden gallery</span>';

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    openGallery();
  });

  btn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openGallery();
    }
  });

  // Insert after the stats poem
  var statsPoem = document.getElementById('statsPoem');
  if (statsPoem && statsPoem.parentNode) {
    statsPoem.parentNode.insertBefore(btn, statsPoem.nextSibling);
  } else {
    gardenStats.appendChild(btn);
  }
}
