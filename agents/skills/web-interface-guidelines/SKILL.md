---
name: web-interface-guidelines
description: Concrete rules for web interface quality — accessibility, focus, forms, animation, typography, content handling, touch and theming. Load it before writing or reviewing any change to markup, CSS or UI behavior in docs/.
license: MIT — see LICENSE
---

<!--
Adapted from vercel-labs/web-interface-guidelines, command.md (commit e3d624ba),
MIT License — see LICENSE. Pinned here instead of fetched, so the rules change
only through a reviewed PR. Changes: rules specific to React, Next.js, Tailwind
and server rendering are removed or restated for a static site of plain ES
modules; "Title Case for headings" is dropped because frontend-design asks for
sentence case; "How to use these rules" and "What blocks a merge" replace the
upstream output format.
-->

# Web Interface Guidelines

## How to use these rules

**Building:** follow them in everything you write under `docs/`.

**Reviewing:** check the lines the change adds or modifies against them. Report each violation as one entry in your `issues` list, as `docs/<file>:<line> — <what is wrong> → <the fix>`. Do not audit code the change did not touch.

## What blocks a merge

A violation the change **introduces** in one of these sections blocks, because it makes the feature unusable for somebody:

- Accessibility
- Focus states
- Keyboard and gesture alternatives (under Touch & interaction)
- Anything in "Anti-patterns" that disables zoom, blocks paste, or hides focus
- Motion that ignores `prefers-reduced-motion`

Everything else is polish. Follow it when building, but never send a change back for it alone.

## Rules

### Accessibility

- Icon-only buttons need `aria-label`
- Form controls need `<label>` or `aria-label`
- Interactive elements need keyboard handlers (`keydown` / `keyup`) when they are not native controls
- `<button>` for actions, `<a>` for navigation (not a `<div>` with a click listener)
- Images need `alt` (or `alt=""` if decorative)
- Decorative icons need `aria-hidden="true"`
- Async updates (toasts, validation) need `aria-live="polite"`
- Use semantic HTML (`<button>`, `<a>`, `<label>`, `<table>`) before ARIA
- Headings hierarchical `<h1>`–`<h6>`; include skip link for main content
- `scroll-margin-top` on heading anchors
- Meaningful media needs captions, transcripts, or descriptions as applicable
- Media controls need keyboard support; decorative media needs assistive-tech hiding

### Focus states

- Interactive elements need a visible focus style
- Never `outline: none` without a focus replacement
- Use `:focus-visible` over `:focus` (avoid focus ring on click)
- Group focus with `:focus-within` for compound controls
- Sticky headers/footers/overlays must not cover the focused element

### Forms

- Inputs need `autocomplete` and meaningful `name`
- Use correct `type` (`email`, `tel`, `url`, `number`) and `inputmode`
- Never block paste (a `paste` listener calling `preventDefault`)
- Labels clickable (`for` or wrapping control)
- Disable spellcheck on emails, codes, usernames (`spellcheck="false"`)
- Checkboxes/radios: label + control share single hit target (no dead zones)
- Submit button stays enabled until the action starts; show progress while it runs
- Errors inline next to fields; focus first error on submit
- Placeholders end with `…` and show example pattern
- `autocomplete="off"` on non-auth fields to avoid password manager triggers
- Warn before navigation with unsaved changes (`beforeunload`)

### Animation

- Honor `prefers-reduced-motion` (provide reduced variant or disable)
- Animate `transform`/`opacity` only (compositor-friendly)
- Never `transition: all` — list properties explicitly
- Set correct `transform-origin`
- SVG: transforms on `<g>` wrapper with `transform-box: fill-box; transform-origin: center`
- Animations interruptible — respond to user input mid-animation
- Autoplay motion >5 seconds alongside other content needs pause, stop, or hide controls
- Muted decorative loops must stop under `prefers-reduced-motion`

### Typography

- `…` not `...`
- Curly quotes `“` `”` not straight `"` in visible text
- Non-breaking spaces: `10&nbsp;MB`, `⌘&nbsp;K`, brand names
- Loading states end with `…`: `"Loading…"`, `"Saving…"`
- `font-variant-numeric: tabular-nums` for number columns/comparisons and numbers that change in place
- Use `text-wrap: balance` or `text-wrap: pretty` on headings (prevents widows)

### Content handling

- Text containers handle long content: `text-overflow: ellipsis`, `line-clamp`, or `overflow-wrap: anywhere`
- Flex children need `min-width: 0` to allow text truncation
- Handle empty states — don't render broken UI for empty strings/arrays
- User-generated content: anticipate short, average, and very long inputs

### Images

- `<img>` needs explicit `width` and `height` (prevents layout shift)
- Below-fold images: `loading="lazy"`
- Above-fold critical images: `fetchpriority="high"`

### Performance

- Large lists (>50 items): render only what is visible, or use `content-visibility: auto`
- No layout reads (`getBoundingClientRect`, `offsetHeight`, `offsetWidth`, `scrollTop`) inside a loop that also writes to the DOM
- Batch DOM reads/writes; avoid interleaving
- Work done on every keystroke or animation frame must be cheap
- Add `<link rel="preconnect">` for CDN/asset domains
- Critical fonts: `<link rel="preload" as="font">` with `font-display: swap`
- Prefer `<video autoplay muted loop playsinline>` over animated GIF; provide a still alternative

### Navigation & state

- URL reflects state that is worth sharing or returning to — tabs, filters, expanded panels
- Links use `<a>` (Cmd/Ctrl+click, middle-click support)
- Destructive actions need confirmation or an undo window — never immediate

### Touch & interaction

- `touch-action: manipulation` (prevents double-tap zoom delay)
- `-webkit-tap-highlight-color` set intentionally
- `overscroll-behavior: contain` in modals/drawers/sheets
- During drag: disable text selection, `inert` on dragged elements
- Drag/swipe/pinch/path gestures need tap/click and keyboard alternatives unless essential
- `autofocus` sparingly — desktop only, single primary input; avoid on mobile

### Safe areas & layout

- Full-bleed layouts need `env(safe-area-inset-*)` for notches
- Avoid unwanted scrollbars: fix content overflow rather than hiding it
- Flex/grid over JS measurement for layout

### Dark mode & theming

- `color-scheme: dark` on `<html>` for dark themes (fixes scrollbar, inputs)
- `<meta name="theme-color">` matches page background
- Native `<select>`: explicit `background-color` and `color` (Windows dark mode)

### Locale

- Dates/times: use `Intl.DateTimeFormat`, not hardcoded formats
- Numbers/currency: use `Intl.NumberFormat`, not hardcoded formats
- Brand names, code tokens, identifiers: wrap with `translate="no"` to prevent garbled auto-translation

### Hover & interactive states

- Buttons/links need a `:hover` state (visual feedback)
- Interactive states increase contrast: hover/active/focus more prominent than rest

### Content & copy

- Active voice: "Install the CLI" not "The CLI will be installed"
- Numerals for counts: "8 deployments" not "eight"
- Specific button labels: "Save API key" not "Continue"
- Error messages include fix/next step, not just problem
- Second person; avoid first person
- `&` over "and" where space-constrained

### Anti-patterns (flag these)

- `user-scalable=no` or `maximum-scale=1` disabling zoom
- A `paste` listener calling `preventDefault`
- `transition: all`
- `outline: none` without a `:focus-visible` replacement
- Click-driven navigation without an `<a>`
- `<div>` or `<span>` with click listeners (should be `<button>`)
- Images without dimensions
- Rendering a large array into the DOM in full
- Form inputs without labels
- Icon buttons without `aria-label`
- Hardcoded date/number formats (use `Intl.*`)
- `autofocus` without clear justification
- Animated GIF when compressed video is suitable
- Gesture-only action without tap/click and keyboard alternative
