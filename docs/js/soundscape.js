import { dom } from './state.js';
import { getCurrentTheme } from './theme.js';

var audioCtx = null;
var isSoundscapeActive = false;
var soundscapeNodes = [];
var soundscapeTimers = [];
var masterGain = null;

var soundscapeConfig = {
  dawn: {
    birdChirpFreq: 0.4,
    birdChirpRate: 3000,
    breezeFreq: 200,
    breezeDepth: 0.3,
    waterDropRate: 8000,
    cricketRate: 0,
    baseVolume: 0.15
  },
  day: {
    birdChirpFreq: 0.6,
    birdChirpRate: 2000,
    breezeFreq: 250,
    breezeDepth: 0.25,
    waterDropRate: 6000,
    cricketRate: 0,
    baseVolume: 0.12
  },
  dusk: {
    birdChirpFreq: 0.3,
    birdChirpRate: 4000,
    breezeFreq: 180,
    breezeDepth: 0.35,
    waterDropRate: 10000,
    cricketRate: 0,
    baseVolume: 0.14
  },
  night: {
    birdChirpFreq: 0.05,
    birdChirpRate: 12000,
    breezeFreq: 120,
    breezeDepth: 0.4,
    waterDropRate: 15000,
    cricketRate: 2500,
    baseVolume: 0.1
  }
};

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioCtx.destination);
}

function createBreezeDrone(config) {
  if (!audioCtx || !masterGain) return null;

  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  var filter = audioCtx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.value = config.breezeFreq;

  filter.type = 'lowpass';
  filter.frequency.value = config.breezeFreq * 2;
  filter.Q.value = 1;

  gain.gain.value = config.baseVolume * config.breezeDepth;

  var lfo = audioCtx.createOscillator();
  var lfoGain = audioCtx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 0.1 + Math.random() * 0.2;
  lfoGain.gain.value = config.breezeFreq * 0.1;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  lfo.start();

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start();

  soundscapeNodes.push({ osc: osc, lfo: lfo, gain: gain });

  return { osc: osc, gain: gain, lfo: lfo };
}

function createBirdChirp(config) {
  if (!audioCtx || !masterGain) return;
  if (Math.random() > config.birdChirpFreq) return;

  var now = audioCtx.currentTime;
  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  var filter = audioCtx.createBiquadFilter();

  var baseFreq = 1500 + Math.random() * 2000;
  osc.type = 'sine';
  osc.frequency.value = baseFreq;

  filter.type = 'bandpass';
  filter.frequency.value = baseFreq;
  filter.Q.value = 10;

  gain.gain.value = 0;

  var chirpDuration = 0.08 + Math.random() * 0.12;
  var numNotes = 1 + Math.floor(Math.random() * 3);

  for (var i = 0; i < numNotes; i++) {
    var noteStart = now + i * (chirpDuration + 0.05);
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(config.baseVolume * 0.3, noteStart + 0.02);
    gain.gain.linearRampToValueAtTime(config.baseVolume * 0.2, noteStart + chirpDuration * 0.5);
    gain.gain.linearRampToValueAtTime(0, noteStart + chirpDuration);

    osc.frequency.setValueAtTime(baseFreq + Math.random() * 500, noteStart);
    osc.frequency.linearRampToValueAtTime(baseFreq - 200 + Math.random() * 400, noteStart + chirpDuration);
  }

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + numNotes * (chirpDuration + 0.1) + 0.1);
}

function createWaterDrop(config) {
  if (!audioCtx || !masterGain) return;

  var now = audioCtx.currentTime;
  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  var filter = audioCtx.createBiquadFilter();

  var dropFreq = 2000 + Math.random() * 2000;
  osc.type = 'sine';
  osc.frequency.value = dropFreq;

  filter.type = 'highpass';
  filter.frequency.value = 1500;
  filter.Q.value = 5;

  gain.gain.value = 0;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(config.baseVolume * 0.15, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.2);
}

function createCricketClick(config) {
  if (!audioCtx || !masterGain) return;
  if (Math.random() > 0.3) return;

  var now = audioCtx.currentTime;
  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  var filter = audioCtx.createBiquadFilter();

  var cricketFreq = 4000 + Math.random() * 2000;
  osc.type = 'square';
  osc.frequency.value = cricketFreq;

  filter.type = 'bandpass';
  filter.frequency.value = cricketFreq;
  filter.Q.value = 20;

  gain.gain.value = 0;

  var clickDuration = 0.02;
  var numClicks = 2 + Math.floor(Math.random() * 4);
  for (var i = 0; i < numClicks; i++) {
    var clickStart = now + i * (clickDuration + 0.03);
    gain.gain.setValueAtTime(0, clickStart);
    gain.gain.linearRampToValueAtTime(config.baseVolume * 0.08, clickStart + 0.005);
    gain.gain.linearRampToValueAtTime(0, clickStart + clickDuration);
  }

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + numClicks * (clickDuration + 0.04) + 0.05);
}

function scheduleSounds(config) {
  if (!isSoundscapeActive) return;

  if (config.birdChirpFreq > 0) {
    var birdTimer = setTimeout(function () {
      if (!isSoundscapeActive) return;
      createBirdChirp(config);
      scheduleSounds(config);
    }, config.birdChirpRate * (0.5 + Math.random()));
    soundscapeTimers.push(birdTimer);
  }

  if (config.waterDropRate > 0) {
    var waterTimer = setTimeout(function () {
      if (!isSoundscapeActive) return;
      createWaterDrop(config);
      scheduleSounds(config);
    }, config.waterDropRate * (0.5 + Math.random()));
    soundscapeTimers.push(waterTimer);
  }

  if (config.cricketRate > 0) {
    var cricketTimer = setTimeout(function () {
      if (!isSoundscapeActive) return;
      createCricketClick(config);
      scheduleSounds(config);
    }, config.cricketRate * (0.5 + Math.random()));
    soundscapeTimers.push(cricketTimer);
  }
}

export function isSoundscapeEnabled() {
  return isSoundscapeActive;
}

function startSoundscape() {
  initAudioContext();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  var theme = getCurrentTheme();
  var config = soundscapeConfig[theme];

  masterGain.gain.linearRampToValueAtTime(config.baseVolume, audioCtx.currentTime + 1);

  createBreezeDrone(config);
  scheduleSounds(config);

  isSoundscapeActive = true;
  var soundscapeToggle = dom.soundscapeToggle;
  var soundscapeIcon = dom.soundscapeIcon;
  if (soundscapeToggle) soundscapeToggle.classList.add('active');
  if (soundscapeIcon) soundscapeIcon.textContent = '🔊';
}

function stopSoundscape() {
  if (!audioCtx || !masterGain) return;

  masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);

  soundscapeTimers.forEach(function (timer) {
    clearTimeout(timer);
  });
  soundscapeTimers = [];

  setTimeout(function () {
    soundscapeNodes.forEach(function (node) {
      try {
        node.osc.stop();
        node.lfo.stop();
      } catch (e) {
        // Already stopped
      }
    });
    soundscapeNodes = [];
  }, 600);

  isSoundscapeActive = false;
  var soundscapeToggle = dom.soundscapeToggle;
  var soundscapeIcon = dom.soundscapeIcon;
  if (soundscapeToggle) soundscapeToggle.classList.remove('active');
  if (soundscapeIcon) soundscapeIcon.textContent = '🔇';
}

function updateSoundscapeForTheme() {
  if (!isSoundscapeActive) return;

  var theme = getCurrentTheme();
  var config = soundscapeConfig[theme];

  masterGain.gain.linearRampToValueAtTime(config.baseVolume, audioCtx.currentTime + 0.5);

  soundscapeNodes.forEach(function (node) {
    try {
      node.osc.stop();
      node.lfo.stop();
    } catch (e) {}
  });
  soundscapeNodes = [];

  createBreezeDrone(config);
}

export function initSoundscape() {
  var soundscapeToggle = dom.soundscapeToggle;
  if (!soundscapeToggle) return;

  soundscapeToggle.addEventListener('click', function () {
    if (isSoundscapeActive) {
      stopSoundscape();
    } else {
      startSoundscape();
    }
  });

  soundscapeToggle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isSoundscapeActive) {
        stopSoundscape();
      } else {
        startSoundscape();
      }
    }
  });

  var lastSoundscapeTheme = getCurrentTheme();
  setInterval(function () {
    var currentTheme = getCurrentTheme();
    if (currentTheme !== lastSoundscapeTheme) {
      lastSoundscapeTheme = currentTheme;
      updateSoundscapeForTheme();
    }
  }, 5000);
}
