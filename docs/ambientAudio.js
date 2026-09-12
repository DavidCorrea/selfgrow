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

import { isReducedMotion } from "./motion.js";

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
 * Seasonal audio modifiers composed on top of time-of-day and weather.
 * Applied as multipliers to the time-of-day base before weather modifiers.
 *
 * Spring:  lighter, brighter breeze  — filter ~300Hz (Midday 400×0.75), wind 0.8×
 * Summer:  fuller, warmer wind        — filter ~450Hz (Midday 400×1.125), wind 1.0×
 * Autumn:  stronger, rustling wind    — filter ~280Hz (Midday 400×0.7), wind 1.3×, rain 1.1×
 * Winter:  hushed, near-stillness     — filter ~60Hz (Midday 400×0.15), wind 0.4×, rain 0.5×
 */
const SEASON_AUDIO_MODIFIERS = {
  'Spring': { filterMul: 0.75, windMul: 0.8,  rainMul: 1.0 },
  'Summer': { filterMul: 1.125, windMul: 1.0, rainMul: 1.0 },
  'Autumn': { filterMul: 0.7,   windMul: 1.3,  rainMul: 1.1 },
  'Winter': { filterMul: 0.15,  windMul: 0.4,  rainMul: 0.5 }
};

/** Default season modifier (no change) when season is omitted */
const DEFAULT_SEASON_MODIFIER = { filterMul: 1.0, windMul: 1.0, rainMul: 1.0 };

/* --- Cricket / nocturnal insect audio constants --- */

/**
 * Firefly density constants mirrored from fireflies.js.
 * Cricket density follows the same seasonal/weather modulation as firefly visibility
 * so the audio layer stays decoupled from firefly internals.
 */
const FIREFLY_SEASON_MULTIPLIERS = {
  'Spring': 0.53,
  'Summer': 1.0,
  'Autumn': 0.53,
  'Winter': 0.0
};

const FIREFLY_WEATHER_MULTIPLIERS = {
  'Clear': 1.0,
  'Overcast': 0.6,
  'Light Drizzle': 0.4
};

/** Default firefly weather multiplier for unknown weather */
const DEFAULT_FIREFLY_WEATHER_MUL = 1.0;

/** Default firefly season multiplier for unknown season */
const DEFAULT_FIREFLY_SEASON_MUL = 0.0;

/**
 * Pitch range for cricket chirps: 2000–4000 Hz.
 * Randomised per chirp within this band.
 */
const CRICKET_FREQ_MIN = 2000;
const CRICKET_FREQ_MAX = 4000;

/**
 * Chirp envelope timing (seconds).
 * Attack: very short ramp up, release: slightly longer decay.
 */
const CHIRP_ATTACK = 0.02;
const CHIRP_RELEASE = 0.10;
const CHIRP_TOTAL_DURATION = CHIRP_ATTACK + CHIRP_RELEASE; // 0.12s

/**
 * Maximum cricket chirp volume relative to current windGain.
 * ≤10% means barely perceptible atop the wind layer.
 */
const CRICKET_WIND_GAIN_RATIO = 0.10;

/**
 * Chirp scheduling: interval range in seconds.
 * At max density (densityFactor=1.0): meanInterval = MIN = 1s
 * At min density near-threshold: meanInterval = MAX = 4s
 * Above threshold density (densityFactor > 0.01): interval in [1s, 4s]
 */
const CHIRP_INTERVAL_MIN_S = 1.0;
const CHIRP_INTERVAL_MAX_S = 4.0;

/** Minimal density threshold below which crickets are silent */
const CRICKET_DENSITY_THRESHOLD = 0.01;

/**
 * Compute cricket density factor (0–1) from the same public parameters
 * that determine firefly visibility. Mirrors firefly density logic:
 *   density = seasonMultiplier × weatherMultiplier
 * Active only during Night phase. Winter always returns 0.
 *
 * @param {string} season — 'Spring'|'Summer'|'Autumn'|'Winter'
 * @param {string} weatherPhase — 'Clear'|'Overcast'|'Light Drizzle'
 * @param {string} timeOfDay — 'Morning'|'Midday'|'Evening'|'Night'
 * @returns {number} density factor in [0, 1]
 */
function computeCricketDensity(season, weatherPhase, timeOfDay) {
  // Only active during Night
  if (timeOfDay !== 'Night') return 0;

  // Derive density from firefly-visible parameters
  const seasonMul = FIREFLY_SEASON_MULTIPLIERS[season];
  if (seasonMul === undefined || seasonMul <= 0) return 0; // Winter or unknown season

  const weatherMul = FIREFLY_WEATHER_MULTIPLIERS[weatherPhase] !== undefined
    ? FIREFLY_WEATHER_MULTIPLIERS[weatherPhase]
    : DEFAULT_FIREFLY_WEATHER_MUL;

  // Summer Clear = 1.0 (max density)
  return seasonMul * weatherMul;
}

/**
 * Create and play a single cricket chirp burst on the given AudioContext.
 * Uses an oscillator (sine wave) with exponential envelope shaping.
 *
 * The chirp is scheduled precisely via `ctx.currentTime` offsets so that
 * multiple chirps can overlap naturally (rare at typical intervals).
 *
 * @param {AudioContext} ctx
 * @param {number} chirpGain — absolute gain value for this chirp (≤10% of windGain)
 * @returns {void}
 */
function playCricketChirp(ctx, chirpGain) {
  if (!ctx || chirpGain <= 0) return;

  const now = ctx.currentTime;

  // Randomised frequency within the cricket band
  const freq = CRICKET_FREQ_MIN + Math.random() * (CRICKET_FREQ_MAX - CRICKET_FREQ_MIN);

  // Create oscillator (sine wave for soft, insect-like tone)
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);

  // Create gain envelope
  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0, now);
  // Attack: ramp up
  envGain.gain.linearRampToValueAtTime(chirpGain, now + CHIRP_ATTACK);
  // Release: ramp down
  envGain.gain.linearRampToValueAtTime(0, now + CHIRP_TOTAL_DURATION);

  // Connect: oscillator → envelope → destination
  osc.connect(envGain);
  envGain.connect(ctx.destination);

  // Schedule start and stop
  osc.start(now);
  osc.stop(now + CHIRP_TOTAL_DURATION + 0.01); // slight extra to avoid click

  // Clean up nodes after playback completes
  osc.onended = function() {
    osc.disconnect();
    envGain.disconnect();
  };
}

/**
 * Compute composed audio settings from weather, time-of-day and season.
 *
 * Composition: base (time-of-day) × season modifier × weather modifier.
 *   windGain = base.windGain × season.windMul × weather.windMul
 *   filterFreq = base.filterFreq × season.filterMul × weather.filterMul
 *   rainGain = weather.rainBase × base.rainMul × season.rainMul
 *
 * @param {string} weatherPhase — 'Clear', 'Overcast', or 'Light Drizzle'
 * @param {string} [timeOfDay] — 'Morning'|'Midday'|'Evening'|'Night' (default 'Midday')
 * @param {string} [season] — 'Spring'|'Summer'|'Autumn'|'Winter' (default undefined → no seasonal modifier)
 * @returns {{ windGain: number, filterFreq: number, rainGain: number }}
 */
function computeAudioSettings(weatherPhase, timeOfDay, season) {
  const base = TIME_OF_DAY_AUDIO[timeOfDay] || TIME_OF_DAY_AUDIO['Midday'];
  const weatherMod = WEATHER_AUDIO_MODIFIERS[weatherPhase] || DEFAULT_WEATHER_MODIFIER;
  const seasonMod = SEASON_AUDIO_MODIFIERS[season] || DEFAULT_SEASON_MODIFIER;
  return {
    windGain: base.windGain * seasonMod.windMul * weatherMod.windMul,
    filterFreq: base.filterFreq * seasonMod.filterMul * weatherMod.filterMul,
    rainGain: weatherMod.rainBase * base.rainMul * seasonMod.rainMul
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

  /* --- Cricket scheduling state --- */
  let cricketEnabled = false;
  let cricketDensity = 0;           // 0–1, recomputed each update
  let cricketNextChirpTime = 0;     // performance.now() threshold for next chirp
  let cricketChirpInterval = 0;     // current interval in ms
  let cricketChirpCount = 0;        // total chirps played
  let _cricketReducedMotion = false; // cached reduced-motion check

  const state = {
    type: 'ambient-audio',
    windGain: 0,
    rainGain: 0,
    windFilterFrequency: 400,
    cricketDensity: 0,
    cricketEnabled: false,
    cricketChirpCount: 0,
    cricketChirpIntervalSec: 0,
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

    // Immediately read the current weather phase, time-of-day and season from the DOM
    // and apply them, so audio is correct from the moment it starts.
    const weatherEl = document.getElementById('weather-display');
    const timeEl = document.getElementById('time-display');
    const seasonEl = document.getElementById('season-display');
    const weatherPhase = weatherEl && weatherEl.textContent ? weatherEl.textContent.trim() : 'Clear';
    const timeOfDay = timeEl && timeEl.textContent ? timeEl.textContent.trim() : 'Midday';
    const season = seasonEl && seasonEl.textContent ? seasonEl.textContent.trim() : undefined;

    if (windGain && windFilter) {
      const settings = computeAudioSettings(weatherPhase, timeOfDay, season);
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
   * Update the audio character to match the current weather, time-of-day
   * and season. Also ticks the cricket chirp scheduler.
   *
   * Always records composed targets into state (so selftest can verify without
   * an AudioContext), then ramps the Web Audio nodes with setTargetAtTime when
   * they exist.
   *
   * @param {string} weatherPhase — 'Clear', 'Overcast', or 'Light Drizzle'
   * @param {string} [timeOfDay] — 'Morning'|'Midday'|'Evening'|'Night' (default 'Midday')
   * @param {string} [season] — 'Spring'|'Summer'|'Autumn'|'Winter' (default undefined → no seasonal modifier)
   */
  function update(weatherPhase, timeOfDay, season) {
    // Always compute and record composed targets into state first, so the
    // selftest can verify time+weather+season composition without an AudioContext.
    const settings = computeAudioSettings(weatherPhase, timeOfDay, season);
    state.windGain = settings.windGain;
    state.windFilterFrequency = settings.filterFreq;
    state.rainGain = settings.rainGain;

    // --- Cricket scheduling ---
    _cricketReducedMotion = isReducedMotion();

    cricketDensity = computeCricketDensity(season, weatherPhase, timeOfDay);
    state.cricketDensity = cricketDensity;

    const shouldBeEnabled = !_cricketReducedMotion && cricketDensity > CRICKET_DENSITY_THRESHOLD;

    if (shouldBeEnabled !== cricketEnabled) {
      cricketEnabled = shouldBeEnabled;
      state.cricketEnabled = shouldBeEnabled;
      if (!shouldBeEnabled) {
        cricketNextChirpTime = 0;
      } else {
        cricketNextChirpTime = performance.now();
      }
    }

    if (cricketEnabled) {
      const intervalSec = CHIRP_INTERVAL_MAX_S -
        (cricketDensity - CRICKET_DENSITY_THRESHOLD) / (1.0 - CRICKET_DENSITY_THRESHOLD) *
        (CHIRP_INTERVAL_MAX_S - CHIRP_INTERVAL_MIN_S);
      cricketChirpInterval = Math.max(CHIRP_INTERVAL_MIN_S, Math.min(CHIRP_INTERVAL_MAX_S, intervalSec)) * 1000;
      state.cricketChirpIntervalSec = cricketChirpInterval / 1000;

      const now = performance.now();
      if (cricketNextChirpTime > 0 && now >= cricketNextChirpTime) {
        if (windGain) {
          const ctx = ensureContext();
          if (ctx) {
            const chirpGain = state.windGain * CRICKET_WIND_GAIN_RATIO * cricketDensity;
            playCricketChirp(ctx, chirpGain);
            cricketChirpCount++;
            state.cricketChirpCount = cricketChirpCount;
          }
        }
        const jitter = cricketChirpInterval * (0.8 + Math.random() * 0.4);
        cricketNextChirpTime = now + jitter;
      }
    } else {
      state.cricketChirpIntervalSec = 0;
    }

    // Then ramp the Web Audio nodes when they exist (AudioContext available).
    if (!windGain || !windFilter) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const now2 = ctx.currentTime;
    const fadeTime = 1.5;

    windGain.gain.setTargetAtTime(settings.windGain, now2, fadeTime);
    windFilter.frequency.setTargetAtTime(settings.filterFreq, now2, fadeTime);
    if (rainGain) {
      rainGain.gain.setTargetAtTime(settings.rainGain, now2, fadeTime);
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

export { TIME_OF_DAY_AUDIO, WEATHER_AUDIO_MODIFIERS, SEASON_AUDIO_MODIFIERS, DEFAULT_WEATHER_MODIFIER, DEFAULT_SEASON_MODIFIER, FIREFLY_SEASON_MULTIPLIERS, FIREFLY_WEATHER_MULTIPLIERS };