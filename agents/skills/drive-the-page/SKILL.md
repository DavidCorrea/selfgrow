---
name: drive-the-page
description: How to run docs/ in a real browser through exact steps you write — press, type, wait, reload, read what the page shows — and check what holds. Use it to reproduce a reported symptom before a fix, confirm it is gone after, or verify that a change does what it claims instead of reading the diff and trusting it.
---

<!--
The idea comes from anthropics/skills, skills/webapp-testing: drive the app with
Playwright rather than reason about it. No text or code is taken from it; the
script reuses the static server and viewports the build's own verification uses.
-->

# Drive the page

Reading code tells you what it should do. Running it tells you what it does. When a ticket reports a symptom, or a summary claims a fix, run the steps and watch the result.

The App Review presses every control once. This is for a specific sequence: "buy three of these, reload, the count is still three"; "leave it for ten seconds, the number grew"; "press twice quickly, it only spent once".

## Write the steps

A steps file is a small module outside `docs/`, in the temp directory, so no commit picks it up:

```bash
cat > "${TMPDIR:-/tmp}/steps.mjs" <<'EOF'
export default async ({ page, url, check, note, shot }) => {
  const count = async () => Number(await page.locator("#upgrade-count").textContent());

  await page.click("#buy-upgrade");
  await page.click("#buy-upgrade");
  note(`count after two presses: ${await count()}`);
  check((await count()) === 2, "two presses buy two upgrades");

  await page.reload({ waitUntil: "networkidle" });
  check((await count()) === 2, "the purchase survives a reload");
  await shot("after-reload");
};
EOF
node agents/skills/drive-the-page/drive.mjs "${TMPDIR:-/tmp}/steps.mjs"          # desktop
node agents/skills/drive-the-page/drive.mjs "${TMPDIR:-/tmp}/steps.mjs" phone    # touch, 390 px wide
```

The page starts freshly loaded with empty storage, as a first-time visitor sees it. `page` is a Playwright page, so everything Playwright can do is available: `click`, `fill`, `keyboard.press`, `waitForTimeout`, `locator(...).textContent()`, `isEnabled()`, `evaluate(() => ...)` to read or set state inside the page (for example, writing a saved state to `localStorage` before a reload).

- `check(condition, message)` records a pass or a failure. Word the message as what should hold.
- `note(message)` prints what you observed, for the record.
- `shot(name)` saves a full-page screenshot and prints its path; open it with the read tool if you can see images.

The script prints every check, then every error the page threw or logged, and exits 1 if a check failed, the page threw, or the steps crashed. Steps time out after 60 seconds.

## Find what to press

Read the markup for ids, labels and roles before guessing selectors. Prefer what a visitor would use: `page.getByRole("button", { name: "Save" })` keeps working when an id changes, and fails when the button's name stops describing it, which is a bug too.

## Use it to

- **Reproduce before you fix.** Write the steps from the report and run them first: a failing check is proof you found the symptom. If they pass, you have not reproduced it yet; do not fix what you cannot see.
- **Confirm after.** Run the same steps again. The check that failed now passes, and nothing else does worse.
- **Verify a claim.** When reviewing, turn the change's claim into steps and run them, rather than accepting the summary.

A sequence worth keeping belongs in `docs/selftest.js` as a check, so it runs on every build. These scripts are for finding and confirming; the self-check is what keeps it fixed.
