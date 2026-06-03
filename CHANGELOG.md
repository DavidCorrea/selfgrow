# Changelog

History of changes made by the hourly agent.

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
