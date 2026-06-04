# Changelog

History of changes made by the hourly agent.

## 2026-06-04

- **Added animated weather system with four states (sunny, rainy, cloudy, snowy)**: A new atmospheric weather overlay system that cycles automatically every 2-3 minutes between four weather states. Sunny adds warm golden light rays that pulse gently from the top of the screen. Rain renders 60 falling blue-tinted droplets with varied timing and opacity. Cloudy drifts translucent cloud shapes across the screen with soft mist layers near the bottom. Snow floats 50 white flakes that drift diagonally with subtle glow. Each weather state has a gentle color tint overlay that shifts the mood. A small weather icon indicator in the bottom-right corner (above the soundscape toggle) shows the current weather with a label. Weather transitions use smooth 2.5s opacity fades between states. All effects are pure CSS animations — no external dependencies, no images, no canvas. The weather overlay sits at z-index 0 (below the main container at z-index 1) so it doesn't interfere with garden interactions. Fully responsive with adjusted icon/label positioning at 375px, 768px, and 1200px+ breakpoints. Respects prefers-reduced-motion by disabling all weather animations. Enhances the 'calm & intentional' philosophy by adding gentle atmospheric variety to the living garden experience.

## 2026-06-04

- **Modernized layout with responsive multi-column design (closes #4)**: The app previously stacked all sections in a single narrow column even on 1200px+ screens, wasting horizontal space and looking outdated. Introduced a modern two-column layout: on desktop (1200px+), the welcome card and garden grid sit side-by-side in a top row, while the stats panel and journal sit side-by-side in a bottom row. The toolbar flows full-width between the two rows. On tablets (768px+), elements widen with larger padding and gaps. Mobile (below 768px) retains the single-column stack. Added a flexbox gap-based spacing system for smoother section transitions. All changes are CSS-only with minor HTML structural adjustments (wrapping sections in `.top-row` and `.bottom-row` divs). Fully responsive at 375px, 768px, and 1200px+ breakpoints.

## 2026-06-04

- **Widen layout for larger viewports**: The container, garden grid wrapper, garden grid, journal, stats, and toolbar were all capped at 32rem max-width, leaving large empty margins on tablets and desktop. On 768px+ screens the container now expands to 48rem and the grid to 28rem with larger gaps; on 1200px+ screens the container expands to 64rem and the grid to 34rem. Card padding, journal padding, stats padding, toolbar button sizing, and timeline max-heights all scale up at both breakpoints. This is a pure CSS change — no HTML or JS modifications — and aligns the layout with the VISION.md principle of being responsive from 375px to 1200px+.

## 2026-06-04

- **Fixed VISION.md duplicate entry**: Removed the duplicate roadmap item #9 'Garden Reflection Stats' (appeared twice at lines 29-32). The roadmap now has a clean single list of items 1-9.

- **Added Garden Reflection Stats panel**: Implemented step 9 of the VISION.md roadmap. A gentle statistics panel that appears below the journal section, showing: (1) total flowers bloomed across all cycles, (2) current time-of-day season with a thematic icon (dawn/day/dusk/night), (3) time since last tending with a human-friendly relative timestamp, and (4) a 'garden mood' indicator (thriving, flourishing, growing, resting, dormant) based on how recently the garden was tended and how many flowers are currently blooming. Each mood has a unique color glow on the mood card. A poetic reflection line at the bottom shifts with the mood. The panel uses a parchment-matching aesthetic consistent with the journal, with a 2x2 grid layout (mood card spans full width). Stats update dynamically as the garden changes — on planting, journal entries, cycle transitions, and theme changes. A 30-second timer refreshes relative timestamps. All data is derived from existing state (journal entries, planted tiles, blooming count, timestamps) — zero external dependencies. Fully responsive at 375px, 768px, and 1200px+ breakpoints.

## 2026-06-04

- **Added ambient soundscape using Web Audio API**: Implemented step 8 of the VISION.md roadmap. A procedurally generated ambient soundscape that creates gentle nature sounds — sine wave drones for breeze/wind, short random chirp envelopes for birdsong, soft filtered noise bursts for water droplets, and cricket-like clicks at night. The audio character shifts with the existing time-of-day themes: dawn gets gentle bird chirps, day gets brighter ambient tones, dusk gets warmer lower tones, and night gets deep sparse sounds with occasional cricket clicks. Added a mute/unmute toggle button (fixed position, bottom-right) with 🔇/🔊 icons, aria-label, and visual pulse animation when active. The soundscape uses only the browser's built-in Web Audio API — zero external dependencies. All sounds are procedurally generated with no audio files. Fade-in/fade-out transitions for smooth start/stop. Enhances the 'calm & intentional' core philosophy and deepens the meditative quality of the garden experience.

## 2026-06-04

- **Added animated garden visitors (butterflies, bees, fireflies)**: Introduced a garden visitors system where CSS-animated butterflies and bees periodically flutter across the garden, attracted to blooming flowers. Visitors are pure CSS/JS creations — butterflies have wing-flap keyframes in pink, blue, purple, and orange variants; bees have striped bodies with fast wing-flap and bobbing animations. Clicking a visitor triggers a scatter animation. The number of visitors scales with planted tiles (more flowers = more frequent spawns). At night theme, butterflies and bees are replaced by glowing fireflies with soft pulsing light and trail particles. Fully self-contained with CSS animations and JS timing logic — no external dependencies. Enhances the 'living ecosystem' feel of the garden.

## 2026-06-03 (Fix)

- **Removed dead code**: Cleaned up three unused variables/functions. Removed `originalPlantTileFn` (was assigned `plantTile` but never used — leftover from refactoring). Removed `wateringMessages` array and `getRandomWateringMessage()` function (both were never referenced; `getRandomWateringHint()` uses `wateringHintMessages` instead). Removed `hasSavedGarden` variable (was assigned but never read). Also wrapped the `restoreGardenState()` call in a guard to check `savedState && savedState.plantedCount > 0` directly, eliminating the need for the separate boolean. Keeps the codebase clean and free of stale references.

## 2026-06-03

- **Added garden persistence via localStorage**: Implemented step 7 of the VISION.md roadmap. The garden state (planted tiles, growth cycle states, watering status, journal entries, planted count, and UI visibility flags) is now saved to localStorage whenever state changes occur (planting, watering, cycle transitions, journal entries). On page load, the saved state is restored — planted tiles appear in their last known growth stage with correct cycle badges, watered icons, and journal entries intact. A brief 'restoring your garden...' overlay appears during restoration. A 'last tended' timestamp is shown in the journal header with human-friendly relative time (e.g., 'last tended 5 min ago at 3:42 PM'). Growth cycle timers are automatically restarted on restore. The welcome seed-bloom interaction is preserved for first-time visitors. Fully self-contained using only the browser's localStorage API — no external dependencies.

## 2026-06-03

- **Added interactive watering can tool**: Implemented step 4 of the VISION.md roadmap ('Tending Actions'). A watering can button appears in a toolbar after the first tile is planted. Clicking it toggles 'watering mode' where clicking on planted tiles triggers a water droplet animation (💧 falling and splashing), extra blue-tinted sparkles, a brief bloom glow effect, and a persistent water icon on the watered tile. Watered tiles get a blue-tinted border glow and their growth cycle duration is halved (50% speed boost) via CSS animation overrides and accelerated wilt timing. Each tile can only be watered once per cycle — the effect resets when the next growth cycle begins. The journal logs watering events with a 💧 indicator. The toolbar button bounces when active and uses aria-pressed for accessibility. Fully responsive and self-contained with CSS animations and JS state tracking — no external dependencies.

## 2026-06-03

- **Added growth cycle animations (sprout → bud → bloom → wilt → reseed)**: Implemented step 3 of the VISION.md roadmap. Each planted tile now progresses through a continuous life cycle: after the initial bloom holds for ~8 seconds, the flower wilts over 2 seconds (petals droop and fade via new 'wilting' CSS animation with filter effects), resets to soil with a gentle pulse, then automatically reseeds and restarts the loop. A new 'bud' stage was added between stem growth and full bloom — a small closed green bulb that opens into the flower. Each tile uses slightly varied timing (offset by tile index × 1.2s) so the garden feels organic and not synchronized. A cycle badge (🌸 N) appears on each tile showing the current cycle number. The journal logs each new bloom cycle with a '🌸 cycle N' counter and cycle-specific messages. Fully self-contained with CSS animations and JS timers — no external dependencies.

## 2026-06-03

- **Added seasonal time-of-day theme transitions**: Implemented step 5 of the VISION.md roadmap. The garden now automatically shifts its color palette based on the user's current hour — dawn (5-8am, soft pinks with golden light), day (8am-5pm, bright greens and sky blues), dusk (5-8pm, warm oranges and deep purples), and night (8pm-5am, deep blues with silver moonlight). Uses JavaScript's Date() to determine the hour and applies a CSS class to the body element. Smooth 1.5s transitions between themes. Updates every minute to catch time-of-day changes. Fully self-contained with hardcoded color values — no external dependencies. Enhances the 'calm & intentional' core philosophy by subtly reflecting the user's real-world time in the garden experience.

## 2026-06-03

- **Added Garden Journal panel**: Implemented step 6 of the VISION.md roadmap. A parchment-inspired scrollable journal that logs planting events with timestamps. Each entry shows the tile number, planting time, flower sequence number, and a color swatch matching the planted flower. The journal appears after the grid is revealed, animates in with a gentle fade-in, and pulses when new entries are added. Features a custom scrollbar, timeline dots, and slide-in entry animations. Fully responsive at 375px, 768px, and 1200px+ breakpoints. All self-contained with hardcoded timestamp formatting — no external dependencies.

## 2026-06-03 (Fix)

- **Removed unused --petal-alt CSS variable**: The variable `--petal-alt` was defined in `:root` but never referenced anywhere in the stylesheet. Removed it to eliminate dead code and keep the CSS clean.

## 2026-06-03

- **Added 3x9 garden grid of plantable tiles**: After the welcome seed blooms and its message fades, a 3x3 grid of soil tiles fades in below the main flower. Each tile can be clicked to plant a seed that grows into a unique flower with randomized petal colors from a palette of pinks, oranges, purples, blues, and yellows. The grid uses CSS-only animations for the planting sequence (seed drop → stem grow → leaf pop → flower bloom), staggered per tile. A counter tracks how many of the 9 tiles have been planted. Implements step 2 of the VISION.md roadmap ('Garden Grid'). Fully responsive at 375px, 768px, and 1200px+ breakpoints. All self-contained with hardcoded color palettes — no external dependencies.

## 2026-06-03

- **Added welcome screen with seed-bloom micro-interaction**: Established the project's first identity with a centered card featuring the title "selfgrow", a tagline, and an interactive CSS-animated seed that sprouts into a flower when clicked. Includes dark gradient background, soft glow card, sparkle particles on bloom, and responsive layout (375px–1200px+). All self-contained with zero external dependencies.
- **Created VISION.md**: Defined the app's direction as a living, growing digital garden — a self-contained web app that evolves through agent-driven cycles. Outlined core philosophy, growth roadmap, and design principles for future agents to build upon.

## 2026-06-03 (Fix)

- **Added prefers-reduced-motion media query**: The VISION.md Design Principles require reduced-motion support but it was missing from styles.css. Added a comprehensive `@media (prefers-reduced-motion: reduce)` rule that collapses all animation and transition durations to near-zero, disables the flower sway animation, hides sparkle particles, and removes the message transition — ensuring users who prefer reduced motion get a calm, static experience.
