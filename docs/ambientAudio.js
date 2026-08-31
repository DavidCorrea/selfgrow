/**
 * ambientAudio.js — selfgrow procedural ambient wind audio
 *
 * Generates a barely-there continuous wind sound using the Web Audio API.
 * No external audio assets needed — all sound is synthesized from noise buffers.
 *
 * The sound shifts character with the garden's weather AND time of day.
 * Time-of-day sets the base character (wind gain and filter frequency),
 * and weather modifiers compose on top.
 *
 * Time-of-day base audio settings:
 *  - Morning:  wind gain ~0.05, filter ~250Hz, rainMul 0.75
 *  - Midday:   wind gain ~0.08, filter ~400Hz, rainMul 1.0
 *  - Evening:  wind gain ~0.05, filter ~200Hz, rainMul 0.75
 *  - Night:    wind gain ≤0.03, filter ~80Hz,  rainMul 0.5
 *
 * Weather modifiers (multipliers applied to base):
 *  - Clear:         windMul 1.0, filterMul 1.0, rainBase 0
 *  - Overcast:      windMul 1.5, filterMul 0.45, rainBase 0
 *  - Light Drizzle: windMul 1.0, filterMul 0.625, rainBase 0.04
 *
 * When timeOfDay is omitted (e.g. existing weather-only update calls),
 * the default is 'Midday' so that the audio matches today's exact values.
 *
 * AudioContext is created on module load but only resumed and started
 * on first user interaction (click/tap) to comply with autoplay policies.
 *
 * Exports:
 *   createAmbientAudio() → { start, stop, update(weatherPhase, timeOfDay), resumeOnInteraction, state }
 */

/** Time-of-day base audio character */
const TIME_OF_DAY_AUDIO = {
  'Morning':  { windGain: 0.05, filterFreq: 250, rainMul: 0.75 },
  'Midday':   { windGain: 0.08, filterFreq: 400, rainMul: 1.0  },
  'Evening':  { windGain: 0.05, filterFreq: 200, rainMul: 0.75 },
  'Night':    { windGain: 0.03, filterFreq: 80,  rainMul: 0.5  }
};

/** Weather modifier multipliers applied to the time-of-day base */
const WEATHER_AUDIO_MODIFIERS = {
  'Clear':         { windMul: 1.0, filterMul: 1.0,    rainBase: 0    },
  'Overcast':      { windMul: 1.5, filterMul: 0.45,   rainBase: 0    },
  'Light Drizzle': { windMul: 1.0, filterMul: 0.625,  rainBase: 0.04 }
};

/** Default fallback for unknown weather — uses Clear values */
const DEFAULT_WEATHER_MODIFIER = { windMul: 1.0, filterMul: 1.0, rainBase: 0 };

/**
 * Compute composed audio settings from weather and time-of-day.
 *
 * @param {string} weatherPhase — 'Clear', 'Overcast', or 'Light Drizzle'
 * @param {string} [timeOfDay] — 'Morning'|'Midday'|'Evening'|'Night' (default 'Midday')
 * @returns {{ windGain: number, filterFreq: number, rainGain: number }}
 */
function computeAudioSettings(weatherPhase, timeOfDay) {
  const base = TIME_OF_DAY_AUDIO[timeOfDay] || TIME_OF_DAY_AUDIO['Midday'];
  const mod = WEATHER_AUDIO_MODIFIERS[weatherPhase] || DEFAULT_WEATHER_MODIFIER;
  return {
    windGain: base.windGain * mod.windMul,
    filterFreq: base.filterFreq * mod.filterMul,
    rainGain: mod.rainBase * base.rainMul
  };
}

export function createAmbientAudio() {
  let audioContext = null;
  let windSource = null;
  let windFilter = null;
  let windGain = null;
  let rainSource = null;
  let rainFilter = null;
  let rainGain = null;
  let isStarted = false;

  const state = {
    type: 'ambient-audio',
    windGain: 0,
    rainGain: 0,
    windFilterFrequency: 400,
    isPlaying: false,
    isStarted: false
  };

  /**
   * Lazily create the AudioContext. Must be called from a user gesture
   * or after the user has interacted with the page.
   */
  function ensureContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }

  /**
   * Generate a buffer of white noise of the given duration in seconds.
   */
  function createNoiseBuffer(duration) {
    const ctx = ensureContext();
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // White noise: random values in [-1, 1]
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Create the wind noise source: white noise → lowpass filter → gain → output.
   * The lowpass filter shapes the noise into a soft whoosh.
   */
  function startWind() {
    if (windSource) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const buffer = createNoiseBuffer(4);
    windSource = ctx.createBufferSource();
    windSource.buffer = buffer;
    windSource.loop = true;

    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.5;

    windGain = ctx.createGain();
    windGain.gain.value = 0;

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);

    windSource.start();
  }

  /**
   * Create the rain noise layer: separate white noise → bandpass filter → gain → output.
   * The bandpass is tuned to ~3 kHz for a soft rustle/hiss.
   */
  function startRain() {
    if (rainSource) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const buffer = createNoiseBuffer(4);
    rainSource = ctx.createBufferSource();
    rainSource.buffer = buffer;
    rainSource.loop = true;

    rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 3000;
    rainFilter.Q.value = 1.0;

    rainGain = ctx.createGain();
    rainGain.gain.value = 0;

    rainSource.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(ctx.destination);

    rainSource.start();
  }

  /**
   * Start the audio system. Creates the AudioContext if needed,
   * builds the noise buffers, and begins playback.
   *
   * Safe to call multiple times — only starts once.
   */
  function start() {
    if (isStarted) return;
    const ctx = ensureContext();
    if (!ctx) return;

    // Resume if suspended (browser autoplay policy may have suspended it
    // after creation, but start() is called from user interaction handler)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    startWind();
    startRain();

    // Immediately read the current weather phase and time-of-day from the DOM
    // and apply them, so audio is correct from the moment it starts.
    const weatherEl = document.getElementById('weather-display');
    const timeEl = document.getElementById('time-display');
    const weatherPhase = weatherEl && weatherEl.textContent ? weatherEl.textContent.trim() : 'Clear';
    const timeOfDay = timeEl && timeEl.textContent ? timeEl.textContent.trim() : 'Midday';

    if (windGain && windFilter) {
      const settings = computeAudioSettings(weatherPhase, timeOfDay);
      windGain.gain.setValueAtTime(settings.windGain, ctx.currentTime);
      windFilter.frequency.setValueAtTime(settings.filterFreq, ctx.currentTime);
      state.windGain = settings.windGain;
      state.windFilterFrequency = settings.filterFreq;
      if (rainGain) {
        rainGain.gain.setValueAtTime(settings.rainGain, ctx.currentTime);
        state.rainGain = settings.rainGain;
      }
    }

    isStarted = true;
    state.isPlaying = true;
    state.isStarted = true;
  }

  /**
   * Stop all audio playback and disconnect nodes.
   */
  function stop() {
    if (windSource) {
      try { windSource.stop(); } catch { /* may already have stopped */ }
      windSource.disconnect();
      windSource = null;
    }
    if (rainSource) {
      try { rainSource.stop(); } catch { /* may already have stopped */ }
      rainSource.disconnect();
      rainSource = null;
    }
    if (windFilter) { windFilter.disconnect(); windFilter = null; }
    if (rainFilter) { rainFilter.disconnect(); rainFilter = null; }
    if (windGain) { windGain.disconnect(); windGain = null; }
    if (rainGain) { rainGain.disconnect(); rainGain = null; }

    isStarted = false;
    state.isPlaying = false;
    state.isStarted = false;
  }

  /**
   * Update the audio character to match the current weather and time-of-day.
   *
   * @param {string} weatherPhase — 'Clear', 'Overcast', or 'Light Drizzle'
   * @param {string} [timeOfDay] — 'Morning'|'Midday'|'Evening'|'Night' (default 'Midday')
   */
  function update(weatherPhase, timeOfDay) {
    if (!windGain || !windFilter) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const fadeTime = 1.5; // seconds for smooth transition
    const settings = computeAudioSettings(weatherPhase, timeOfDay);

    windGain.gain.setTargetAtTime(settings.windGain, now, fadeTime);
    windFilter.frequency.setTargetAtTime(settings.filterFreq, now, fadeTime);
    state.windGain = settings.windGain;
    state.windFilterFrequency = settings.filterFreq;
    if (rainGain) {
      rainGain.gain.setTargetAtTime(settings.rainGain, now, fadeTime);
      state.rainGain = settings.rainGain;
    }
  }

  /**
   * Resume the AudioContext and start playback on first user interaction.
   * Safe to call multiple times — only resumes/starts once.
   */
  function resumeOnInteraction() {
    if (isStarted) return;
    const ctx = ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        start();
      }).catch(() => {
        // If resume fails, start anyway — some browsers allow it
        start();
      });
    } else {
      start();
    }
  }

  return { start, stop, update, resumeOnInteraction, state };
}