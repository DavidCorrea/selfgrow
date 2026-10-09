---
name: idle-game-design
description: The craft of idle and incremental games — cost and production curves, pacing of unlocks, prestige layers, offline progress, showing huge numbers, and drawing a world that grows as fast as they do. Load it when planning, building or reviewing anything that changes what the player earns, spends, unlocks or waits for, or how that growth is shown.
---

# Idle game design

The Vision says what this game promises: always a next goal, real offline progress, something new on every visit, systems that touch each other, and no walls. This skill is how idle games keep those promises. Where the two disagree, the Vision wins.

## The core curve

The genre runs on one tension: **costs grow exponentially, production grows linearly, and multipliers bridge the gap.**

- **Cost of the next one:** `base × rate^owned`. A rate between about 1.07 and 1.15 is the usual range. Lower makes a generator stay worth buying for longer, and higher makes it plateau sooner.
- **Production:** `base × owned × multipliers`. Linear in how many you own. That's why cost always catches up eventually, and that catch-up is what makes the next thing worth reaching for.
- **Milestone multipliers**, like ×2 at 25, 50 and 100 owned, give the player a target that's closer than "more". Put different generators' milestones at different counts so the best purchase keeps changing.
- **Buying in bulk** doesn't need a loop. The cost of `n` more when you own `k` is `base × rate^k × (rate^n − 1) / (rate − 1)`. The most you can afford with `c` is `floor(log(c × (rate − 1) / (base × rate^k) + 1) / log(rate))`.

Before shipping a new generator or upgrade, work out how long the next purchase takes at the point the player meets it. If that time jumps, that's a wall. Fix it with a new system, not by making the existing numbers bigger.

## Pacing

- **The first minute decides whether anyone stays.** The first thing to buy should be affordable within seconds, and the first new mechanic should appear within a minute or two.
- **Space out the reveals, then stretch them.** Early on, something new every few minutes. Later, every visit. Hide a system until it's relevant, but let the player see the next goal and roughly how far it is.
- **Every wait comes with a decision.** A wait with nothing to choose (what to buy, where to send, what to save for) is the moment a player closes the tab for good.
- **A new system earns its place by changing an old one:** its output feeds another system, it gives a reason to spend differently, or it adds a trade-off. A second counter that goes up on its own adds nothing.

## Prestige: the deeper layer

When growth flattens, a reset for a lasting bonus makes the old progress matter again.

- **Earn prestige currency sublinearly** from what the run produced. A square root of lifetime earnings is the common choice. It rewards going further without making one long run worth more than several.
- **Offer it at a natural wall**, not before. The bonus should make a new run pass the old wall noticeably faster, and the player should be able to see how much faster before deciding.
- **Say exactly what is kept and what resets** before the player confirms. The Vision forbids progress lost by accident.
- Each layer should add a decision, not just a multiplier: what to keep, which bonus to buy, which region to open next.

## Offline progress

- **Offline time is simulated with the same rules as online time.** One big multiplication is wrong the moment any rate depends on something that changed while the player was away: an unlock reached, a store full, a generator bought. Step through the gap in chunks, or use closed forms where the system allows.
- **Correct after any absence.** A month away must finish quickly and give the same result as a month played. Cap the number of simulation steps, not the time counted.
- **The return summary is part of the design**: what was earned, what was found, what opened up, and what to do next. This is the moment that brings players back.

## Numbers

- **One format everywhere.** A resource shown as `1.2K` in one panel and `1,234` in another reads as two different values.
- **Plan for very large numbers.** Idle games outgrow JavaScript's `Number` (about `1.8e308`) within a few prestige layers. Pick the representation before a layer depends on it, not after.
- **Show rates next to totals**, like `+0.10/s`. Show how far away a goal is as progress or time, not just the number needed.

## Drawing growth that keeps up with the numbers

When the picture is the state, it has to keep up with numbers that grow exponentially on a screen that does not. A thousand of something cannot be a thousand sprites, and a trillion cannot be anything at all, unless the drawing changes how it counts.

- **Map amounts to the picture on a logarithmic scale.** Each tenfold rise should look like a step of the same size: going from 10 to 100 changes the picture as much as going from 1,000 to 10,000. A linear mapping fills the screen in the first hour and has nothing left to show for the rest of the game.
- **Change form, not only count.** Past a threshold, many small things become one bigger thing: seedlings become a bed, a bed becomes a hedge, a hedge becomes a grove. Each new form is a milestone the player can see coming and recognise when it arrives.
- **Grow the space as well as what fills it.** New ground, a wider view, a further row: when one area is as full as it can usefully get, the next layer of growth opens somewhere new rather than crowding the old one.
- **Keep a ceiling on what is drawn.** However large the numbers, the number of sprites on screen stays bounded, so the page stays fast after a month away. Density, size, age and variety carry the rest.
- **Make the mapping one function.** The same amount always draws the same way, everywhere it appears, and the drawing reads the same state the numbers do, so they can never disagree. Test it at 0, 1, the first thresholds, and amounts far beyond anything reached yet.
- **Show the change on return.** After time away, the visitor should see what grew, not only read it: a before and after, or the new things marked until they have been noticed.

## Feedback

- **Every action answers within a tenth of a second**: the number changes, a sprite frame changes, the button responds. A click that seems to do nothing gets clicked twice.
- **Make big moments feel different from small ones.** Buying the 100th generator or a first prestige deserves more than the 3rd.
- **Every flourish has a reduced-motion version that says the same thing in text.** The Vision makes the game fully playable without seeing an animation.

## Checking it

Use the sandbox to fast-forward: an hour, a day, a month. After each, check three things. Is there a next goal? Is there something new to try? Does the return summary account for what happened? A wall that only appears after a day of play is invisible any other way.

## Further reading

Anthony Pecorella, *The Math of Idle Games*, [Part I](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i) and [Part II](https://www.gamedeveloper.com/disciplines/the-math-of-idle-games-part-ii). The source of the cost and bulk-buy formulas above.
