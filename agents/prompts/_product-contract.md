## The Self-Check Contract

Layers of the build already prove the code parses, lints, and loads without
throwing. None of those prove the product actually *does* what it claims — which
is exactly the failure most likely to ship, because everything else looks green.
So the product carries its own checks, and the build runs them.

This is the minimum structure required, and deliberately the minimum. **It says
nothing about what the product is.** Structure, features, naming, how anything
works — all yours to decide. One file and one exported name are fixed;
everything inside is open.

### One entry point: `docs/selftest.js`

```js
/**
 * Check that the product still does what it claims.
 *
 * Return an array of plain-language failure messages — empty when everything
 * holds. Each message is read by an agent deciding what to fix, so say what
 * broke and what was expected, not just "failed".
 *
 * May be async. Runs in the real browser, on the real page, so it can reach
 * the DOM and import any module the product ships.
 */
export async function checks() {
  const problems = [];
  // ...
  return problems;
}
```

This is the only thing the build knows how to call. Whether it exercises pure
functions, drives the DOM, or round-trips stored state is unconstrained.

### What the build enforces
- **Every reported failure fails the build.** Anything `checks()` returns stops
  the merge, so a check that reports noise costs real time.
- **Write checks that could fail.** `return []` passes and is worthless. State
  something the product genuinely promises — a value that round-trips, a result
  that doesn't depend on ordering, an input that must be rejected — such that a
  plausible bug would trip it.
- **Cover what you just built.** A feature shipped without a check is untested
  and undocumented at once. Extend `checks()` in the same change.
- **The suite must not hang.** It runs under a time limit; work that can't
  finish quickly must be bounded by the product itself, not by the browser
  giving up.
- **Keep messages specific.** "Cart total wrong: expected 30, got 25" is
  actionable; "cart broken" costs another whole build to diagnose.

### Deriving the design
Justify choices from the product's own properties, never by precedent. "That is
how another product does it" is not a reason — if a design is right, it can be
argued for on its own terms.

## Project Skills

Know-how that belongs to this product rather than to any product — how its
genre works, what its audience expects — lives in `docs/skills/<name>/SKILL.md`.
Every agent that can read files is offered all of them, by name and
description, and loads the ones its task needs. They are product: a reset
deletes them with everything else in `docs/`.

A skill is a Markdown file with frontmatter:

```markdown
---
name: <name>            # the same as its directory
description: <what it covers and when to load it — the only part an agent sees before deciding>
---

<the guidance itself>
```

- **The build loads each one.** A skill with no description, a name that does
  not match its directory, or a name a harness skill already has fails the build.
- **Change one when a ticket asks for it**, or when the product has moved and
  what it says is no longer true. Every later agent that loads it acts on what
  it says, so a wrong skill misleads every run that follows.
