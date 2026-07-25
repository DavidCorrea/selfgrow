/**
 * <property-checks> – displays a specimen's declared invariants and their
 * pass/fail status for the current generation.
 *
 * Properties (set via JS):
 *   checks: Array<{name:string, check:function(form, generation):boolean}>
 *   form: any – the current grown form (output of grow)
 *   generation: number – current generation number
 *
 * Attributes:
 *   generation – number (reflects the generation property)
 *
 * Events:
 *   listens for 'generation-change' bubbles (from <generation-stepper>)
 *   and updates its generation accordingly.
 *
 * Internal:
 *   - re-evaluates all checks whenever form, generation, or checks change.
 *   - displays each property name with a check (✅) or cross (❌).
 *   - provides a "Re‑check all" button to manually recompute.
 */
export class PropertyChecks extends HTMLElement {
  static observedAttributes = ['generation'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._generation = 0;
    this._form = null;
    this._checks = []; // array of {name, check}
    this._results = []; // parallel array of booleans
    // Bind handlers once so they can be removed
    this._onClick = e => {
      if (e.target.matches('#recheck-btn')) {
        this._maybeUpdate();
      }
    };
    this._onGenerationChange = e => {
      if (e.detail && typeof e.detail.generation === 'number') {
        this.generation = e.detail.generation;
      }
    };
  }

  // ---- attribute handling ----
  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === 'generation') {
      this._generation = Number(newValue) || 0;
      this._maybeUpdate();
    }
  }

  // ---- property setters/getters ----
  set generation(v) {
    const n = Number(v) || 0;
    if (n === this._generation) return;
    this._generation = n;
    this.setAttribute('generation', String(n));
    this._maybeUpdate();
  }
  get generation() {
    return this._generation;
  }

  set form(v) {
    if (v === this._form) return;
    this._form = v;
    this._maybeUpdate();
  }
  get form() {
    return this._form;
  }

  set checks(v) {
    if (!Array.isArray(v)) {
      throw new TypeError('checks must be an array');
    }
    // shallow equality check (could be deep, but we assume replacement)
    if (JSON.stringify(v) === JSON.stringify(this._checks)) return;
    this._checks = v;
    this._maybeUpdate();
  }
  get checks() {
    return this._checks;
  }

  // ---- lifecycle ----
  connectedCallback() {
    this._render();
    this._addEventListeners();
    // initial evaluation if we already have data
    this._maybeUpdate();
  }

  disconnectedCallback() {
    this._removeEventListeners();
  }

  // ---- event handling ----
  _addEventListeners() {
    this.shadowRoot.addEventListener('click', this._onClick);
    // listen for bubbling generation-change events
    this.addEventListener('generation-change', this._onGenerationChange);
  }
  _removeEventListeners() {
    this.shadowRoot.removeEventListener('click', this._onClick);
    this.removeEventListener('generation-change', this._onGenerationChange);
  }

  // ---- core logic ----
  _maybeUpdate() {
    if (this._checks.length && this._form !== null) {
      this._evaluate();
    }
  }

  _evaluate() {
    const results = this._checks.map(({ check }) => {
      try {
        return !!check(this._form, this._generation);
      } catch {
        return false;
      }
    });
    // Only update if changed (shallow)
    if (JSON.stringify(results) !== JSON.stringify(this._results)) {
      this._results = results;
      this._renderResults();
    }
  }

  // ---- rendering ----
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: ui-serif, Georgia, 'Times New Roman', serif;
          color: var(--ink);
          line-height: 1.5;
          padding: 0.5rem;
        }
        ul {
          list-style: none;
          padding: 0;
          margin: 0 0 1rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        li {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
        }
        .indicator {
          font-size: 1.2rem;
          line-height: 1;
          min-width: 1.2em;
          text-align: center;
        }
        .pass { color: green; }
        .fail { color: red; }
        #recheck-btn {
          align-self: flex-start;
          padding: 0.25rem 0.5rem;
          font-size: 0.9rem;
          background: var(--rule);
          color: var(--ink);
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
        }
        #recheck-btn:hover {
          background: var(--ink-soft);
        }
      </style>
      <div>
        <slot></slot>
        <ul id="checks-list"></ul>
        <button id="recheck-btn">Re-check all</button>
      </div>
    `;
    this._renderResults();
  }

  _renderResults() {
    const list = this.shadowRoot.querySelector('#checks-list');
    if (!list) return;
    list.innerHTML = '';
    this._checks.forEach(({ name }, i) => {
      const li = document.createElement('li');
      const passed = this._results[i] === true;
      li.innerHTML = `
        <span class="indicator ${passed ? 'pass' : 'fail'}">
          ${passed ? '✅' : '❌'}
        </span>
        <span>${name}</span>
      `;
      list.appendChild(li);
    });
  }
}

// Auto-define the custom element when the module is loaded
customElements.define('property-checks', PropertyChecks);
