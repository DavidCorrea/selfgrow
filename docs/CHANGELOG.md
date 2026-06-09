# Changelog

## 2026-06-09

- **Added Garden Milestones system (implements VISION.md #15)**: A gentle, non-competitive recognition system that tracks four organic growth milestones — first bloom, all five flower types collected, ten flowers bloomed, and seven distinct days of tending. Milestone unlocks appear as warm amber/gold notification cards in the journal timeline with poetic descriptions, a soft breathing glow animation, and GPU-friendly transforms. Milestone state persists via localStorage so they never re-trigger. The `recordTendDay()` function tracks distinct calendar days with garden interactions (watering, fertilizing, pruning) to detect the 7-day milestone. All milestone checks are triggered from existing bloom/plant/collection events — no polling or external services. CSS respects `prefers-reduced-motion` and uses relative units for responsive sizing at 375px, 768px, and 1200px+.

## 2026-06-08

- **Removed dead imports `fertilizedTiles` and `totalVolunteers` from garden-moments.js (closes #10)**: Both were imported from state.js but never referenced anywhere in the file's logic. Removed them from the import statement to keep the module clean.

- **Improved UX clarity for history toggle and seed collection mode (closes #10)**: Added a visible "history" label alongside the 📖 icon in the journal header so users can clearly identify the button's purpose. Enhanced seed collection mode with a pulsing 🌰 seed icon overlay on each blooming tile and a persistent instruction banner ("Tap a blooming flower to collect its seeds") that appears in the toolbar when collect mode is active. Both changes use existing CSS animation patterns, require no external dependencies, and respect `prefers-reduced-motion`.

## 2026-06-08

- **Removed dead `revealHistoryToggle` export from garden-history.js**: The function was exported but no longer imported anywhere in script.js (the import was removed in a previous cleanup but the export was left behind). Removed the unused export to keep the codebase clean.

- **Fixed welcome card not updating on garden restore**: When returning to a saved garden, the welcome card now transitions to a 'garden keeper' state showing the bloomed flower with a personalized returning-visitor message (e.g. 'welcome back, garden keeper — 5 flowers blooming') instead of still showing 'click the soil to plant a seed' alongside a thriving grid. Added `restoreWelcomeCard()` export in `persistence.js` that sets the sprout to its grown state, fades out the hint, shows a contextual message with the current flower count, and intensifies the card glow. In `script.js`, the `planted` flag is now set to `true` during restoration so the seed-planting animation is skipped for returning visitors.

- **Added Seed Collection & Replanting system**: Users can now collect seeds from blooming flowers by activating the new 🌰 'seeds' tool in the toolbar and clicking on grown (blooming) tiles. Collected seeds capture the flower's morphology type (daisy/tulip/rose/star/lily), petal color palette, and center color. Seeds appear in a new 'Seed Packets' panel in the sidebar (above the journal) as illustrated cards showing the flower type emoji, name, collection date, and color swatches. Users can select a seed packet to enter planting mode, then click an empty tile to plant that specific flower type with its original color palette instead of a random one. Seeds are consumed on planting and persist via localStorage between sessions. Blooming tiles glow warmly when collect mode is active, and empty tiles pulse invitingly when a seed is selected for planting. Journal entries are logged for both collecting and planting events. The collection count badge updates in real-time.

## 2026-06-08

- **Fixed dead code and stale documentation**: Removed dead `revealHistoryToggle` import from script.js, removed dead `notifyGardenHistory` export from garden-history.js, removed dead `createExportImportButtons` export from export-import.js, removed dead `isGalleryOpen` export from garden-gallery.js, removed dead `resetCelebration` export from celebration.js, removed unused `SVG_CENTER` variable from garden-rings.js, and updated VISION.md to accurately list all completed features (Garden Reflection Stats, Garden Moments, Garden History, Garden Export/Import, Distinct Flower Morphology).

- **Added distinct CSS flower morphology for five flower types**: The data model already assigned flower types (daisy, tulip, rose, star, lily) to each planted tile via `tileFlowerTypeMap` and applied `flower-*` CSS classes on `.tile-sprout` elements, but zero corresponding CSS rules existed — every tile rendered identically. Added CSS-only morphology styles for each type: daisy (elongated oval petals, larger center), tulip (cupped/funnel-shaped petals forming a cup), rose (layered spiral petals with tighter center), star (pointed narrow petals in a star pattern), and lily (recurved petals with prominent stamen pseudo-elements). Moment card mini-flowers also get matching treatment. All styles are scoped under `.flower-*` classes, respect `prefers-reduced-motion`, use relative units, and require no JS changes or new DOM elements. Purely additive visual enrichment that makes each tile feel unique and alive.

## 2026-06-07

- **Fixed layout to use available screen space effectively (closes #9)**: Restructured the layout to introduce a centered max-width container (72rem/1152px, 80rem/1280px at 1440px+) on `.app-shell` so content doesn't stretch edge-to-edge. Introduced a 3-column grid (`200px 1fr 220px`) at 768px instead of 1200px, making effective use of tablet screen real estate. The garden grid now uses `max-width: 100%` to fill its column naturally, becoming the dominant visual element. Consistent 0.75rem gap spacing between all panels. On narrow viewports (<768px), the single-column stack is maintained with proper padding. At 1200px, columns widen to `220px 1fr 280px`; at 1440px, `240px 1fr 300px` with 80rem container. All changes are CSS-only — no HTML or JS modifications.
- **Added Garden Export/Import system for sharing between devices**: Users can now download their full garden state as a JSON file ('Export Garden' button) and restore from a previously exported file ('Import Garden' button). The export serializes all garden data — planted tiles, growth cycles, journal entries, colors, weather, stats, flower morphology types — into a downloadable 'selfgrow-garden-YYYY-MM-DD.json' file with a poetic header comment.
- **Added Garden History timeline showing evolution across sessions**: A new collapsible 'garden history' section in the journal panel that records a lightweight snapshot (date/time, planted count, mood, flower count, weather) on each visit. Snapshots persist via localStorage, capped at 20 to prevent bloat.
- **Fixed Garden Gallery bugs and dead import (closes #8)**: (1) Fixed CRITICAL ReferenceError — renamed the call to the correct `updateGalleryStats()` function so the gallery modal renders properly. (2) Fixed `getBloomTimeline()` reading incorrect property names. (3) Removed dead `recordBloom` import from `script.js`.
- **Added Garden Gallery modal and performance optimizations (closes #8)**: Added a 'Garden Gallery' button with GPU-accelerated canvas visualization of all bloomed flowers. Fixed performance issues by reducing weather particle counts by 60%, limiting concurrent visitors to 5 max, adding `content-visibility: auto` and `contain: strict` to tile CSS.
- **Capped ringsData array to prevent unbounded growth (closes #7)**: Added a cap of 20 entries after each `push()` so memory usage and localStorage cost stay constant regardless of session length.

## 2026-06-06

- **Fixed Reviewer issue — dead CSS class `.grid-tile.pruned-tile`**: Added `tileEl.classList.add('pruned-tile')` in `pruneTile()` and removal in `startGrowthCycle()` so the class is properly applied.
- **Fixed Reviewer issues**: (1) Removed dead code re-declarations in `js/tiles.js`: `addWateredIcon` and `addFertilizedIcon` were imported from `persistence.js` but then re-declared as local functions. (2) Removed dead `stopWeather()` function in `js/weather.js`.
- **Added Garden Rings bloom history visualization**: Concentric softly glowing rings representing each bloom cycle completed across the entire garden, using actual petal colors from `tileColorMap`.
- **Added garden completion celebration**: When all 9 tiles are planted, a warm golden radial glow overlay washes across the viewport, soft luminous amber particles drift upward, and the mood shifts to 'complete'.
- **Code quality pass — fixed all Reviewer issues**: Removed dead code and unnecessary `!important` flags, broke circular dependency between modules, fixed typos, consolidated duplicate media queries.
- **Added prune tending tool**: A new prune button (✂️) in the toolbar with warm sage/olive accent. Pruning skips the wilt and restarts growth immediately.
- **Implemented perennial regrowth animation for cycle 2+ (closes #6)**: For cycle 2+, the stem and leaves persist in a dormant state while only the flower collapses, then a new bud emerges from the top of the existing stem.

## 2026-06-05

- **Fixed module export/import issues**: Fixed CRITICAL runtime error where `addFertilizedIcon` was missing `export` keyword but was imported. Removed dead imports and exports across modules.
- **Added fertilize tending tool**: A new fertilize button (🌾) in the toolbar. Fertilized tiles get a permanent 30% growth speed boost, warm amber/olive border glow, and persistent icon.
- **Restructured layout into contained app-like dashboard (closes #5)**: Transformed scrolling single-column landing page into a fixed-viewport app shell using CSS Grid. On desktop (1200px+), 3-column grid layout.
- **Added garden self-seeding mechanic**: Empty tiles can spontaneously sprout volunteer wildflower plants when the garden is thriving (3+ blooming flowers). Volunteers use a distinct wildflower palette and display with a 🌿 badge.

## 2026-06-04

- **Fixed critical runtime TypeError in revealGrid override**: Removed broken reassignment that threw at runtime, preventing several init functions from executing.
- **Fixed persistence.js missing weather journal entry restore**: `restoreGardenState()` now handles `type: 'weather'` journal entries.
- **Removed dead code and duplicate functions**: Cleaned up unused imports/exports, removed duplicate `addWateredIcon()`, `createTileSparkles()`, and `formatTime()`.
- **Connected weather system to garden growth mechanics**: Weather now directly affects tile growth cycles: rain auto-waters (40% faster), sun accelerates (15% faster), snow extends durations by 40%.
- **Refactored monolithic script.js into modular architecture**: Split ~2100-line monolithic script.js into focused module files under docs/js/.
- **Added animated weather system with four states (sunny, rainy, cloudy, snowy)**: Atmospheric weather overlay that cycles automatically every 2-3 minutes.
- **Modernized layout with responsive multi-column design (closes #4)**: Two-column layout on desktop with welcome card and garden grid side-by-side.
- **Widen layout for larger viewports**: Container and grid now expand properly at 768px+ and 1200px+ breakpoints.
- **Fixed VISION.md duplicate entry**: Removed duplicate roadmap item #9.
- **Added Garden Reflection Stats panel**: Shows total flowers bloomed, time-of-day season, time since last tending, and garden mood indicator.
- **Added ambient soundscape using Web Audio API**: Procedurally generated nature sounds (sine wave drones, bird chirps, water droplets, crickets) that shift with time-of-day themes.
- **Added animated garden visitors (butterflies, bees, fireflies)**: CSS-animated butterflies and bees flutter across the garden, attracted to blooming flowers. Fireflies appear at night.

## 2026-06-03

- **Added welcome screen with seed-bloom micro-interaction**: Centered card with title "selfgrow", interactive CSS-animated seed that sprouts into a flower when clicked. Dark gradient background, soft glow card, sparkle particles on bloom.
- **Created VISION.md**: Defined the app's direction as a living, growing digital garden with core philosophy, growth roadmap, and design principles.
- **Added 3x9 garden grid of plantable tiles**: After welcome seed blooms, a 3x3 grid fades in. Each tile can be clicked to plant a unique flower with randomized petal colors. Counter tracks planted tiles.
- **Added growth cycle animations (sprout → bud → bloom → wilt → reseed)**: Continuous life cycle with varied timing per tile. Cycle badges (🌸 N) appear. Journal logs each new bloom cycle.
- **Added seasonal time-of-day theme transitions**: Garden shifts color palette based on user's current hour — dawn, day, dusk, night — with smooth 1.5s transitions.
- **Added Garden Journal panel**: Parchment-inspired scrollable journal logging planting events with timestamps, tile numbers, flower sequence, and color swatches.
- **Added garden persistence via localStorage**: Garden state saved and restored on page load, including planted tiles, growth cycle states, watering status, and journal entries.
- **Added interactive watering can tool**: Watering mode where clicking planted tiles triggers water droplet animation, sparkles, bloom glow, and persistent water icon. Watered tiles get 50% growth speed boost.
- **Added prefers-reduced-motion media query**: Comprehensive rule that collapses all animation/transition durations to near-zero, disables flower sway, hides sparkle particles.
- **Removed unused --petal-alt CSS variable**: Removed dead code to keep CSS clean.
- **Removed dead code**: Cleaned up unused variables/functions: `originalPlantTileFn`, `wateringMessages` array, `hasSavedGarden` variable. Wrapped `restoreGardenState()` call in a guard to eliminate the separate boolean.
