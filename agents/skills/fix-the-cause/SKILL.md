---
name: fix-the-cause
description: How to fix a bug so it stays fixed — reproduce it, find its root cause before changing code, prove it with a failing self-check, change one thing, and show evidence it is gone before saying so. Load it for any ticket that reports something broken, and whenever a fix of yours did not work or the build rejected it.
license: MIT — see LICENSE
---

<!--
Adapted from obra/superpowers, skills/systematic-debugging and
skills/verification-before-completion (commit 8ca22dba), MIT License — see
LICENSE. Changes: condensed into one method for this pipeline; the human
partner, CI and keychain examples are replaced by the reported symptom,
drive-the-page and verify-product; "discuss with your human partner" after
three failed fixes becomes stopping and saying so, because the pipeline parks
the ticket and records why.
-->

# Fix the cause

A fix that makes the symptom disappear without explaining it usually moves the bug, and the Playtester reports it again a week later. Find out why it happens, then fix that.

## 1. Reproduce it

Before changing any code:

- **Read the report and every error completely.** The message, the line, the value it complained about often say exactly what is wrong.
- **Make it happen.** Write the steps from the report and run them with `drive-the-page`. A failing check is proof you are looking at the right thing. If you cannot make it happen, you do not understand it yet: gather more (another viewport, a reload, a longer wait, a saved state from an older version), and do not guess.
- **Look at what changed.** `git log -p -- docs/<file>` on the code involved. A bug that appeared recently usually came in with a recent change.

## 2. Find the cause

- **Trace the bad value back to where it was born.** Where is it displayed, where was it computed, what fed that? Keep going until you reach the first place it went wrong. That is where the fix goes, not where it shows.
- **Compare with something that works.** Find similar code in `docs/` that behaves correctly and list every difference, including the ones that "can't matter".
- **State one hypothesis:** "X is the cause because Y." Test it with the smallest change or a `note` in your steps, one thing at a time. If it was wrong, form a new one; do not stack a second fix on a failed first.

## 3. Prove it, then fix it

- **Write the failing check first.** Add a check to `docs/selftest.js` that reproduces the bug, then run `node agents/verify-product.mjs` and watch it fail for the reason you expect. A check you never saw fail proves nothing.
- **Make one change that addresses the cause.** No improvements while you are there, no refactoring in the same change. If you find something else worth fixing, that is a `techDebt` note.
- **Run it again.** The new check passes and no other check fails.

## 4. Show it is gone

Do not say "fixed" until you have, in this session, after your last edit:

- run `node agents/verify-product.mjs` and read its result,
- run your reproduction steps again and seen the check that failed now pass,
- looked at the page as `see-your-change` describes, if a visitor can see the change.

Say what you ran and what it showed. "Should work" and "probably fixes it" are not evidence; neither is a check that was green before you started.

## When fixes keep failing

Count your attempts. If a fix did not work, go back to step 1 with what you learned. After three fixes that did not hold, or when each fix exposes a new problem somewhere else, stop: the approach is wrong, not the details. Do not try a fourth. Say in your summary what you tried, what each attempt showed, and what you now think the real obstacle is. That is what lets the next attempt start in the right place.

## Signs you are guessing

- "Let me just try changing X."
- Several changes at once, then running the checks to see what happens.
- A fix written before you could make the bug happen.
- Skipping the failing check because you will "verify it manually".
- Wording like "should", "seems to", "probably" in your summary.

Each of these means going back to step 1.
