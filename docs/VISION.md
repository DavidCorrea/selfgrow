# selfgrow — Vision

## Concept

**selfgrow** is a living, growing digital garden — a self-contained web app that nurtures a virtual ecosystem users can tend and watch flourish.

## Core Philosophy

- **Growth over time**: The app evolves. Each interaction, each visit, each agent cycle adds something new.
- **Self-contained**: No external services, no APIs, no dependencies. Everything lives in the browser.
- **Calm & intentional**: Soft animations, gentle colors, and mindful interactions. This is a place to pause.
- **Agent-driven evolution**: Autonomous agents (Scout → Validator → Builder) iteratively expand the garden, each building on the last.

- **Alive & responsive**: The garden should feel like a living thing — creatures visit, weather shifts, flowers sway, and the space breathes. Every return visit should feel like coming home to something that has continued growing in your absence.

- **Organic motion**: Every animation in the garden should feel botanical — never snapping or popping, always easing. Stems grow upward gradually, buds form before flowers open, and blooms scale and fade in gently. Even under varying growth speeds, the motion quality stays consistent: unhurried, fluid, and alive. A spin or abrupt appearance breaks the illusion of life.

## Direction

The app starts simple — a seed that blooms — and grows into a richer experience:

1. **Seed & Bloom** — Interactive welcome with a CSS-animated seed-to-flower micro-interaction. ✅
2. **Garden Grid** — A grid of plantable tiles where users can grow different flora. ✅
3. **Growth Cycles** — Time-based progression: seeds sprout, grow, bloom, and seed again. ✅
4. **Tending Actions** — Water, prune, fertilize — small interactions that affect growth. ✅
5. **Seasonal Themes** — Visual shifts that reflect seasons or time of day. ✅
6. **Garden Journal** — A log of what has grown, what has changed, and what's coming next. ✅
7. **Garden Persistence** — Save garden state to localStorage so planted tiles, growth cycles, and journal entries survive page refreshes, making the garden truly persistent across visits. ✅
8. **Ambient Soundscape** — Soft, procedurally generated ambient audio (birdsong, gentle breeze, water droplets) that shifts with the time-of-day themes, deepening the meditative quality of the garden. Users can toggle the soundscape on/off. ✅
9. **Garden Reflection Stats** — A gentle statistics panel showing the garden's overall health: total flowers bloomed, current season, time since last tending, and a "garden mood" based on how well-tended it is. ✅
10. **Garden Moments** — A way to capture and share a snapshot of the garden at a point in time: the current layout of tiles, bloom colors, weather, season, and mood rendered as a small shareable card. ✅
11. **Garden History Timeline** — A collapsible section in the journal panel that records chronological visit snapshots (date/time, planted count, mood, flower count, weather) with poetic descriptions, persisting via localStorage. ✅
12. **Garden Export/Import** — Download full garden state as a JSON file and restore from a previously exported file, enabling sharing between devices. ✅
13. **Distinct Flower Morphology** — Five unique CSS flower types (daisy, tulip, rose, star, lily) with distinct petal shapes, sizes, and arrangements, making each planted tile visually unique. ✅
14. **Seed Collection & Replanting** — Collect seeds from blooming flowers, preserving flower type, color palette, and collection date. Plant collected seeds on empty tiles to grow specific flower types with their original colors. Seeds persist via localStorage. ✅

15. **Garden Milestones** — Gentle, non-competitive recognition of growth milestones (first bloom, all five flower types collected, 10 flowers bloomed, garden tended for 7 days) that appear as soft notifications in the journal. Milestones celebrate the gardener's journey without gamification pressure, fitting the calm and intentional philosophy.

16. **Ecosystem Interactions** — Creatures and plants influence each other: bees visiting blooming flowers boost their growth speed, ladybugs resting on a tile gently wilt nearby weeds, and seasonal creatures (earthworms in spring, crickets in summer) emerge only in their matching season. The garden becomes a web of small relationships rather than independent systems.

17. **Garden Whispers** — Ambient context-aware poetic micro-observations that emerge organically from the garden's state. Whispers appear as soft, translucent text overlays that fade in, float gently upward, and fade out over 12-14 seconds. The system evaluates weather, season, time of day, bloom count, creature activity, and tending history to select contextually appropriate poetic observations from a curated pool. Users can toggle whispers on/off via a 💬 button. Whispers respect `prefers-reduced-motion` (instant show/hide, no float), use GPU-friendly transforms only, and follow the dark nature palette with soft glow text-shadow.

## Completed Features

All core vision items and major enhancements have been implemented, including Garden Reflection Stats, Garden Moments, Garden History, Garden Export/Import, Garden Gallery, Garden Rings bloom visualization, garden completion celebration, self-seeding volunteer plants, weather system with growth integration, six flower type morphology (including the night-blooming moonflower), Seed Collection & Replanting, Garden Ground Creatures (ladybugs, snails, worms, crickets), Meteorological Seasons with calendar-based overlays, Garden Aging between visits, Garden Milestones, Ecosystem Interactions, Garden Creature Encyclopedia, and Garden Whispers. The garden is a fully-featured living digital ecosystem.
