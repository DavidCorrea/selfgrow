## The Capability Contract

The Vision says the language's examples *are* its test suite, and that each
capability lives in its own file. That only works if the build can find and run
them, so this is the minimum structure required — and deliberately the minimum.

**It says nothing about what the language looks like.** Syntax, semantics, naming,
evaluation strategy, what a "capability" even means in this language — all of that
is yours to decide. Two files and two exported names are fixed; everything inside
them is open.

### 1. One entry point: `docs/lang/run.js`

```js
/**
 * Run one program and return what the language prints as its result.
 * Throw for a program the language rejects — the message is what the visitor
 * sees, so it is part of the language, not a stack trace.
 */
export function run(source) { /* ... */ }
```

This is the only thing the build knows how to call. How `run` gets from text to a
result — the stages, the data structures, the names for them — is unconstrained.

### 2. One file per capability: `docs/lang/capabilities/<name>.js`

```js
export const meta = {
  name: "...",     // what this capability is called, for the reference
  summary: "...",  // one line: what it lets someone do
  examples: [
    // Rendered as the documentation AND executed as the tests. If `run(source)`
    // stops returning `result`, the build fails.
    { source: "...", result: "..." },
  ],
};

/** Wire this capability into the interpreter. Called once at startup. */
export function register(interpreter) { /* ... */ }

/**
 * Properties this capability promises, checked with `run`. Return an array of
 * plain-language failure messages — empty when everything holds.
 */
export function checkProperties(run) { return []; }
```

### What the build enforces
- **Every example must be true.** Each `{ source, result }` is executed through
  `run` and compared. A wrong example fails the build, so the reference cannot
  drift from the language.
- **At least one example per capability.** A capability with none is undocumented
  and untested at once.
- **Properties must hold.** Anything `checkProperties` reports fails the build.
- **Write properties that could fail.** `return []` passes and is worthless. State
  something the capability genuinely promises — a value that round-trips, a result
  that does not depend on evaluation order, an input the language must reject —
  such that a plausible bug would trip it.
- **A program must not hang.** `run` is called with a time limit; a program that
  will not finish must be stopped and reported by the language itself.

### Deriving the design
Justify choices from the language's own properties, never by precedent. "That is
how another language does it" is not a reason — if a design is right, it can be
argued for on its own terms.
