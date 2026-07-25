/**
 * <seed-control> — editable seed with randomization, copy link, and URL sync.
 *
 * Attributes:
 *   seed — JSON string representing the current seed (reflects the `seed` property)
 *
 * Properties:
 *   seed — the current seed value (any JSON-serializable value; null/undefined for empty)
 *
 * Events:
 *   seed-change — { detail: { seed: any } } — fires whenever the seed value changes
 *     (via user edit, randomize, clear, or URL sync). Does NOT fire on programmatic `seed` property set.
 *
 * Attributes (observed): ['seed']
 *
 * Behavior:
 *   - On load, reads `?seed=` from URL query parameter (JSON-parsed) and emits seed-change.
 *   - If no seed in URL, generates a random 32-bit integer seed and emits seed-change.
 *   - "Randomize" button generates a new random 32-bit integer seed.
 *   - "Copy link" button copies current URL with `?seed=<value>` to clipboard.
 *   - Textarea accepts any JSON-serializable value; live validation with inline error.
 *   - Ctrl+Enter in textarea applies the seed; Escape reverts to last valid seed.
 *   - Keyboard shortcuts (when focused, not in textarea): R = randomize, Delete/Backspace = clear.
 *
 * ARIA:
 *   - textarea has aria-label="Seed JSON" and aria-describedby for validation message
 *   - buttons have aria-label
 *   - validation message has role="alert"/"status" and aria-live="polite"
 */
export class SeedControl extends HTMLElement {
  static observedAttributes = ['seed'];

  #seed = null; // any JSON-serializable value; null = empty
  #lastValidSeed = null; // last successfully parsed seed
  #textarea = null;
  #validationEl = null;
  #randomizeBtn = null;
  #copyLinkBtn = null;
  #clearBtn = null;
  #keydownHandler = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.#keydownHandler = this.#handleKeydown.bind(this);
  }

  // ─── attribute handling ────────────────────────────────────────

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'seed' && oldValue !== newValue) {
      // Attribute changed externally (e.g., via setAttribute or HTML attribute)
      // Parse and apply, but don't emit seed-change (that's for user actions)
      if (newValue === null || newValue === '') {
        this.#seed = null;
        this.#lastValidSeed = null;
      } else {
        try {
          this.#seed = JSON.parse(newValue);
          this.#lastValidSeed = structuredClone(this.#seed);
        } catch {
          // Invalid JSON in attribute — treat as empty, but don't throw
          this.#seed = null;
          this.#lastValidSeed = null;
        }
      }
      this.#updateUI();
    }
  }

  // ─── property reflection ────────────────────────────────────────

  get seed() {
    return this.#seed;
  }

  set seed(value) {
    // Programmatic set — reflect to attribute but DON'T emit seed-change
    if (value === null || value === undefined) {
      this.#seed = null;
      this.#lastValidSeed = null;
      this.removeAttribute('seed');
    } else {
      try {
        // Validate by serializing
        const json = JSON.stringify(value);
        this.#seed = structuredClone(value);
        this.#lastValidSeed = structuredClone(value);
        this.setAttribute('seed', json);
      } catch {
        throw new TypeError('seed must be JSON-serializable');
      }
    }
    this.#updateUI();
  }

  // ─── lifecycle ──────────────────────────────────────────────────

  connectedCallback() {
    this.#render();
    this.#bindEvents();
    this.#updateUI();
    this.addEventListener('keydown', this.#keydownHandler);
    // Initialize from URL or generate random seed
    this.#initializeFromUrlOrRandom();
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#keydownHandler);
    this.#unbindEvents();
  }

  // ─── rendering ──────────────────────────────────────────────────

  #render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: ui-sans-serif, system-ui, sans-serif;
          color: var(--ink, #1a1a1a);
          background: var(--paper, #f7f6f3);
          border: 1px solid var(--rule, #cfcbc2);
          border-radius: 8px;
          padding: 1rem 1.25rem;
          margin: 1rem 0;
        }

        .seed-control {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
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

        button[aria-pressed="true"] {
          background: var(--ink, #1a1a1a);
          color: var(--paper, #f7f6f3);
          border-color: var(--ink, #1a1a1a);
        }

        button[aria-pressed="true"]:hover,
        button[aria-pressed="true"]:focus-visible {
          background: var(--ink-soft, #4a4a4a);
          border-color: var(--ink-soft, #4a4a4a);
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .seed-input {
          flex: 1;
          min-width: 0;
        }

        .seed-input textarea {
          width: 100%;
          min-height: 6rem;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--rule, #cfcbc2);
          border-radius: 4px;
          background: transparent;
          color: inherit;
          font: 0.8125rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          resize: vertical;
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }

        .seed-input textarea:focus-visible {
          outline: none;
          border-color: var(--ink, #1a1a1a);
          box-shadow: 0 0 0 2px var(--ink, #1a1a1a);
        }

        .seed-input textarea[aria-invalid="true"] {
          border-color: #c00;
        }

        .seed-input textarea[aria-invalid="true"]:focus-visible {
          border-color: #c00;
          box-shadow: 0 0 0 2px #c00;
        }

        .hint {
          font-size: 0.75rem;
          color: var(--ink-soft, #4a4a4a);
          margin-top: 0.25rem;
        }

        .validation {
          min-height: 1.25rem;
          font-size: 0.8125rem;
          line-height: 1.5;
        }

        .validation[role="alert"] {
          color: #c00;
        }

        .validation:not([role="alert"]) {
          color: var(--ink-soft, #4a4a4a);
        }

        .validation .valid {
          color: #080;
        }

        .toolbar-spacer {
          flex: 1;
        }

        @media (max-width: 480px) {
          .toolbar {
            flex-direction: column;
            align-items: stretch;
          }
          .toolbar button {
            width: 100%;
            justify-content: center;
          }
          .toolbar-spacer {
            display: none;
          }
        }
      </style>
      <div class="seed-control">
        <div class="toolbar">
          <button id="randomize-btn" type="button" aria-label="Generate random 32-bit seed (R)">Randomize</button>
          <button id="copy-link-btn" type="button" aria-label="Copy link with current seed">Copy link</button>
          <button id="clear-btn" type="button" aria-label="Clear seed (Delete/Backspace)">Clear</button>
          <span class="toolbar-spacer"></span>
          <span class="hint" id="keyboard-hint">Ctrl+Enter to apply · Esc to revert · R to randomize · Del to clear</span>
        </div>

        <div class="seed-input">
          <textarea
            id="seed-textarea"
            aria-label="Seed JSON"
            aria-describedby="validation-msg"
            spellcheck="false"
            aria-invalid="false"
          ></textarea>
        </div>

        <div
          id="validation-msg"
          class="validation"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="valid">✓ Valid JSON</span>
        </div>
      </div>
    `;

    this.#textarea = this.shadowRoot.getElementById('seed-textarea');
    this.#validationEl = this.shadowRoot.getElementById('validation-msg');
    this.#randomizeBtn = this.shadowRoot.getElementById('randomize-btn');
    this.#copyLinkBtn = this.shadowRoot.getElementById('copy-link-btn');
    this.#clearBtn = this.shadowRoot.getElementById('clear-btn');
  }

  #updateUI() {
    if (!this.#textarea) return;

    // Update textarea value
    const jsonStr = this.#seed === null || this.#seed === undefined
      ? ''
      : JSON.stringify(this.#seed, null, 2);
    if (this.#textarea.value !== jsonStr) {
      this.#textarea.value = jsonStr;
    }

    // Update validation message
    this.#updateValidation();

    // Update button states
    this.#clearBtn.disabled = this.#seed === null || this.#seed === undefined;
    this.#randomizeBtn.disabled = false;
    this.#copyLinkBtn.disabled = false;
  }

  #updateValidation() {
    if (!this.#validationEl || !this.#textarea) return;

    const value = this.#textarea.value.trim();
    if (value === '') {
      this.#validationEl.innerHTML = '<span class="valid">✓ Empty seed (null)</span>';
      this.#validationEl.setAttribute('role', 'status');
      this.#textarea.setAttribute('aria-invalid', 'false');
      return;
    }

    try {
      JSON.parse(value);
      this.#validationEl.innerHTML = '<span class="valid">✓ Valid JSON</span>';
      this.#validationEl.setAttribute('role', 'status');
      this.#textarea.setAttribute('aria-invalid', 'false');
    } catch (e) {
      this.#validationEl.innerHTML = `<span>✗ Invalid JSON: ${e.message}</span>`;
      this.#validationEl.setAttribute('role', 'alert');
      this.#textarea.setAttribute('aria-invalid', 'true');
    }
  }

  // ─── event binding ──────────────────────────────────────────────

  #bindEvents() {
    // Textarea input — live validation
    this.#textarea.addEventListener('input', () => this.#updateValidation());

    // Textarea keydown — Ctrl+Enter to apply, Esc to revert
    this.#textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.#applySeed();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.#revertSeed();
      }
    });

    // Textarea blur — validate but don't auto-apply
    this.#textarea.addEventListener('blur', () => this.#updateValidation());

    // Randomize button
    this.#randomizeBtn.addEventListener('click', () => this.randomize());

    // Copy link button
    this.#copyLinkBtn.addEventListener('click', () => this.copyLink());

    // Clear button
    this.#clearBtn.addEventListener('click', () => this.clear());

    // Keyboard hint visibility (hide on focus in textarea)
    this.#textarea.addEventListener('focus', () => {
      const hint = this.shadowRoot.getElementById('keyboard-hint');
      if (hint) hint.style.opacity = '0.5';
    });
    this.#textarea.addEventListener('blur', () => {
      const hint = this.shadowRoot.getElementById('keyboard-hint');
      if (hint) hint.style.opacity = '1';
    });
  }

  #unbindEvents() {
    // No persistent external listeners to clean up besides the keydown on host
  }

  // ─── keyboard handling (host-level) ─────────────────────────────

  #handleKeydown(e) {
    // Don't intercept if focus is inside the textarea
    if (this.#textarea === document.activeElement) return;

    // Only handle keys when the component has focus or is focused within
    const focused = document.activeElement;
    const isInComponent = this.shadowRoot?.contains(focused) || this === focused;
    if (!isInComponent) return;

    switch (e.key) {
      case 'r':
      case 'R':
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this.randomize();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this.clear();
        }
        break;
    }
  }

  // ─── initialization ─────────────────────────────────────────────

  #initializeFromUrlOrRandom() {
    const urlParams = new URLSearchParams(window.location.search);
    const seedParam = urlParams.get('seed');

    if (seedParam !== null) {
      // Seed provided in URL — try to parse it
      try {
        const parsed = JSON.parse(decodeURIComponent(seedParam));
        this.#seed = parsed;
        this.#lastValidSeed = structuredClone(parsed);
        this.setAttribute('seed', JSON.stringify(parsed));
        this.#updateUI();
        this.#emitSeedChange();
      } catch {
        // Invalid seed in URL — fall back to random
        this.#generateAndSetRandomSeed();
      }
    } else {
      // No seed in URL — generate random
      this.#generateAndSetRandomSeed();
    }
  }

  #generateAndSetRandomSeed() {
    const newSeed = this.#generateRandomSeed();
    this.#seed = newSeed;
    this.#lastValidSeed = structuredClone(newSeed);
    this.setAttribute('seed', JSON.stringify(newSeed));
    this.#updateUI();
    this.#emitSeedChange();
  }

  // ─── actions ────────────────────────────────────────────────────

  /**
   * Apply the current textarea value as the new seed.
   * Emits seed-change if valid and different from current seed.
   */
  #applySeed() {
    const value = this.#textarea.value.trim();
    let newSeed;

    if (value === '') {
      newSeed = null;
    } else {
      try {
        newSeed = JSON.parse(value);
      } catch {
        // Invalid — validation will show error, don't apply
        return;
      }
    }

    // Check if seed actually changed (deep equality via JSON)
    const oldJson = JSON.stringify(this.#seed);
    const newJson = JSON.stringify(newSeed);
    if (oldJson === newJson) return;

    this.#seed = newSeed;
    this.#lastValidSeed = newSeed !== null ? structuredClone(newSeed) : null;

    // Reflect to attribute (JSON string or remove)
    if (this.#seed === null) {
      this.removeAttribute('seed');
    } else {
      this.setAttribute('seed', JSON.stringify(this.#seed));
    }

    this.#updateUI();
    this.#emitSeedChange();
  }

  /** Revert textarea to last valid seed */
  #revertSeed() {
    const jsonStr = this.#lastValidSeed === null
      ? ''
      : JSON.stringify(this.#lastValidSeed, null, 2);
    this.#textarea.value = jsonStr;
    this.#updateValidation();
  }

  /** Generate a random 32-bit integer seed and apply it */
  randomize() {
    const newSeed = this.#generateRandomSeed();
    this.#seed = newSeed;
    this.#lastValidSeed = structuredClone(newSeed);

    // Reflect to attribute
    this.setAttribute('seed', JSON.stringify(this.#seed));

    this.#updateUI();
    this.#emitSeedChange();

    // Focus textarea for immediate editing
    this.#textarea.focus();
  }

  /** Copy current URL with ?seed= query parameter to clipboard */
  async copyLink() {
    const url = new URL(window.location.href);
    if (this.#seed === null || this.#seed === undefined) {
      url.searchParams.delete('seed');
    } else {
      url.searchParams.set('seed', JSON.stringify(this.#seed));
    }

    try {
      await navigator.clipboard.writeText(url.toString());
      // Visual feedback
      const originalText = this.#copyLinkBtn.textContent;
      this.#copyLinkBtn.textContent = 'Copied!';
      this.#copyLinkBtn.setAttribute('aria-pressed', 'true');
      setTimeout(() => {
        this.#copyLinkBtn.textContent = originalText;
        this.#copyLinkBtn.setAttribute('aria-pressed', 'false');
      }, 1500);
    } catch (e) {
      // Clipboard API failed — could show error toast, but silently fail for now
      console.warn('Failed to copy link:', e);
    }
  }

  /** Clear the seed (set to null) */
  clear() {
    if (this.#seed === null || this.#seed === undefined) return;

    this.#seed = null;
    this.#lastValidSeed = null;
    this.removeAttribute('seed');
    this.#updateUI();
    this.#emitSeedChange();
  }

  /** Generate a random 32-bit integer seed */
  #generateRandomSeed() {
    // 32-bit signed integer: -2147483648 to 2147483647
    return Math.floor(Math.random() * 4294967296) - 2147483648;
  }

  /** Emit seed-change event with new seed */
  #emitSeedChange() {
    this.dispatchEvent(new CustomEvent('seed-change', {
      detail: { seed: this.#seed },
      bubbles: true,
      composed: true,
    }));
  }
}

customElements.define('seed-control', SeedControl);