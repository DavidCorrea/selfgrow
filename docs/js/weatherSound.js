import { onWeatherChange, getCurrentWeather } from './weather.js';
import { isSoundscapeEnabled } from './soundscape.js';
import { dom } from './state.js';

// Audio file mapping for weather layers
const weatherLayers = {
  rain: 'audio/rain.mp3',
  thunder: 'audio/thunder.mp3',
  wind: 'audio/wind.mp3',
  breeze: 'audio/breeze.mp3'
};

let audioCtx = null;
let gainNodes = {};
let audioElements = {};
let activeWeather = null;
let reducedMotion = false;
let initDone = false;

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function createAudioElements() {
  for (const [name, src] of Object.entries(weatherLayers)) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = 'auto';
    audioElements[name] = audio;
    // Connect to Web Audio for smooth gain control
    const source = audioCtx.createMediaElementSource(audio);
    const gain = audioCtx.createGain();
    gain.gain.value = 0; // start muted
    source.connect(gain).connect(audioCtx.destination);
    gainNodes[name] = gain;
  }
}

function getLayersForWeather(state) {
  switch (state) {
    case 'rainy':
      return ['rain', 'thunder'];
    case 'cloudy':
      return ['wind'];
    case 'snowy':
      return ['wind', 'breeze'];
    case 'sunny':
    default:
      return ['breeze'];
  }
}

function fadeGain(gainNode, toValue, duration) {
  const now = audioCtx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(toValue, now + duration);
}

function crossFadeToWeather(newWeather) {
  if (!audioCtx) return;
  const prevWeather = activeWeather;
  if (prevWeather === newWeather) return;
  const prevLayers = getLayersForWeather(prevWeather);
  const newLayers = getLayersForWeather(newWeather);

  // Fade out layers that are no longer needed
  prevLayers.forEach(name => {
    if (!newLayers.includes(name)) {
      const gain = gainNodes[name];
      if (gain) fadeGain(gain, 0, 2);
    }
  });

  // Fade in new layers
  newLayers.forEach(name => {
    const gain = gainNodes[name];
    const audio = audioElements[name];
    if (gain && audio) {
      if (audio.paused) audio.play();
      fadeGain(gain, 0.3, 2); // modest volume so it blends with base soundscape
    }
  });

  // After fade out, pause unused audios
  setTimeout(() => {
    prevLayers.forEach(name => {
      if (!newLayers.includes(name) && audioElements[name]) {
        audioElements[name].pause();
        audioElements[name].currentTime = 0;
      }
    });
  }, 2500);

  activeWeather = newWeather;
}

function handleToggleChange() {
  if (!audioCtx) return;
  const enabled = isSoundscapeEnabled();
  const now = audioCtx.currentTime;
  const target = enabled ? 0.3 : 0;
  // Apply to currently active layers
  const layers = getLayersForWeather(activeWeather || getCurrentWeather());
  layers.forEach(name => {
    const gain = gainNodes[name];
    if (gain) fadeGain(gain, target, 0.5);
    if (enabled) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      if (audioElements[name] && audioElements[name].paused) audioElements[name].play();
    }
  });
}

export function initWeatherSound() {
  if (initDone) return;
  initDone = true;
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    // Respect reduced motion – do not play dynamic weather sounds
    return;
  }
  initAudioContext();
  createAudioElements();

  // Start with current weather
  activeWeather = getCurrentWeather();
  const layers = getLayersForWeather(activeWeather);
  layers.forEach(name => {
    const audio = audioElements[name];
    if (audio) audio.play();
    const gain = gainNodes[name];
    if (gain) fadeGain(gain, isSoundscapeEnabled() ? 0.3 : 0, 1);
  });

  // Listen for weather changes
  onWeatherChange((newWeather) => {
    if (reducedMotion) return;
    crossFadeToWeather(newWeather);
  });

  // Listen for global soundscape toggle changes via DOM button
  const toggleBtn = dom.soundscapeToggle;
  if (toggleBtn) {
    toggleBtn.addEventListener('click', handleToggleChange);
    toggleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleToggleChange();
      }
    });
  }
}
