---
name: find-bugs
description: A method for finding real bugs in a change to a browser-only product — read every changed line, map where data enters and where it lands, check a list of the ways such pages break, and confirm each suspicion before reporting it. Load it when reviewing a change to JavaScript or to how docs/ stores, computes or renders data.
license: Apache-2.0 — see LICENSE.txt
---

<!--
Adapted from getsentry/skills, skills/find-bugs (commit d18b7aa8), Apache
License 2.0 — see LICENSE.txt. Changes: the server checklist (SQL, auth, CSRF,
sessions, cryptography) is replaced by the ways a static, browser-only page
breaks; findings go into the Reviewer's issues list and are blocking only as
the Reviewer prompt defines; verification can run the page with drive-the-page.
-->

# Find bugs

The automated layers already prove the change parses, lints, loads without throwing, and passes the product's own checks. What they miss is code that runs cleanly and does the wrong thing. That is what to look for.

## 1. Read all of it

- Run `git diff main...HEAD` and read every changed line. If the output is cut off, read each changed file until you have seen every change.
- List the files the change touches before you judge any of them.
- For each changed function, read its callers too. A change that is right in isolation can break the code that calls it.

## 2. Map where data comes in and where it lands

For each changed file, note:

- **Inputs:** anything a visitor types or pastes (including an imported save code), URL parameters, `localStorage`, timers and elapsed time, values computed from all of these.
- **Sinks:** `innerHTML`, `insertAdjacentHTML`, attribute values, `localStorage` writes, anything that spends, adds or unlocks.
- **State:** what the change reads and writes, and what else reads or writes the same thing.

## 3. Check every changed file against this list

- **Injection:** text from an input, a save code, the URL or storage that reaches `innerHTML` or an attribute unescaped. Use `textContent` or build elements.
- **Saved data:** a read that assumes the shape of the current version. Old saves, missing fields, `null`, invalid JSON.
- **Numbers:** `NaN` from `undefined` or division by zero, overflow past `Number.MAX_VALUE` to `Infinity`, floating-point comparisons that should allow a tolerance, rounding that lets a visitor buy for less than the price.
- **Boundaries:** off-by-one at a threshold (`>` where `>=` was meant), the first and the last item, zero and one.
- **Time:** progress counted in ticks instead of elapsed time, a negative or enormous elapsed time, a timer started without the one before it being stopped.
- **Repeated work:** a listener or timer added on every render, so it fires twice, then three times.
- **Ordering:** a value read before a tick changes it and written after, overwriting the tick's work; an action that checks a condition and then acts on a state that has since changed.
- **State that should be saved and is not**, or is saved and not restored on reload.
- **Errors:** a `catch` that swallows a failure the visitor needed to know about.

## 4. Confirm before you report

For each suspicion:

- Check whether the changed code already handles it somewhere else.
- Check whether an existing check in `docs/selftest.js` covers it.
- Where it is cheap, make it happen with `drive-the-page`. A finding you reproduced is a finding; one you only suspect needs evidence from the code that it is reachable.

Drop anything you cannot support. An invented finding costs a whole build cycle.

## 5. Before you conclude

List for yourself the files you read completely, the items above you checked, and anything you could not verify and why. Then report.

Each finding names the file and line, what goes wrong, the evidence that it is real, and the fix. A bug that makes the change do the wrong thing, or lose a visitor's progress, is blocking. Everything else in this list that you confirm but that does not break anything a visitor does is worth one line in your summary, not a revise.
