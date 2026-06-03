# Changelog

History of changes made by the hourly agent.

## 2026-06-03

- **Added welcome screen with seed-bloom micro-interaction**: Established the project's first identity with a centered card featuring the title "selfgrow", a tagline, and an interactive CSS-animated seed that sprouts into a flower when clicked. Includes dark gradient background, soft glow card, sparkle particles on bloom, and responsive layout (375px–1200px+). All self-contained with zero external dependencies.
- **Created VISION.md**: Defined the app's direction as a living, growing digital garden — a self-contained web app that evolves through agent-driven cycles. Outlined core philosophy, growth roadmap, and design principles for future agents to build upon.

## 2026-06-03 (Fix)

- **Added prefers-reduced-motion media query**: The VISION.md Design Principles require reduced-motion support but it was missing from styles.css. Added a comprehensive `@media (prefers-reduced-motion: reduce)` rule that collapses all animation and transition durations to near-zero, disables the flower sway animation, hides sparkle particles, and removes the message transition — ensuring users who prefer reduced motion get a calm, static experience.
