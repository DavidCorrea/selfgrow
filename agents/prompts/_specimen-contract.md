## The Specimen Contract

Every specimen in the guide is one file, `docs/specimens/<name>.js`, and every
specimen exports the same four things. This is not a style preference — the build
runs these exports, and a specimen that does not provide them fails verification.

```js
// docs/specimens/branching-plant.js

/** What this specimen is, in the visitor's words. This IS the label. */
export const meta = {
  name: "Branching plant",
  rule: "Replace every stem with a stem and two smaller stems",
  invariants: ["Every generation has more segments than the last"],
};

/**
 * Grow the form and return its state. MUST be pure: same (seed, generation) in,
 * deeply equal state out, every time, forever. No Math.random(), no Date.now(),
 * no reading the clock or the DOM. Randomness comes from `seed` alone.
 */
export function grow(seed, generation) { /* ... */ }

/**
 * Check the properties this specimen promises. Returns an array of plain-language
 * failure messages — empty when everything holds. Test what the rule guarantees,
 * not what the code happens to do.
 */
export function checkInvariants(state, generation) { /* ... */ }

/** Draw `state` into `container`. The only function allowed to touch the DOM. */
export function render(container, state) { /* ... */ }
```

### Why it is split this way
`grow` is separated from `render` because growth is the specimen and drawing is
only how it becomes visible. Keeping them apart is what lets the state be tested,
compared, snapshotted, and read aloud without a browser painting anything — and
it is why the guide can be reviewed at all.

### Rules that verification enforces
- **`grow` must be deterministic.** The build grows every specimen twice and fails
  if the two states differ. A single `Math.random()` will be caught.
- **Invariants must actually hold.** The build grows each specimen through several
  generations and calls `checkInvariants` at each one. Any message it returns
  fails the build.
- **Write invariants that could fail.** `return []` passes verification and is
  worthless; so is asserting `state !== undefined`. State a property the rule
  promises — a count that only grows, an angle that never drifts, a bound nothing
  escapes — such that a plausible bug in `grow` would trip it.
- **No cross-specimen imports.** Each stands alone; shared machinery lives in
  `docs/lib/`.
