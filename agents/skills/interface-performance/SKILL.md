---
name: interface-performance
description: How to keep the page fast to load and cheap to leave running — measuring load, long tasks, frame rate, layout shift and growth over time before and after a change, and the patterns that make timers, animation and rendering expensive. Load it before writing any change that runs on a timer or every frame, animates, renders many elements, or adds a script, font or image to docs/.
license: Apache-2.0 — see LICENSE.txt
---

<!--
Adapted from pbakaus/impeccable, .agents/skills/impeccable/reference/optimize.md
(commit c5ae03ee), Apache License 2.0 — see LICENSE.txt. Changes: framework,
bundler, server and monitoring-service advice is removed, because docs/ is a
static site of plain ES modules with pinned CDN imports and no build; added the
cost of a page left running (timers, per-tick rendering, growth over a session);
"measure before and after" is made concrete with measure.mjs instead of
Lighthouse and field monitoring; rules web-interface-guidelines already states
are pointed to rather than repeated.
-->

# Interface performance

Find what is actually slow, fix that, and measure that the fix worked. Do not optimize what the numbers do not show is slow; that only makes the code harder to read.

## In this pipeline

A visitor does not only load the page; they leave it open. Work that runs on a timer or every frame is paid thousands of times a session, on whatever device they have. The rules in `web-interface-guidelines` under "Performance" and "Images" still apply; this skill is how to tell whether you broke them, and what else costs.

## 1. Measure before you edit

```bash
node agents/skills/interface-performance/measure.mjs > "${TMPDIR:-/tmp}/performance-before.txt" 2>&1
```

It serves `docs/` in a real browser, at desktop size and at phone size with the CPU slowed four times, loads the page, then leaves it running for 15 seconds without touching it. Pass a number of seconds to run longer: a leak that is invisible in 15 seconds is often obvious in 60. It uses no model.

## 2. Measure again when you are done

```bash
node agents/skills/interface-performance/measure.mjs > "${TMPDIR:-/tmp}/performance-after.txt" 2>&1
```

Compare the two files line by line. The numbers vary a little from run to run, so do not `diff` them: look for a line that moved by more than noise, and rerun once before believing a small change. What each line means, and what to aim for:

| Line | Healthy | Your change's problem if |
|---|---|---|
| `first paint` | under 1800 ms on the phone line | it grew by hundreds of ms |
| `requests` | as few as the page needs | it grew without a reason you can name |
| `long tasks` (load) | few, none over 200 ms | a new one appears, or the longest grows |
| `layout shift` (load) | under 0.1 | it grew: something resizes after it first paints |
| `long tasks` (running) | 0 | any appear: something blocks the page while nobody touches it |
| `frames per second` | about 60 | it dropped: a timer or animation is doing too much per frame |
| `layout shift` (running) | 0.000 | above zero: content jumps on its own as it updates |
| `elements a → b` | a equals b | b is larger: elements are created per tick and never removed |
| `JS heap a → b` | flat within about 1 MB | it climbs, and climbs further on a longer run: a leak |

A problem that was already there before your change is not yours to fix in this change; mention it in your summary so it can become a ticket.

## Work that runs on a timer or every frame

- **Write only what changed.** Compare the new value with what is already on screen and skip the DOM write when they match. Setting `textContent` or a style to its current value still costs.
- **Do not rebuild what you can update.** Replacing a panel's `innerHTML` every tick throws away and recreates every element in it, loses focus and text selection, and restarts CSS transitions. Create elements once and update their text or attributes.
- **Never read layout in a loop that writes.** `getBoundingClientRect`, `offsetHeight` and their kind force the browser to lay out the page again after every write. Read everything first, then write everything.
- **Derive from elapsed time.** A timer slowed in a background tab or catching up after sleep must not loop once per missed tick; compute the result of the elapsed time in one step.
- **Stop what nobody can see.** Pause animation and rendering while `document.hidden` is true. Keep the underlying state correct by catching up from elapsed time when the page becomes visible again.
- **Clean up.** Every `setInterval`, `requestAnimationFrame` loop and event listener added for something that can go away is removed when it does.

## Rendering and animation

- Animate `transform` and `opacity`. Animating `width`, `height`, `top`, `left` or margins lays out the page every frame.
- Use `will-change` only on an element you know is expensive to animate, and only while it animates. On everything, it costs memory and helps nothing.
- Keep blur, filters and large shadows small and isolated; their cost grows with the area they cover.
- A region that updates often and does not affect the layout around it can take `contain: layout paint` so its changes stay inside it.

## Loading

- Every pinned CDN module is a request, and every module it imports is another one after it. Prefer few, flat dependencies, and `<link rel="modulepreload">` the ones the first paint needs.
- Nothing above the first paint waits for something below it: defer what the first screen does not need.
- Give images their real dimensions and size them for where they display.
- Load the font weights you use, not the whole family.

## Responding to input

- A handler that takes longer than about 50 ms makes the page feel stuck. Do the visible part first (the button reacts, the number changes) and move the rest to after the next paint with `requestAnimationFrame` or `setTimeout`.
- Heavy calculation that a visitor triggers repeatedly (a preview, a simulation) runs once per change in input, not once per frame.

## Never

- Optimize without a before and an after.
- Trade accessibility, or behavior, for speed.
- Leave a timer or listener running for something that is gone.
- Hide a slow tick by making it run less often when the work itself is what is slow.
