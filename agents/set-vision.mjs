// One-time: overwrite the wiki Vision page with a clean, durable north star,
// replacing the old feature-tracker content (features now live on the board +
// changelog). Run via workflow_dispatch once; this file can then be deleted.
// After this reset, the Product Owner maintains the vision additively and is
// anchored by the `## Identity` section below.
import fs from "fs";
import { join } from "path";
import { log, printRunSummary, getWikiDir, publishWiki } from "./shared.mjs";

const VISION = `# selfgrow — Vision

## Identity
selfgrow is a living, growing digital garden — a self-contained web app you tend
and watch flourish. It is calm, alive, and entirely its own: no external services,
no accounts, no noise. This is the garden's unchanging core; everything else may
evolve around it.

## What the garden is
A quiet place that feels alive. Creatures visit, weather shifts, flowers bloom and
fade, and the space breathes. Every return feels like coming home to something that
kept growing while you were away.

## Principles
- **Growth over time** — the garden is never finished; each visit and each agent cycle adds something.
- **Self-contained** — everything lives in the browser. No external services, APIs, or accounts.
- **Calm & intentional** — soft motion, gentle color, mindful interaction. A place to pause, not to be busy.
- **Alive, not animated** — motion is botanical: unhurried, eased, organic. Nothing snaps, pops, or spins. When motion respects the pace of real growth, the visitor's breath slows with it.
- **Effortless** — performance is a dimension of calm. If you can feel the code working, the illusion of life breaks.
- **Inclusive** — welcoming to everyone; reduced-motion and accessible alternatives are first-class.
- **Rhythm & ritual** — gentle recurring moments invite the gardener to pause, breathe, and reconnect.
- **Agent-driven** — autonomous agents evolve the garden continuously, each building on the last.

## Direction
The garden began as a single seed that blooms and has grown into a small living
ecosystem. From here it *deepens* more than it widens: a more responsive world,
richer relationships between its inhabitants, and more moments worth returning for —
always calm, always self-contained, always alive.

> Specific features and their status live on the **project board** and in the
> **changelog**, not here. This page is the north star.
`;

function main() {
  log("info", "=== Set Vision (one-time wiki reset) ===");
  const dir = getWikiDir();
  if (!dir) {
    log("error", "Wiki not reachable — enable/initialize it first.");
    printRunSummary("Set Vision");
    return;
  }
  fs.writeFileSync(join(dir, "Vision.md"), VISION, "utf-8");
  log("info", "Wrote a fresh, durable Vision.md to the wiki.");
  publishWiki("Reset Vision to a durable north star (features now live on the board + changelog)");
  printRunSummary("Set Vision");
}

main();
