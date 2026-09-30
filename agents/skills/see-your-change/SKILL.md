---
name: see-your-change
description: How to look at the page you changed before handing it on — the measured App Review before and after, and screenshots at desktop and phone size. Load it for any change a visitor to docs/ will see.
---

# See your change

The automated checks prove the page loads and keeps its promises. They do not prove it still looks right. A panel pushed off a phone screen, overlapping text or a button nobody can reach passes all of them, and the next person to notice is the Playtester, days later. Look before you hand it on.

## 1. Measure before you edit

```bash
node agents/app-review.mjs > "${TMPDIR:-/tmp}/review-before.txt" 2>&1
```

It serves `docs/` in a real browser at desktop and phone size, measures the layout, and presses every control. It takes about half a minute and uses no model. Do this first: without a before, you cannot tell what your change broke from what was already broken.

## 2. Measure again when you are done

```bash
node agents/app-review.mjs > "${TMPDIR:-/tmp}/review-after.txt" 2>&1
diff "${TMPDIR:-/tmp}/review-before.txt" "${TMPDIR:-/tmp}/review-after.txt"
```

Every line the diff adds is something your change caused. Fix it before you finish: overflow, overlap, text too small, a target too small to tap, a control that stopped working. A line that was already there before is not yours to fix in this change.

"Could not be exercised" next to a control that is hidden or locked at the start of a session is expected. The sweep cannot press what a new visitor cannot press yet.

## 3. Look at it, if you can see images

```bash
node agents/skills/see-your-change/screenshot.mjs after
```

It prints one PNG path per viewport. Open each with the read tool. Pass `before` instead of `after` in step 1 to have both to compare. If you are a text-only model, the read tool cannot show you the picture, so rely on the measurements.

Look at what you changed with a visitor's eyes: is the thing the ticket asked for visible without searching for it? Does it fit the design around it at both sizes? Does anything look unfinished?

## 4. Say what you saw

Mention in your summary what the App Review showed after your change: "App Review: no new defects", or which ones remain and why. The Reviewer reads it.
