/**
 * ambientAudio.js — selfgrow procedural ambient wind audio
 *
 * Generates a barely-there continuous wind sound using the Web Audio API.
 * No external audio assets needed — all sound is synthesized from noise buffers.
 *
 * The sound shifts character with the garden's weather:
 *  - Clear:    gentle whoosh, wind gain ≤ 0.08, filter ~400 Hz
 *  - Overcast: stronger gusts, wind gain ~0.12, filter ~180 Hz (darker tone)
 *  - Light Drizzle: faint wind + added rain-like noise layer at gain ≤ 0.04
 *
 * AudioContext is created on module load but only resumed and started
 * on first user interaction (click/tap) to comply with autoplay policies.
 *
 * Exports:
 *   createAmbientAudio() → { start, stop, update(weatherPhase), resumeOnInteraction, state }
 */

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

    // Immediately read the current weather phase from the DOM and apply it
    // so audio is correct from the moment it starts, not just after the next poll.
    const weatherEl = document.getElementById('weather-display');
    if (weatherEl && weatherEl.textContent) {
      const phase = weatherEl.textContent.trim();
      // Apply instantly (no ramp) for the initial set
      if (windGain && windFilter) {
        switch (phase) {
          case 'Clear':
            windGain.gain.setValueAtTime(0.08, ctx.currentTime);
            windFilter.frequency.setValueAtTime(400, ctx.currentTime);
            state.windGain = 0.08;
            state.windFilterFrequency = 400;
            if (rainGain) rainGain.gain.setValueAtTime(0, ctx.currentTime);
            state.rainGain = 0;
            break;
          case 'Overcast':
            windGain.gain.setValueAtTime(0.12, ctx.currentTime);
            windFilter.frequency.setValueAtTime(180, ctx.currentTime);
            state.windGain = 0.12;
            state.windFilterFrequency = 180;
            if (rainGain) rainGain.gain.setValueAtTime(0, ctx.currentTime);
            state.rainGain = 0;
            break;
          case 'Light Drizzle':
            windGain.gain.setValueAtTime(0.08, ctx.currentTime);
            windFilter.frequency.setValueAtTime(250, ctx.currentTime);
            state.windGain = 0.08;
            state.windFilterFrequency = 250;
            if (rainGain) rainGain.gain.setValueAtTime(0.04, ctx.currentTime);
            state.rainGain = 0.04;
            break;
          default:
            windGain.gain.setValueAtTime(0.08, ctx.currentTime);
            windFilter.frequency.setValueAtTime(400, ctx.currentTime);
            state.windGain = 0.08;
            state.windFilterFrequency = 400;
            if (rainGain) rainGain.gain.setValueAtTime(0, ctx.currentTime);
            state.rainGain = 0;
        }
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
   * Update the audio character to match the current weather phase.
   *
   * @param {string} weatherPhase — 'Clear', 'Overcast', or 'Light Drizzle'
   */
  function update(weatherPhase) {
    if (!windGain || !windFilter) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const fadeTime = 1.5; // seconds for smooth transition

    switch (weatherPhase) {
      case 'Clear':
        windGain.gain.setTargetAtTime(0.08, now, fadeTime);
        windFilter.frequency.setTargetAtTime(400, now, fadeTime);
        state.windGain = 0.08;
        state.windFilterFrequency = 400;
        if (rainGain) {
          rainGain.gain.setTargetAtTime(0, now, fadeTime);
          state.rainGain = 0;
        }
        break;

      case 'Overcast':
        windGain.gain.setTargetAtTime(0.12, now, fadeTime);
        windFilter.frequency.setTargetAtTime(180, now, fadeTime);
        state.windGain = 0.12;
        state.windFilterFrequency = 180;
        if (rainGain) {
          rainGain.gain.setTargetAtTime(0, now, fadeTime);
          state.rainGain = 0;
        }
        break;

      case 'Light Drizzle':
        windGain.gain.setTargetAtTime(0.08, now, fadeTime);
        windFilter.frequency.setTargetAtTime(250, now, fadeTime);
        state.windGain = 0.08;
        state.windFilterFrequency = 250;
        if (rainGain) {
          rainGain.gain.setTargetAtTime(0.04, now, fadeTime);
          state.rainGain = 0.04;
        }
        break;

      default:
        // Unknown phase — default to Clear
        windGain.gain.setTargetAtTime(0.08, now, fadeTime);
        windFilter.frequency.setTargetAtTime(400, now, fadeTime);
        state.windGain = 0.08;
        state.windFilterFrequency = 400;
        if (rainGain) {
          rainGain.gain.setTargetAtTime(0, now, fadeTime);
          state.rainGain = 0;
        }
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