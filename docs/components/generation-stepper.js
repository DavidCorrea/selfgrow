/**
 * <generation-stepper> — time-travel control for self-growing forms.
 *
 * Displays the current generation, offers step forward/back buttons,
 * a jump-to-generation input, and a play/pause auto-step toggle.
 *
 * Attributes:
 *   generation     — current generation number (default 0)
 *   max-generation — optional cap; auto-play pauses at this generation
 *   speed          — auto-step interval in milliseconds (default 500)
 *
 * Events:
 *   generation-change — { detail: { generation: number } }
 *
 * Keyboard (when focused or anywhere in the document):
 *   ArrowLeft  → step back
 *   ArrowRight → step forward
 *   Space      → toggle play/pause
 */
export class GenerationStepper extends HTMLElement {
  static attributes = ['generation', 'max-generation', 'speed'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._playing = false;
    this._timer = null;
    this._generation = 0;
    this._maxGeneration = null;
    this._speed = 500;
  }

  connectedCallback() {
    this._render();
    this._bindKeyboard();
  }

  disconnectedCallback() {
    this._unbindKeyboard();
    this._clearTimer();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'generation':
        this._generation = this._clampGeneration(Number(newValue) || 0);
        break;
      case 'max-generation':
        this._maxGeneration = newValue !== null ? Number(newValue) : null;
        break;
      case 'speed':
        this._speed = Math.max(50, Number(newValue) || 500);
        break;
    }

    this._updateDisplay();
    this._syncPlayState();
  }

  get generation() { return this._generation; }
  set generation(v) {
    this._generation = this._clampGeneration(Number(v) || 0);
    this.setAttribute('generation', this._generation);
  }

  get maxGeneration() { return this._maxGeneration; }
  set maxGeneration(v) {
    this._maxGeneration = v !== null && v !== undefined ? Number(v) : null;
    if (this._maxGeneration !== null) {
      this.setAttribute('max-generation', this._maxGeneration);
    } else {
      this.removeAttribute('max-generation');
    }
  }

  get speed() { return this._speed; }
  set speed(v) {
    this._speed = Math.max(50, Number(v) || 500);
    this.setAttribute('speed', this._speed);
    if (this._playing) {
      this._clearTimer();
      this._startTimer();
    }
  }

  get playing() { return this._playing; }
  set playing(v) {
    this._playing = !!v;
    this._syncPlayState();
  }

  // ── public actions ────────────────────────────────────────────

  stepForward() {
    this.generation = this._generation + 1;
    this._emitChange();
    this._checkMaxGeneration();
  }

  stepBackward() {
    this.generation = Math.max(0, this._generation - 1);
    this._emitChange();
  }

  jumpTo(value) {
    const g = Math.max(0, Math.floor(Number(value) || 0));
    this.generation = g;
    this._emitChange();
    this._checkMaxGeneration();
  }

  togglePlay() {
    this.playing = !this._playing;
  }

  // ── internals ─────────────────────────────────────────────────

  _clampGeneration(v) {
    if (this._maxGeneration !== null && v > this._maxGeneration) {
      return this._maxGeneration;
    }
    return Math.max(0, v);
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent('generation-change', {
        detail: { generation: this._generation },
        bubbles: true,
        composed: true,
      })
    );
  }

  _checkMaxGeneration() {
    if (this._maxGeneration !== null && this._generation >= this._maxGeneration) {
      this.playing = false;
    }
  }

  _startTimer() {
    this._clearTimer();
    this._timer = setInterval(() => {
      if (this._maxGeneration !== null && this._generation >= this._maxGeneration) {
        this.playing = false;
        return;
      }
      this.stepForward();
    }, this._speed);
  }

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _syncPlayState() {
    const btn = this.shadowRoot?.querySelector('[data-action="toggle-play"]');
    if (!btn) return;
    if (this._playing) {
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = 'Pause';
      this._startTimer();
    } else {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Play';
      this._clearTimer();
    }
  }

  _updateDisplay() {
    const display = this.shadowRoot?.querySelector('[data-gen-display]');
    const input = this.shadowRoot?.querySelector('[data-jump-input]');
    if (display) display.textContent = this._generation;
    if (input && document.activeElement !== input) input.value = this._generation;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 1rem 1.25rem;
          margin: 1.5rem 0 1rem;
          border: 1px solid var(--rule, #cfcbc2);
          border-radius: 8px;
          background: var(--paper, #f7f6f3);
          color: var(--ink, #1a1a1a);
          font: 0.9375rem/1.5 ui-sans-serif, system-ui, sans-serif;
        }

        .stepper {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
        }

        .gen-display {
          font-size: 1.125rem;
          font-weight: 600;
          min-width: 3ch;
          text-align: center;
        }

        .gen-label {
          color: var(--ink-soft, #4a4a4a);
          font-size: 0.8125rem;
          margin-right: 0.25rem;
          user-select: none;
        }

        button {
          padding: 0.35rem 0.75rem;
          border: 1px solid var(--rule, #cfcbc2);
          border-radius: 4px;
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
          transition: background 120ms ease;
        }

        button:hover,
        button:focus-visible {
          background: var(--rule, #cfcbc2);
          outline: none;
        }

        button:focus-visible {
          box-shadow: 0 0 0 2px var(--ink, #1a1a1a);
        }

        .jump {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          margin-left: auto;
        }

        .jump label {
          font-size: 0.8125rem;
          color: var(--ink-soft, #4a4a4a);
          white-space: nowrap;
        }

        .jump input {
          width: 5ch;
          padding: 0.3rem 0.4rem;
          border: 1px solid var(--rule, #cfcbc2);
          border-radius: 4px;
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: center;
        }

        .jump input:focus-visible {
          outline: 2px solid var(--ink, #1a1a1a);
          outline-offset: 1px;
        }

        [data-action="toggle-play"] {
          padding: 0.35rem 0.65rem;
        }

        @media (max-width: 480px) {
          .stepper { flex-direction: column; align-items: stretch; }
          .jump { margin-left: 0; justify-content: flex-end; }
        }
      </style>
      <div class="stepper">
        <button data-action="step-back" aria-label="Step to previous generation">&larr;</button>
        <span class="gen-label">Gen</span>
        <span class="gen-display" data-gen-display aria-live="polite">${this._generation}</span>
        <button data-action="step-forward" aria-label="Step to next generation">&rarr;</button>
        <span class="jump">
          <label for="jump-input">Jump</label>
          <input id="jump-input" data-jump-input type="number" min="0" value="${this._generation}" aria-label="Jump to generation" />
        </span>
        <button data-action="toggle-play" aria-pressed="false" aria-label="Toggle auto-play">Play</button>
      </div>
    `;

    this._wireEvents();
  }

  _wireEvents() {
    const root = this.shadowRoot;

    root.querySelector('[data-action="step-back"]').addEventListener('click', () => this.stepBackward());
    root.querySelector('[data-action="step-forward"]').addEventListener('click', () => this.stepForward());
    root.querySelector('[data-action="toggle-play"]').addEventListener('click', () => this.togglePlay());

    const jumpInput = root.querySelector('[data-jump-input]');
    jumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.jumpTo(jumpInput.value);
        jumpInput.blur();
      }
    });
    jumpInput.addEventListener('blur', () => {
      this.jumpTo(jumpInput.value);
    });
  }

  _bindKeyboard() {
    this._onKeyDown = this._handleKeydown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  _unbindKeyboard() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  _handleKeydown(e) {
    // Don't intercept when focus is inside the stepper — its own
    // controls (buttons, input) handle their keys natively.
    const active = document.activeElement;
    const isInStepper = this.shadowRoot?.contains(active) || this === active;
    if (isInStepper) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.stepBackward();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.stepForward();
        break;
      case ' ':
        e.preventDefault();
        this.togglePlay();
        break;
    }
  }
}

customElements.define('generation-stepper', GenerationStepper);
