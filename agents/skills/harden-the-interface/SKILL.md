---
name: harden-the-interface
description: How to make a change hold up against the inputs, timing and failures real visitors bring — extreme values, empty and huge data, repeated or interrupted actions, unavailable storage, a tab left in the background. Load it before writing any change that displays data, stores state, runs on a timer, or responds to input in docs/.
license: Apache-2.0 — see LICENSE.txt
---

<!--
Adapted from pbakaus/impeccable, .agents/skills/impeccable/reference/harden.md
(commit c5ae03ee), Apache License 2.0 — see LICENSE.txt. Changes: everything
that assumes a server, an API, logins, an i18n library or React is removed,
because docs/ is a static site of plain ES modules; added what such a site does
fail at instead (browser storage, offline modules, background tabs, the clock,
long sessions); the CSS techniques web-interface-guidelines already states are
pointed to rather than repeated; verification uses this pipeline's selftest.js
and App Review instead of the upstream testing advice.
-->

# Harden the interface

A change that only works with the data you happened to test it with is not finished. The Playtester will find what you did not try, days later, as a visitor would. Try it first.

## In this pipeline

The product is a static page with no server: everything it knows lives in the browser, and everything that can go wrong goes wrong there. Before you finish, walk the change through the sections below that apply to it. Skip the ones that do not; a change to a static label does not need a clock audit.

The CSS for long text, truncation and empty states is in `web-interface-guidelines` under "Content handling". This skill is about finding the cases; that one is how to lay them out.

## Feed it the data reality will

For every value the change shows or accepts, try:

- **Empty and zero:** an empty string, an empty list, a count of 0, a first visit with nothing saved.
- **Huge:** numbers in the millions, then far beyond (`1e21` stops printing as digits in JavaScript, `1e308` is near the limit, `Infinity` is past it). A number that grows over a session will reach sizes nobody typed.
- **Tiny and negative:** fractions that round to "0", values below zero if anything can subtract.
- **Not a number:** `NaN` from `0 / 0` or `undefined + 1` spreads silently and renders as "NaN". Guard where it is born, not where it shows.
- **Long text:** a label or name three times longer than the one you wrote, and one word with no spaces.
- **Many items:** ten times the list you tested, and one item.

A value that changes width as it updates (a counter, a timer) makes everything beside it jump. Give it `font-variant-numeric: tabular-nums` and room for its longest likely form.

## Things a browser does to a page

- **Storage is not guaranteed.** `localStorage` throws in some private modes, when the quota is full, or when the visitor blocks site data. Reading can return `null`, a value from an older version of the product, or text that is not valid JSON. Every read handles all of those without losing what the visitor has; every write that can fail says so instead of failing silently.
- **Two tabs share one storage.** A second tab of the same page reads and overwrites the same keys. Decide which one wins, rather than letting them take turns erasing each other.
- **Modules can fail to load.** A pinned CDN import fails offline or when the CDN is down. The page should still show something that explains itself, not a blank screen.
- **Background tabs slow down.** Browsers throttle timers in a hidden tab to once a second or less, and stop them entirely when the device sleeps. Anything that counts ticks drifts; derive progress from elapsed time (`Date.now()` deltas), not from how many times a timer fired.
- **The clock is not monotonic.** The device clock can jump backwards or far forwards. Elapsed time computed from it can be negative or enormous; clamp it to something sane before using it.
- **Sessions are long.** A page left open for hours runs every timer thousands of times. Nothing it allocates per tick may accumulate: listeners, elements, array entries, timers. `interface-performance` has a script that measures this.

## Repeated and overlapping actions

- A double-click, a rapid series of taps, or a held key with auto-repeat runs the handler every time. Decide what repeated presses should do, and make sure doing it twice cannot do something once was not meant to (spend twice, add twice, open twice).
- An action that starts something taking time disables itself, or ignores presses, until it finishes, and the visitor can see that it is in progress.
- An action on something that has just changed (an item removed, a price updated by the last tick) acts on the current state, not the one the handler captured.

## Interrupted gestures

For custom drag surfaces, sliders or scrollable control strips:

- A second finger or pointer landing mid-drag does not hijack the first; the first drag continues or ends cleanly.
- `pointercancel` (the browser took the gesture to scroll), `lostpointercapture`, a release outside the control, and the window losing focus (`blur`) all clear the dragging state and release capture.
- After each of these, the next tap or drag works without a reload.

## Prove it

Each edge case the change now handles is behavior, and new behavior gains a check in `docs/selftest.js` in the same change. Drive the function with the extreme value directly (a huge number, a corrupt saved string, an elapsed time of minus an hour) and return a plain-language failure if it misbehaves. A case you tried by hand and did not encode will regress the next time someone touches the code.

Then run the App Review as `see-your-change` describes: overflow and overlap from long values show up there.

In your summary, name the cases you handled and any you deliberately left, with why.

## Never

- Assume the happy path: valid saved data, a visible tab, one press, a short label.
- Let `NaN`, `Infinity` or `undefined` reach the screen.
- Catch a storage error and carry on as if the write happened.
- Count timer ticks as a measure of time.
- Give a text container a fixed width sized to the text you wrote.
- Let one failed part blank the whole page.
