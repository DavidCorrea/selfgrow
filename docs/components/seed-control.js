/**
 * <seed-control> — Seed control component for selfgrow.
 *
 * Displays the current seed (32-bit unsigned integer), with controls to:
 * - Randomize: generate a new random seed
 * - Copy link: copy current URL with ?seed=<value> to clipboard
 *
 * Reads initial seed from:
 *   1. `seed` attribute on the element (if valid 32-bit uint)
 *   2. `?seed=` URL query parameter (if valid)
 *   3. Random 32-bit unsigned integer (fallback)
 *
 * Emits 'seed-change' CustomEvent with { detail: { seed: number } } on any seed change.
 * Reflects current seed as 'seed' attribute (string) for CSS/selectors.
 * Supports 'disabled' attribute to disable controls.
 *
 * @element seed-control
 * @attr {string} seed - Current seed as string (reflected)
 * @attr {boolean} disabled - Disables buttons when present
 * @fires seed-change - CustomEvent<{ seed: number }> when seed changes
 * @cssprop --seed-control-bg - Background color
 * @cssprop --seed-control-color - Text color
 * @cssprop --seed-control-border - Border color
 * @cssprop --seed-control-btn-bg - Button background
 * @cssprop --seed-control-btn-hover - Button hover background
 * @cssprop --seed-control-btn-color - Button text color
 * @cssprop --seed-control-input-bg - Input background
 * @cssprop --seed-control-input-color - Input text color
 * @cssprop --seed-control-input-border - Input border color
 * @cssprop --seed-control-font - Font family
 * @cssprop --seed-control-radius - Border radius
 * @cssprop --seed-control-gap - Gap between elements
 * @cssprop --seed-control-padding - Padding
 */
class SeedControl extends HTMLElement {
  static get observedAttributes() {
    return ['seed', 'disabled'];
  }

  #seed = 0;
  #input = null;
  #randomizeBtn = null;
  #copyBtn = null;
  #copyTimeout = null;

  static #randomSeed() {
    // 32-bit unsigned integer (0 to 2^32 - 1)
    return Math.floor(Math.random() * 0x100000000);
  }

  static #parseSeed(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= 0x100000000) {
      return null;
    }
    return parsed;
  }

  static #getUrlSeed() {
    try {
      const params = new URLSearchParams(window.location.search);
      const seedParam = params.get('seed');
      if (seedParam !== null) {
        const parsed = SeedControl.#parseSeed(seedParam);
        if (parsed !== null) {
          return parsed;
        }
      }
    } catch {
      // URL parsing failed, fall through to random
    }
    return null;
  }

  static #updateUrlSeed(seed) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(seed));
      window.history.replaceState({}, '', url);
    } catch {
      // Ignore URL update failures (e.g., file:// protocol)
    }
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Initialize seed from attribute, URL, or random
    const attrSeed = this.getAttribute('seed');
    let initialSeed = null;

    if (attrSeed !== null) {
      initialSeed = SeedControl.#parseSeed(attrSeed);
    }

    if (initialSeed === null) {
      initialSeed = SeedControl.#getUrlSeed();
    }

    if (initialSeed === null) {
      initialSeed = SeedControl.#randomSeed();
    }

    this.#seed = initialSeed;
    this.#render();
    this.#syncUrl();
  }

  connectedCallback() {
    this.#randomizeBtn?.addEventListener('click', this.#handleRandomize.bind(this));
    this.#copyBtn?.addEventListener('click', this.#handleCopy.bind(this));
    this.#input?.addEventListener('change', this.#handleInputChange.bind(this));
    this.#input?.addEventListener('keydown', this.#handleInputKeydown.bind(this));
  }

  disconnectedCallback() {
    this.#randomizeBtn?.removeEventListener('click', this.#handleRandomize.bind(this));
    this.#copyBtn?.removeEventListener('click', this.#handleCopy.bind(this));
    this.#input?.removeEventListener('change', this.#handleInputChange.bind(this));
    this.#input?.removeEventListener('keydown', this.#handleInputKeydown.bind(this));
    if (this.#copyTimeout) {
      clearTimeout(this.#copyTimeout);
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'seed' && oldValue !== newValue && newValue !== null) {
      const parsed = SeedControl.#parseSeed(newValue);
      if (parsed !== null && parsed !== this.#seed) {
        this.#seed = parsed;
        this.#updateInput();
        this.#syncUrl();
        this.#dispatchChange();
      }
    }
    if (name === 'disabled') {
      this.#updateDisabledState();
    }
  }

  #render() {
    const disabled = this.hasAttribute('disabled');
    const disabledAttr = disabled ? 'disabled' : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          gap: var(--seed-control-gap, 0.5rem);
          padding: var(--seed-control-padding, 0.5rem 0.75rem);
          background: var(--seed-control-bg, var(--paper, #fafafa));
          color: var(--seed-control-color, var(--ink, #1a1a1a));
          border: 1px solid var(--seed-control-border, var(--rule, #ddd));
          border-radius: var(--seed-control-radius, 0.5rem);
          font-family: var(--seed-control-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
          font-size: 0.875rem;
          line-height: 1.4;
        }
        :host([disabled]) {
          opacity: 0.6;
          pointer-events: none;
        }
        .seed-control__label {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--ink-soft, #666);
          white-space: nowrap;
        }
        .seed-control__input {
          width: 10ch;
          padding: 0.25rem 0.5rem;
          background: var(--seed-control-input-bg, var(--paper, #fff));
          color: var(--seed-control-input-color, var(--ink, #1a1a1a));
          border: 1px solid var(--seed-control-input-border, var(--rule, #ddd));
          border-radius: calc(var(--seed-control-radius, 0.5rem) / 2);
          font: inherit;
          text-align: right;
        }
        .seed-control__input:focus {
          outline: none;
          border-color: var(--ink, #1a1a1a);
          box-shadow: 0 0 0 2px var(--ink, #1a1a1a);
        }
        .seed-control__btn {
          padding: 0.25rem 0.625rem;
          background: var(--seed-control-btn-bg, var(--ink, #1a1a1a));
          color: var(--seed-control-btn-color, var(--paper, #fafafa));
          border: none;
          border-radius: calc(var(--seed-control-radius, 0.5rem) / 2);
          font: inherit;
          font-size: 0.75rem;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s ease, opacity 0.15s ease;
        }
        .seed-control__btn:hover:not(:disabled) {
          background: var(--seed-control-btn-hover, #333);
        }
        .seed-control__btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--ink, #1a1a1a);
        }
        .seed-control__btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .seed-control__copy-feedback {
          font-size: 0.7rem;
          color: var(--ink-soft, #666);
          min-width: 4.5em;
          text-align: left;
          transition: opacity 0.15s ease;
        }
        .seed-control__copy-feedback--visible {
          color: var(--success, #2e7d32);
        }
      </style>
      <span class="seed-control__label" aria-hidden="true">Seed</span>
      <input
        type="text"
        class="seed-control__input"
        inputmode="numeric"
        pattern="[0-9]*"
        value="${this.#seed}"
        aria-label="Seed value (32-bit unsigned integer)"
        ${disabledAttr}
        readonly
      />
      <button
        type="button"
        class="seed-control__btn seed-control__btn--randomize"
        aria-label="Generate random seed"
        ${disabledAttr}
      >
        Randomize
      </button>
      <button
        type="button"
        class="seed-control__btn seed-control__btn--copy"
        aria-label="Copy link with current seed"
        ${disabledAttr}
      >
        Copy link
      </button>
      <span class="seed-control__copy-feedback" aria-live="polite" aria-atomic="true"></span>
    `;

    this.#input = this.shadowRoot.querySelector('.seed-control__input');
    this.#randomizeBtn = this.shadowRoot.querySelector('.seed-control__btn--randomize');
    this.#copyBtn = this.shadowRoot.querySelector('.seed-control__btn--copy');
  }

  #updateInput() {
    if (this.#input) {
      this.#input.value = String(this.#seed);
    }
  }

  #updateDisabledState() {
    const disabled = this.hasAttribute('disabled');
    this.#randomizeBtn?.toggleAttribute('disabled', disabled);
    this.#copyBtn?.toggleAttribute('disabled', disabled);
    this.#input?.toggleAttribute('disabled', disabled);
  }

  #syncUrl() {
    SeedControl.#updateUrlSeed(this.#seed);
  }

  #dispatchChange() {
    this.dispatchEvent(new CustomEvent('seed-change', {
      detail: { seed: this.#seed },
      bubbles: true,
      composed: true
    }));
    // Reflect to attribute for CSS selectors / external observation
    this.setAttribute('seed', String(this.#seed));
  }

  #handleRandomize() {
    this.#seed = SeedControl.#randomSeed();
    this.#updateInput();
    this.#syncUrl();
    this.#dispatchChange();
  }

  async #handleCopy() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(this.#seed));
      await navigator.clipboard.writeText(url.href);
      this.#showCopyFeedback('Copied!');
    } catch {
      this.#showCopyFeedback('Failed');
    }
  }

  #handleInputChange() {
    const value = this.#input?.value.trim();
    if (!value) return;

    const parsed = SeedControl.#parseSeed(value);
    if (parsed !== null && parsed !== this.#seed) {
      this.#seed = parsed;
      this.#syncUrl();
      this.#dispatchChange();
    } else {
      this.#updateInput(); // Reset to current valid seed
    }
  }

  #handleInputKeydown(event) {
    if (event.key === 'Enter') {
      this.#handleInputChange();
      this.#input?.blur();
    } else if (event.key === 'Escape') {
      this.#updateInput();
      this.#input?.blur();
    }
  }

  #showCopyFeedback(message) {
    const feedback = this.shadowRoot.querySelector('.seed-control__copy-feedback');
    if (!feedback) return;

    feedback.textContent = message;
    feedback.classList.add('seed-control__copy-feedback--visible');

    if (this.#copyTimeout) {
      clearTimeout(this.#copyTimeout);
    }

    this.#copyTimeout = setTimeout(() => {
      feedback.classList.remove('seed-control__copy-feedback--visible');
      this.#copyTimeout = null;
    }, 1500);
  }

  // Public API
  get seed() {
    return this.#seed;
  }

  set seed(value) {
    const parsed = SeedControl.#parseSeed(value);
    if (parsed !== null && parsed !== this.#seed) {
      this.#seed = parsed;
      this.#updateInput();
      this.#syncUrl();
      this.#dispatchChange();
    }
  }

  randomize() {
    this.#handleRandomize();
  }

  async copyLink() {
    await this.#handleCopy();
  }
}

if (!customElements.get('seed-control')) {
  customElements.define('seed-control', SeedControl);
}

export { SeedControl };