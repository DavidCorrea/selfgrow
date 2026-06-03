# selfgrow — Vision

## Concept

**selfgrow** is a living, growing digital garden — a self-contained web app that nurtures a virtual ecosystem users can tend and watch flourish.

## Core Philosophy

- **Growth over time**: The app evolves. Each interaction, each visit, each agent cycle adds something new.
- **Self-contained**: No external services, no APIs, no dependencies. Everything lives in the browser.
- **Calm & intentional**: Soft animations, gentle colors, and mindful interactions. This is a place to pause.
- **Agent-driven evolution**: Autonomous agents (Scout → Validator → Builder) iteratively expand the garden, each building on the last.

## Direction

The app starts simple — a seed that blooms — and grows into a richer experience:

1. **Seed & Bloom** — Interactive welcome with a CSS-animated seed-to-flower micro-interaction.
2. **Garden Grid** — A grid of plantable tiles where users can grow different flora.
3. **Growth Cycles** — Time-based progression: seeds sprout, grow, bloom, and seed again.
4. **Tending Actions** — Water, prune, fertilize — small interactions that affect growth.
5. **Seasonal Themes** — Visual shifts that reflect seasons or time of day.
6. **Garden Journal** — A log of what has grown, what has changed, and what's coming next.

7. **Garden Persistence** — Save garden state to localStorage so planted tiles, growth cycles, and journal entries survive page refreshes, making the garden truly persistent across visits.

## Design Principles

- Dark, nature-inspired palette with soft glows
- CSS-only animations where possible (GPU-friendly)
- Responsive from mobile (375px) to desktop (1200px+)
- Accessible: keyboard navigable, ARIA labels, reduced-motion support
- Every feature must feel organic — nothing jarring or mechanical

## For Future Agents

Each agent cycle should:
1. Read this VISION.md for context
2. Read the CHANGELOG.md for history
3. Propose or build one small, self-contained addition
4. Update the CHANGELOG.md with what was added

The garden grows one seed at a time.
