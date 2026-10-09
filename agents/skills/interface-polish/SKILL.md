---
name: interface-polish
description: The small details that make an interface feel good whatever it looks like — whether and how something should move, easing and timing, press feedback, entrances and exits, nested corners, optical alignment and type that is tuned rather than default. Load it when building or refining anything a visitor presses, watches change, or reads in docs/.
license: MIT — see LICENSE
---

<!--
Adapted from emilkowalski/skills, skills/emil-design-eng (commit e8a175de), and
jakubkrehel/skills, skills/better-ui and skills/better-typography (commit
d574cc8a), both MIT License — see LICENSE. Changes: kept only what neither
frontend-design nor web-interface-guidelines already says; React, Framer Motion,
Tailwind and component-library recipes are restated in plain CSS; exact values
are kept as starting points, because the direction the Builder commits to wins
over any default here; the required review format, gesture physics, the
shadow-ring recipe (it conflicts with frontend-design's "depth is declared
once") and advice for people (study great work, review it tomorrow) are removed.
-->

# Interface polish

None of this picks a look. It is the layer under whatever look the page has: the details a visitor never notices consciously, and would miss if they were gone. A bold page and a quiet page both get better from them.

Where the product already has a motion language, a radius scale or a type scale, keep it. The values below are good starting points when nothing has been decided yet, not corrections to a decision someone made on purpose. The same detail done two different ways on one page is always worth fixing.

## Should it move at all?

Decide by how often a visitor will see it, before you decide how it moves.

| How often | What it gets |
|---|---|
| Constantly: the main action, a value that updates every second, keyboard actions | Instant feedback, or a transition of 150 ms or less on `opacity`, `color` or `background-color`. Nothing that delays the result |
| Many times a session: hovers, switching tabs or panels | Little or nothing |
| Now and then: opening a dialog, a menu, a notice | A standard, short transition |
| Rarely: a first visit, a milestone, a success worth marking | Room for something expressive |

An animation needs an answer to "why does this move?": it shows where something came from or went, shows that a state changed, confirms a press, or keeps a change from being jarring. "It looks nice" is enough only for the rare moments. A change that moves must also leave a static cue (a colour, an icon, a label), so motion is never the only signal.

## Easing

- Entering or leaving: **ease-out**, so movement starts immediately, when the visitor is watching most closely.
- Moving or morphing on screen: **ease-in-out**.
- Colour and hover changes: `ease`.
- Constant motion (a progress bar, a marquee): `linear`.
- Never **ease-in** for interface motion: it starts slowly and makes the page feel late.

The built-in curves are weak. Stronger ones to start from:

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
}
```

Match the motion to the character of the page: a playful one can overshoot a little; a calm one stays crisp. Whatever you choose, use the same few curves and durations everywhere.

## Timing

| What | Duration |
|---|---|
| Press feedback | 100–160 ms |
| Tooltips, small popovers | 125–200 ms |
| Menus, selects | 150–250 ms |
| Dialogs, drawers | 200–400 ms |

Interface motion stays under 300 ms unless it is explaining something. A faster animation makes the whole page feel faster, even when nothing loads sooner.

Exits are shorter and smaller than entrances: a visitor waits to see what arrives, never for what leaves. Something slow on purpose (hold to confirm) releases fast.

## Pressing, appearing, disappearing

- **Presses answer.** Anything pressable scales slightly on `:active`, about `scale(0.96)`–`scale(0.98)` over 100–160 ms with ease-out. A disabled control does not.
- **Nothing appears from nothing.** Enter from `scale(0.95)` with `opacity: 0`, never from `scale(0)`. A small `translateY` (around 8–12 px) or a light blur (4 px or less) can join them.
- **Things grow from where they came from.** A menu or popover scales from its trigger (`transform-origin` at the trigger's edge), not from its own centre. A dialog that belongs to no trigger stays centred.
- **Interactive state uses transitions, not keyframes.** A transition retargets when the visitor reverses mid-way; a keyframe animation restarts from zero. Keep `@keyframes` for sequences that play once.
- **Enter without JavaScript** where you can: `@starting-style` gives a newly shown element its starting values for a transition.
- **Stagger only rare entrances**, 30–100 ms apart, split into meaningful pieces (heading, then text, then actions). Never stagger something routine, and never block input while it plays.
- **Hover effects only where hovering exists.** Put them inside `@media (hover: hover) and (pointer: fine)`, so a tap on a phone does not leave an element stuck in its hover state.
- **A crossfade that looks like two things swapping** often reads as one smooth change with a brief `filter: blur(2px)` during the transition.

When something feels off, slow it down: set durations to five times their value for a moment and watch for wrong origins, properties falling out of step, or two states visibly overlapping.

## Surfaces

- **Nested corners are concentric.** Where one rounded surface sits inside another with an even inset, the outer radius is the inner radius plus the padding (plus any border). The same radius on both makes the inner corners look pinched. Past about 24 px of padding, treat them as separate surfaces.
- **Align by eye where geometry looks wrong.** A button with text and an icon looks balanced with about 2 px less padding on the icon side. A play triangle sits right of its geometric centre. Stars, arrows and carets carry uneven weight; fix that in the SVG rather than with offsets where you can.
- **Content images get a hairline edge.** A 1 px inset outline in pure black or white at about 10% opacity (`outline: 1px solid rgb(0 0 0 / 0.1); outline-offset: -1px`, white on dark) keeps a photo from bleeding into a similar background. Never a tinted colour, which shows as a fringe. Skip transparent artwork.

## Type that is tuned, not default

- **Line-height by role**, unitless so it scales: display text about `1.1`, headings `1.2`–`1.3`, body `1.5`–`1.6`. Anything that wraps to three or more lines gets at least `1.4`.
- **Letter-spacing by size:** headings at 24 px and up tighten slightly (`-0.01em` to `-0.02em`); small uppercase labels open up (about `0.05em`); body text stays at `0`. Use `em` so it scales with the size.
- **Weight by size:** below 18 px, use 400 or heavier. Thin weights belong to large display text.
- **Heading sizes descend with level**, so a subordinate heading never outweighs its parent.
- **`text-wrap: pretty` on paragraphs** keeps a single word off the last line (balance is for headings and short text).
- **Underlines from the font:** `text-underline-position: from-font` and `text-decoration-thickness: from-font`, or a deliberate `text-underline-offset`, instead of the browser's default line through the descenders.
- **Load every weight and style you use.** A browser fakes a missing bold or italic by distorting the face.
- **Set case with `text-transform`**, and keep the text itself in natural case.
