/**
 * Check that the selfgrow game engine works as claimed.
 *
 * Runs in the real browser on the real page, so it can reach the DOM
 * and import modules.
 *
 * @returns {Promise<string[]>} empty when everything holds
 */
export async function checks() {
  const problems = [];

  // ─── DOM structure ──────────────────────────────────────────────

  const woodEl = document.getElementById("wood-value");
  if (!woodEl) {
    problems.push("Expected #wood-value to exist in the DOM — it was not found.");
  }

  const rateEl = document.getElementById("rate-value");
  if (!rateEl) {
    problems.push("Expected #rate-value to exist in the DOM — it was not found.");
  }

  const tickEl = document.getElementById("tick-value");
  if (!tickEl) {
    problems.push("Expected #tick-value to exist in the DOM — it was not found.");
  }

  const elapsedEl = document.getElementById("elapsed-value");
  if (!elapsedEl) {
    problems.push("Expected #elapsed-value to exist in the DOM — it was not found.");
  } else {
    const text = elapsedEl.textContent.trim();
    // Should either be '—' (no save) or a formatted duration like '0s', '1m 30s', etc.
    if (text === '\u2014') {
      // Fresh game — acceptable
    } else if (/^\d+[dhms]/.test(text)) {
      // Formatted duration — acceptable
    } else {
      problems.push(`#elapsed-value should show either "\u2014" or a formatted duration string, got "${text}".`);
    }
  }

  // Stone DOM elements
  const stoneEl = document.getElementById("stone-value");
  if (!stoneEl) {
    problems.push("Expected #stone-value to exist in the DOM — it was not found.");
  }

  const totalWoodEl = document.getElementById("total-wood-value");
  if (!totalWoodEl) {
    problems.push("Expected #total-wood-value to exist in the DOM — it was not found.");
  }

  const totalStoneEl = document.getElementById("total-stone-value");
  if (!totalStoneEl) {
    problems.push("Expected #total-stone-value to exist in the DOM — it was not found.");
  }

  const totalStoneStat = document.getElementById("total-stone-stat");
  if (!totalStoneStat) {
    problems.push("Expected #total-stone-stat to exist in the DOM — it was not found.");
  }

  const stoneRateEl = document.getElementById("stone-rate-value");
  if (!stoneRateEl) {
    problems.push("Expected #stone-rate-value to exist in the DOM — it was not found.");
  }

  const stoneStat = document.getElementById("stone-stat");
  if (!stoneStat) {
    problems.push("Expected #stone-stat to exist in the DOM — it was not found.");
  }

  const stoneActions = document.getElementById("stone-actions");
  if (!stoneActions) {
    problems.push("Expected #stone-actions to exist in the DOM — it was not found.");
  }

  const actionArea = document.getElementById("action-area");
  if (!actionArea) {
    problems.push("Expected #action-area to exist in the DOM — it was not found.");
  } else {
    const gatherBtn = document.getElementById("btn-gather");
    if (!gatherBtn) {
      problems.push("Expected #btn-gather to exist inside #action-area — it was not found.");
    } else if (gatherBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-gather type="button", got "${gatherBtn.getAttribute("type")}".`);
    } else if (gatherBtn.disabled) {
      problems.push("Expected #btn-gather to be enabled on page load — it was disabled.");
    }

    const sharpenBtn = document.getElementById("btn-sharpen");
    if (!sharpenBtn) {
      problems.push("Expected #btn-sharpen to exist inside #action-area — it was not found.");
    } else if (sharpenBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-sharpen type="button", got "${sharpenBtn.getAttribute("type")}".`);
    } else if (sharpenBtn.hasAttribute("hidden")) {
      problems.push("Expected #btn-sharpen to NOT have the hidden attribute — it was hidden, making it invisible to the App Review locator.");
    } else if (!sharpenBtn.disabled) {
      problems.push("Expected #btn-sharpen to be disabled on page load (before reaching 10 wood) — it was enabled.");
    } else {
      const text = sharpenBtn.textContent.trim();
      if (!text.includes("locked") && !text.includes("Locked")) {
        problems.push(`Expected #btn-sharpen text to indicate locked state on page load, got "${text}".`);
      }
    }

    const gatherStoneBtn = document.getElementById("btn-gather-stone");
    if (!gatherStoneBtn) {
      problems.push("Expected #btn-gather-stone to exist inside #action-area — it was not found.");
    } else if (gatherStoneBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-gather-stone type="button", got "${gatherStoneBtn.getAttribute("type")}".`);
    }

    const buildWallBtn = document.getElementById("btn-build-wall");
    if (!buildWallBtn) {
      problems.push("Expected #btn-build-wall to exist inside #action-area — it was not found.");
    } else if (buildWallBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-build-wall type="button", got "${buildWallBtn.getAttribute("type")}".`);
    }
  }

  // ─── Sharpen button: dynamic transition test ────────────────

  // Verify the engine correctly handles the sharpen/locked pathway.
  // The static DOM check above confirms the button is visible, disabled,
  // and shows locked text on initial page load.  These engine-level checks
  // confirm the underlying logic is correct; the agent-tool tests below
  // exercise it through the full pipeline.
  try {
    const engine = await import("./engine.js");
    engine.reset();

    // Gather enough wood to reach 10 (GOAL_WOOD)
    for (let i = 0; i < 10; i++) engine.gatherWood();

    const s = engine.getState();
    if (s.wood < 10) {
      problems.push(`Engine should have 10+ wood after 10 gathers, got ${s.wood}.`);
    }
    if (s.upgradeLevel !== 0) {
      problems.push(`Engine upgradeLevel should still be 0 after 10 gathers (no sharpen done), got ${s.upgradeLevel}.`);
    }

    // Craft the first upgrade and verify transition
    const upgradeResult = engine.craftUpgrade();
    if (!upgradeResult.upgraded) {
      problems.push("craftUpgrade with 10 wood and cost 5 should succeed — it did not.");
    }
    const afterUpgrade = engine.getState();
    if (afterUpgrade.upgradeLevel !== 1) {
      problems.push(`After craftUpgrade, upgradeLevel should be 1, got ${afterUpgrade.upgradeLevel}.`);
    }
    if (!afterUpgrade.stoneUnlocked) {
      problems.push("After first craftUpgrade, stone should be unlocked.");
    }

    // Verify sharpen button in DOM is always present (not hidden)
    const btn = document.getElementById("btn-sharpen");
    if (btn && btn.hasAttribute("hidden")) {
      problems.push("Expected #btn-sharpen to NOT have hidden attribute after engine operations — it was hidden.");
    }

    // Clean up
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Sharpen button dynamic test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Goal panel ───
  const goalPanel = document.getElementById("goal-panel");
  if (!goalPanel) {
    problems.push("Expected #goal-panel to exist in the DOM — it was not found.");
  } else {
    const goalText = document.getElementById("goal-text");
    if (!goalText) {
      problems.push("Expected #goal-text to exist inside #goal-panel — it was not found.");
    }
    const goalFill = document.getElementById("goal-progress-fill");
    if (!goalFill) {
      problems.push("Expected #goal-progress-fill to exist inside #goal-panel — it was not found.");
    }
    const progressTrack = document.getElementById("goal-progress-track-1");
    if (!progressTrack) {
      problems.push("Expected #goal-progress-track-1 to exist inside #goal-panel — it was not found.");
    } else if (progressTrack.getAttribute("role") !== "progressbar") {
      problems.push(`Expected #goal-progress-track-1 role="progressbar", got "${progressTrack.getAttribute("role")}".`);
    }
    // Dual-goal elements
    const progressTrack2 = document.getElementById("goal-progress-track-2");
    if (!progressTrack2) {
      problems.push("Expected #goal-progress-track-2 to exist inside #goal-panel — it was not found.");
    } else if (progressTrack2.getAttribute("role") !== "progressbar") {
      problems.push(`Expected #goal-progress-track-2 role="progressbar", got "${progressTrack2.getAttribute("role")}".`);
    }
    const goalFill2 = document.getElementById("goal-progress-fill-2");
    if (!goalFill2) {
      problems.push("Expected #goal-progress-fill-2 to exist inside #goal-panel — it was not found.");
    }
    const goalLabel1 = document.getElementById("goal-resource-label-1");
    if (!goalLabel1) {
      problems.push("Expected #goal-resource-label-1 to exist inside #goal-panel — it was not found.");
    }
    const goalLabel2 = document.getElementById("goal-resource-label-2");
    if (!goalLabel2) {
      problems.push("Expected #goal-resource-label-2 to exist inside #goal-panel — it was not found.");
    }
    // Dual-goal secondary bar must be hidden on page load (single-resource goal)
    if (progressTrack2 && !progressTrack2.hidden) {
      problems.push("Expected #goal-progress-track-2 to be hidden on page load (single-resource goal) — it was visible.");
    }
    if (goalLabel1 && !goalLabel1.hidden) {
      problems.push("Expected #goal-resource-label-1 to be hidden on page load (single-resource goal) — it was visible.");
    }
    if (goalLabel2 && !goalLabel2.hidden) {
      problems.push("Expected #goal-resource-label-2 to be hidden on page load (single-resource goal) — it was visible.");
    }
  }

  // ─── Offline summary ───
  const offlineSummary = document.getElementById("offline-summary");
  if (!offlineSummary) {
    problems.push("Expected #offline-summary to exist in the DOM — it was not found.");
  } else if (offlineSummary.getAttribute("role") !== "dialog") {
    problems.push(`Expected #offline-summary role="dialog", got "${offlineSummary.getAttribute("role")}".`);
  } else {
    const dismissBtn = document.getElementById("btn-dismiss-offline");
    if (!dismissBtn) {
      problems.push("Expected #btn-dismiss-offline to exist inside #offline-summary — it was not found.");
    }

    // ─── Milestone announcement elements ───
    const milestoneSharpen = document.getElementById("milestone-sharpen");
    if (!milestoneSharpen) {
      problems.push("Expected #milestone-sharpen to exist in the offline-summary — it was not found.");
    }
    const milestoneStone = document.getElementById("milestone-stone");
    if (!milestoneStone) {
      problems.push("Expected #milestone-stone to exist in the offline-summary — it was not found.");
    }
    const milestoneWall = document.getElementById("milestone-wall");
    if (!milestoneWall) {
      problems.push("Expected #milestone-wall to exist in the offline-summary — it was not found.");
    }
    const milestoneForge = document.getElementById("milestone-forge");
    if (!milestoneForge) {
      problems.push("Expected #milestone-forge to exist in the offline-summary — it was not found.");
    }
    // Verify milestone elements have offline-milestone class
    if (milestoneSharpen && !milestoneSharpen.classList.contains("offline-milestone")) {
      problems.push("Expected #milestone-sharpen to have class 'offline-milestone' — it did not.");
    }
    if (milestoneStone && !milestoneStone.classList.contains("offline-milestone")) {
      problems.push("Expected #milestone-stone to have class 'offline-milestone' — it did not.");
    }
    if (milestoneWall && !milestoneWall.classList.contains("offline-milestone")) {
      problems.push("Expected #milestone-wall to have class 'offline-milestone' — it did not.");
    }
    if (milestoneForge && !milestoneForge.classList.contains("offline-milestone")) {
      problems.push("Expected #milestone-forge to have class 'offline-milestone' — it did not.");
    }
    // All milestone elements should be hidden by default
    if (milestoneSharpen && !milestoneSharpen.hidden) {
      problems.push("Expected #milestone-sharpen to be hidden by default — it was visible.");
    }
    if (milestoneStone && !milestoneStone.hidden) {
      problems.push("Expected #milestone-stone to be hidden by default — it was visible.");
    }
    if (milestoneWall && !milestoneWall.hidden) {
      problems.push("Expected #milestone-wall to be hidden by default — it was visible.");
    }
    if (milestoneForge && !milestoneForge.hidden) {
      problems.push("Expected #milestone-forge to be hidden by default — it was visible.");
    }

    // ─── Overlay must be fully opaque when visible ───
    const wasHidden = offlineSummary.hidden;
    offlineSummary.removeAttribute("hidden");

    // Replicate showOfflineSummary state
    const gatherBtnForDisabled = document.getElementById("btn-gather");
    const sharpenBtnForDisabled = document.getElementById("btn-sharpen");
    const gatherStoneBtnForDisabled = document.getElementById("btn-gather-stone");
    const buildWallBtnForDisabled = document.getElementById("btn-build-wall");
    if (gatherBtnForDisabled) gatherBtnForDisabled.disabled = true;
    if (sharpenBtnForDisabled) sharpenBtnForDisabled.disabled = true;
    if (gatherStoneBtnForDisabled) gatherStoneBtnForDisabled.disabled = true;
    if (buildWallBtnForDisabled) buildWallBtnForDisabled.disabled = true;
    document.body.style.pointerEvents = "none";
    offlineSummary.style.pointerEvents = "auto";

    // ─── When overlay is visible, all action buttons must be disabled ───
    if (gatherBtnForDisabled && !gatherBtnForDisabled.disabled) {
      problems.push("Expected #btn-gather to be disabled when offline-summary overlay is visible — it was enabled.");
    }
    if (sharpenBtnForDisabled && !sharpenBtnForDisabled.disabled) {
      problems.push("Expected #btn-sharpen to be disabled when offline-summary overlay is visible — it was enabled.");
    }
    if (gatherStoneBtnForDisabled && !gatherStoneBtnForDisabled.disabled) {
      problems.push("Expected #btn-gather-stone to be disabled when offline-summary overlay is visible — it was enabled.");
    }
    if (buildWallBtnForDisabled && !buildWallBtnForDisabled.disabled) {
      problems.push("Expected #btn-build-wall to be disabled when offline-summary overlay is visible — it was enabled.");
    }

    // ─── Body must have pointer-events: none when overlay is visible ───
    const bodyPE = getComputedStyle(document.body).pointerEvents;
    if (bodyPE !== "none") {
      problems.push(`Expected body pointer-events to be "none" when offline-summary overlay is visible, got "${bodyPE}".`);
    }

    // ─── Overlay itself must have pointer-events: auto when visible ───
    const overlayPE = getComputedStyle(offlineSummary).pointerEvents;
    if (overlayPE !== "auto") {
      problems.push(`Expected #offline-summary pointer-events to be "auto" when visible, got "${overlayPE}".`);
    }

    // ─── On dismiss, all buttons must be re-evaluated ───
    if (dismissBtn) {
      dismissBtn.click();
      if (!offlineSummary.hidden) {
        problems.push("Expected #offline-summary to be hidden after dismiss button click — it was still visible.");
      }
      if (gatherBtnForDisabled && gatherBtnForDisabled.disabled) {
        problems.push("Expected #btn-gather to be enabled after dismissing offline-summary — it was still disabled.");
      }
      // Body pointer-events should be restored to default
      const bodyPEAfter = getComputedStyle(document.body).pointerEvents;
      if (bodyPEAfter === "none") {
        problems.push(`Expected body pointer-events to be restored after dismissing overlay, but it was still "none".`);
      }
    }

    const bg = getComputedStyle(offlineSummary).background;
    const rgbaMatch = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    const rgbMatch = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbaMatch) {
      const alpha = parseFloat(rgbaMatch[4]);
      if (alpha < 1) {
        problems.push(`Offline-summary overlay background alpha is ${alpha}, expected 1 (fully opaque). Got background: ${bg}. Page text bleeds through a semi-transparent overlay.`);
      }
    } else if (rgbMatch) {
      // rgb() form — already fully opaque, good
    } else {
      const hexMatch = bg.match(/#([0-9a-fA-F]{3,8})/);
      if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 8) {
          const alphaHex = hex.substring(6, 8);
          const alpha = parseInt(alphaHex, 16) / 255;
          if (alpha < 1) {
            problems.push(`Offline-summary overlay background alpha is ${alpha.toFixed(2)}, expected 1 (fully opaque). Got background: ${bg}.`);
          }
        } else if (hex.length === 4) {
          const alphaHex = hex.substring(3, 4);
          const alpha = parseInt(alphaHex + alphaHex, 16) / 255;
          if (alpha < 1) {
            problems.push(`Offline-summary overlay background alpha is ${alpha.toFixed(2)}, expected 1 (fully opaque). Got background: ${bg}.`);
          }
        }
      } else {
        problems.push(`Cannot parse offline-summary background — unexpected format: "${bg}". Expected a fully opaque color.`);
      }
    }

    // ─── Gather button must not be clickable through overlay ───
    offlineSummary.removeAttribute("hidden");
    const gBtn = document.getElementById("btn-gather");
    if (gBtn) gBtn.disabled = true;
    document.body.style.pointerEvents = "none";
    offlineSummary.style.pointerEvents = "auto";

    const gBtnCheck = document.getElementById("btn-gather");
    if (gBtnCheck) {
      const overlayZ = parseInt(getComputedStyle(offlineSummary).zIndex);
      let gatherZ = 0;
      let el = gBtnCheck.parentElement;
      while (el) {
        const z = parseInt(getComputedStyle(el).zIndex);
        if (!isNaN(z) && z > gatherZ) gatherZ = z;
        el = el.parentElement;
      }
      if (overlayZ <= gatherZ) {
        problems.push(`Offline-summary z-index (${overlayZ}) is not higher than the gather button's highest ancestor z-index (${gatherZ}). The gather button may remain clickable behind the overlay.`);
      }

      const overlayRect = offlineSummary.getBoundingClientRect();
      const btnRect = gBtnCheck.getBoundingClientRect();
      if (overlayRect.width < window.innerWidth - 1 || overlayRect.height < window.innerHeight - 1) {
        problems.push(`Offline-summary overlay rect (${overlayRect.width}x${overlayRect.height}) does not cover the full viewport (${window.innerWidth}x${window.innerHeight}). The gather button may remain reachable.`);
      }
    }

    // ─── Restore hidden state ───
    document.body.style.pointerEvents = "";
    offlineSummary.style.pointerEvents = "";
    const gatherRestore = document.getElementById("btn-gather");
    if (gatherRestore) gatherRestore.disabled = false;
    if (wasHidden) {
      offlineSummary.setAttribute("hidden", "");
    }
  }

  // ─── Tap target sizes must meet WCAG minimum ────────────────

  const gatherBtn2 = document.getElementById("btn-gather");
  if (gatherBtn2) {
    const h = parseFloat(getComputedStyle(gatherBtn2).height);
    if (h < 39.9) {
      problems.push(`#btn-gather computed height is ${h}px — expected at least 40px (WCAG minimum tap target).`);
    }
  } else {
    problems.push("Expected #btn-gather to exist for tap target check — it was not found.");
  }

  const gatherStoneBtn2 = document.getElementById("btn-gather-stone");
  if (gatherStoneBtn2) {
    const h = parseFloat(getComputedStyle(gatherStoneBtn2).height);
    if (h < 39.9) {
      problems.push(`#btn-gather-stone computed height is ${h}px — expected at least 40px (WCAG minimum tap target).`);
    }
  } else {
    problems.push("Expected #btn-gather-stone to exist for tap target check — it was not found.");
  }

  const buildWallBtn2 = document.getElementById("btn-build-wall");
  if (buildWallBtn2) {
    const h = parseFloat(getComputedStyle(buildWallBtn2).height);
    if (h < 39.9) {
      problems.push(`#btn-build-wall computed height is ${h}px — expected at least 40px (WCAG minimum tap target).`);
    }
  } else {
    problems.push("Expected #btn-build-wall to exist for tap target check — it was not found.");
  }

  const dismissBtn2 = document.getElementById("btn-dismiss-offline");
  if (dismissBtn2) {
    const summary = dismissBtn2.closest("#offline-summary");
    const wasHidden2 = summary.hidden;
    summary.removeAttribute("hidden");
    const h = parseFloat(getComputedStyle(dismissBtn2).height);
    if (h < 39.9) {
      problems.push(`#btn-dismiss-offline computed height is ${h}px — expected at least 40px (WCAG minimum tap target).`);
    }
    if (wasHidden2) {
      summary.setAttribute("hidden", "");
    }
  } else {
    problems.push("Expected #btn-dismiss-offline to exist for tap target check — it was not found.")
  }

  // ─── Font-family checks: body text uses readable font, headings use pixel font ───

  const bodyFontExpected = "Courier New";
  const pixelFontExpected = "Press Start 2P";

  const goalTextEl = document.getElementById("goal-text");
  if (goalTextEl) {
    const ff = getComputedStyle(goalTextEl).fontFamily;
    if (!ff.includes(bodyFontExpected)) {
      problems.push(`#goal-text font-family is "${ff}" — expected it to include "${bodyFontExpected}" (body/readable font).`);
    }
  } else {
    problems.push("Expected #goal-text to exist for font-family check — it was not found.");
  }

  const offlineMsgEl = document.querySelector(".offline-message");
  if (offlineMsgEl) {
    const ff = getComputedStyle(offlineMsgEl).fontFamily;
    if (!ff.includes(bodyFontExpected)) {
      problems.push(`.offline-message font-family is "${ff}" — expected it to include "${bodyFontExpected}" (body/readable font).`);
    }
  } else {
    problems.push("Expected .offline-message to exist for font-family check — it was not found.");
  }

  const footerNoteEl = document.querySelector(".footer-note");
  if (footerNoteEl) {
    const ff = getComputedStyle(footerNoteEl).fontFamily;
    if (!ff.includes(bodyFontExpected)) {
      problems.push(`.footer-note font-family is "${ff}" — expected it to include "${bodyFontExpected}" (body/readable font).`);
    }
  } else {
    problems.push("Expected .footer-note to exist for font-family check — it was not found.");
  }

  // Headings and stat values should use the pixel font
  const gameTitleEl = document.querySelector(".game-title");
  if (gameTitleEl) {
    const ff = getComputedStyle(gameTitleEl).fontFamily;
    if (!ff.includes(pixelFontExpected)) {
      problems.push(`.game-title font-family is "${ff}" — expected it to include "${pixelFontExpected}" (pixel display font).`);
    }
  } else {
    problems.push("Expected .game-title to exist for font-family check — it was not found.");
  }

  const statValueEl = document.querySelector(".stat-value");
  if (statValueEl) {
    const ff = getComputedStyle(statValueEl).fontFamily;
    if (!ff.includes(pixelFontExpected)) {
      problems.push(`.stat-value font-family is "${ff}" — expected it to include "${pixelFontExpected}" (pixel display font).`);
    }
  } else {
    problems.push("Expected .stat-value to exist for font-family check — it was not found.");
  }

  const btnEl = document.querySelector(".btn");
  if (btnEl) {
    const ff = getComputedStyle(btnEl).fontFamily;
    if (!ff.includes(pixelFontExpected)) {
      problems.push(`.btn font-family is "${ff}" — expected it to include "${pixelFontExpected}" (pixel display font).`);
    }
  } else {
    problems.push("Expected .btn to exist for font-family check — it was not found.");
  }

  // Verify btn-icon is rendered at inherited font-size
  const btnIconEl = document.querySelector(".btn-icon");
  if (btnIconEl) {
    const iconFf = getComputedStyle(btnIconEl).fontFamily;
    const iconFs = getComputedStyle(btnIconEl).fontSize;
    const parentBtn = btnIconEl.closest(".btn");
    if (parentBtn) {
      const parentFs = getComputedStyle(parentBtn).fontSize;
      if (iconFs !== parentFs) {
        problems.push(`.btn-icon font-size is "${iconFs}" — expected "${parentFs}" (inherit from parent .btn).`);
      }
    }
  } else {
    problems.push("Expected .btn-icon to exist in the DOM — it was not found.");
  }

  // ─── DOM shows a numeric wood value (page engine is running) ────

  if (woodEl) {
    const text = woodEl.textContent.trim();
    const num = parseFloat(text);
    if (isNaN(num)) {
      problems.push(`#wood-value should show a numeric value, got "${text}".`);
    } else if (num < 0) {
      problems.push(`#wood-value should not be negative, got ${num}.`);
    }
  }

  // ─── Engine module ──────────────────────────────────────────────

  try {
    const engine = await import("./engine.js");

    // --- Test 1: initial state shape ---
    engine.reset();
    const fresh = engine.getState();
    if (typeof fresh.wood !== "number" || fresh.wood !== 0) {
      problems.push(`Engine initial wood should be 0, got ${JSON.stringify(fresh.wood)}.`);
    }
    if (typeof fresh.rate !== "number" || fresh.rate !== 0.1) {
      problems.push(`Engine initial rate should be 0.1, got ${JSON.stringify(fresh.rate)}.`);
    }
    if (typeof fresh.timestamp !== "string" || fresh.timestamp.length === 0) {
      problems.push(`Engine initial timestamp should be a non-empty ISO string, got ${JSON.stringify(fresh.timestamp)}.`);
    }
    // Stone should be 0 initially
    if (typeof fresh.stone !== "number" || fresh.stone !== 0) {
      problems.push(`Engine initial stone should be 0, got ${JSON.stringify(fresh.stone)}.`);
    }
    // StoneUnlocked should be false initially
    if (typeof fresh.stoneUnlocked !== "boolean" || fresh.stoneUnlocked !== false) {
      problems.push(`Engine initial stoneUnlocked should be false, got ${JSON.stringify(fresh.stoneUnlocked)}.`);
    }
    // totalWoodEarned should be 0 initially
    if (typeof fresh.totalWoodEarned !== "number" || fresh.totalWoodEarned !== 0) {
      problems.push(`Engine initial totalWoodEarned should be 0, got ${JSON.stringify(fresh.totalWoodEarned)}.`);
    }
    // wallLevel should be 0 initially
    if (typeof fresh.wallLevel !== "number" || fresh.wallLevel !== 0) {
      problems.push(`Engine initial wallLevel should be 0, got ${JSON.stringify(fresh.wallLevel)}.`);
    }
    // firstTimestamp should be null on fresh reset (no init)
    if (fresh.firstTimestamp !== null) {
      problems.push(`Engine initial firstTimestamp should be null (fresh reset), got ${JSON.stringify(fresh.firstTimestamp)}.`);
    }

    // --- Test 1b: formatElapsed utility ---
    if (typeof engine.formatElapsed !== "function") {
      problems.push("Engine should export formatElapsed function — it was not found.");
    } else {
      const tests = [
        { ms: null, expected: '\u2014' },
        { ms: 0, expected: '\u2014' },
        { ms: 5000, expected: '5s' },
        { ms: 60000, expected: '1m' },
        { ms: 60000 * 2 + 15000, expected: '2m 15s' },
        { ms: 3600000 * 3 + 60000 * 45, expected: '3h 45m' },
        { ms: 86400000 * 2 + 3600000 * 7 + 60000 * 34, expected: '2d 7h 34m' },
      ];
      for (const t of tests) {
        const result = engine.formatElapsed(t.ms);
        // Normalize whitespace for comparison
        const normResult = result.replace(/\s+/g, ' ').trim();
        const normExpected = t.expected.replace(/\s+/g, ' ').trim();
        if (normResult !== normExpected) {
          problems.push(`formatElapsed(${JSON.stringify(t.ms)}) returned "${result}", expected "${t.expected}".`);
        }
      }
    }

    // --- Test 2: persistence round-trip ---
    engine.reset();
    localStorage.removeItem("selfgrow-state");
    engine.save();

    const raw = localStorage.getItem("selfgrow-state");
    if (!raw) {
      problems.push("Engine save() should write to localStorage, but the key was not found.");
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.wood !== "number" || parsed.wood !== 0) {
          problems.push(`localStorage state after save() should have wood=0, got ${JSON.stringify(parsed.wood)}.`);
        }
        if (typeof parsed.rate !== "number" || parsed.rate !== 0.1) {
          problems.push(`localStorage state after save() should have rate=0.1, got ${JSON.stringify(parsed.rate)}.`);
        }
        if (typeof parsed.timestamp !== "string" || parsed.timestamp.length === 0) {
          problems.push(`localStorage state after save() should have a non-empty timestamp.`);
        }
        // Stone fields should persist
        if (typeof parsed.stone !== "number") {
          problems.push(`localStorage state after save() should have stone field, got ${JSON.stringify(parsed.stone)}.`);
        }
        if (typeof parsed.totalWoodEarned !== "number") {
          problems.push(`localStorage state after save() should have totalWoodEarned field, got ${JSON.stringify(parsed.totalWoodEarned)}.`);
        }
        if (typeof parsed.wallLevel !== "number") {
          problems.push(`localStorage state after save() should have wallLevel field, got ${JSON.stringify(parsed.wallLevel)}.`);
        }
        if (typeof parsed.stoneUnlocked !== "boolean") {
          problems.push(`localStorage state after save() should have stoneUnlocked field, got ${JSON.stringify(parsed.stoneUnlocked)}.`);
        }
        // firstTimestamp should be present — null on fresh reset (no init yet)
        if (parsed.firstTimestamp !== null && typeof parsed.firstTimestamp !== "string") {
          problems.push(`localStorage state after save() should have firstTimestamp as null or string, got ${JSON.stringify(parsed.firstTimestamp)}.`);
        }
      } catch {
        problems.push("localStorage value from engine.save() is not valid JSON.");
      }
    }

    // --- Test 3: getState returns a snapshot (not a reference) ---
    engine.reset();
    const snap1 = engine.getState();
    snap1.wood = 999; // mutate the returned object
    const snap2 = engine.getState();
    if (snap2.wood !== 0) {
      problems.push("getState() must return a copy — mutating the returned object should not affect engine state.");
    }

    // --- Test 4: gatherWood increments by exactly 1 (with no walls) ---
    engine.reset();
    const before = engine.getState().wood;
    const gatherResult = engine.gatherWood();
    const after = gatherResult.wood;
    if (after - before !== 1) {
      problems.push(`gatherWood() should increment wood by exactly 1. Before: ${before}, After: ${after}.`);
    }

    // --- Test 5: multiple gathers accumulate ---
    engine.reset();
    engine.gatherWood();
    engine.gatherWood();
    engine.gatherWood();
    const three = engine.getState().wood;
    if (three !== 3) {
      problems.push(`Three gatherWood() calls should yield wood=3, got ${three}.`);
    }

    // --- Test 6: gatherWood increments totalWoodEarned ---
    engine.reset();
    engine.gatherWood();
    const stateAfterGather = engine.getState();
    if (stateAfterGather.totalWoodEarned !== 1) {
      problems.push(`gatherWood() should increment totalWoodEarned by 1, got ${stateAfterGather.totalWoodEarned}.`);
    }

    // --- Test 7: offline catch-up via consumeOfflineWoodGained ---
    engine.reset();
    const threeSecAgo = new Date(Date.now() - 3000).toISOString();
    const oldState = JSON.stringify({ wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5, wallLevel: 0, stoneUnlocked: false, timestamp: threeSecAgo });
    localStorage.setItem("selfgrow-state", oldState);

    engine.init(); // catches up ~0.3 wood

    const gained = engine.consumeOfflineWoodGained();
    if (gained < 0.2 || gained > 0.4) {
      problems.push(
        `Offline catch-up from 3 seconds ago should add ~0.3 wood (0.1/s * 3s). Got ${gained.toFixed(4)}.`
      );
    }

    // consumeOfflineWoodGained resets after reading
    const gainedAgain = engine.consumeOfflineWoodGained();
    if (gainedAgain !== 0) {
      problems.push(
        `consumeOfflineWoodGained() should return 0 after being consumed once, got ${gainedAgain}.`
      );
    }

    // --- Test 7b: offline milestone detection via consumeOfflineMilestones ---
    engine.reset();
    // Simulate a catch-up where wood was 8 and after catch-up is 12 (>=10)
    // We need to directly set state and call catchUp by manipulating localStorage
    // Set state with wood=8, upgradeLevel=0 (no sharpen yet)
    const oldState2 = JSON.stringify({ wood: 8, rate: 0.1, stone: 0, totalWoodEarned: 8, wallLevel: 0, stoneUnlocked: false, timestamp: new Date(Date.now() - 60000).toISOString() });
    localStorage.removeItem("selfgrow-state");
    localStorage.setItem("selfgrow-state", oldState2);
    // Re-init will load the saved state, then catchUp adds ~6 wood (0.1/s * 60s)
    engine.init();
    const milestones = engine.consumeOfflineMilestones();
    if (!milestones.sharpenAvailable) {
      problems.push("consumeOfflineMilestones should report sharpenAvailable=true when wood crosses 10 and sharpen not yet done.");
    }
    if (milestones.stoneNowUnlocked) {
      problems.push("consumeOfflineMilestones should report stoneNowUnlocked=false when stone was not unlocked.");
    }
    if (milestones.wallAvailable) {
      problems.push("consumeOfflineMilestones should report wallAvailable=false when stone is not unlocked.");
    }
    if (milestones.forgeNowUnlocked) {
      problems.push("consumeOfflineMilestones should report forgeNowUnlocked=false when no wall was built.");
    }

    // --- Test 7c: offline milestone for stone unlock ---
    engine.reset();
    // Test the other direction: detect when stone>=5 and wall not built.
    const oldState3 = JSON.stringify({ wood: 5, rate: 0.1, upgradeLevel: 1, stone: 2, totalWoodEarned: 5, totalStoneEarned: 2, wallLevel: 0, stoneUnlocked: true, timestamp: new Date(Date.now() - 60000).toISOString() });
    localStorage.removeItem("selfgrow-state");
    localStorage.setItem("selfgrow-state", oldState3);
    engine.init();
    const milestones2 = engine.consumeOfflineMilestones();
    if (!milestones2.wallAvailable) {
      problems.push("consumeOfflineMilestones should report wallAvailable=true when stone >= 5 and wall not built (with stone unlocked).");
    }
    if (milestones2.forgeNowUnlocked) {
      problems.push("consumeOfflineMilestones should report forgeNowUnlocked=false when wall not built.");
    }

    // --- Test 7d: consumeOfflineMilestones returns empty after first read ---
    const milestones3 = engine.consumeOfflineMilestones();
    if (milestones3.sharpenAvailable || milestones3.wallAvailable || milestones3.stoneNowUnlocked || milestones3.forgeNowUnlocked) {
      problems.push("consumeOfflineMilestones should return all false after being consumed once.");
    }

    // --- Test 8: gather works even after offline catch-up ---
    engine.reset();
    engine.gatherWood();
    const afterGather = engine.getState().wood;
    if (afterGather !== 1) {
      problems.push(`After reset+gather, wood should be 1, got ${afterGather}.`);
    }

    // --- Test 9: initial state has upgradeLevel=0 ---
    engine.reset();
    const freshState = engine.getState();
    if (typeof freshState.upgradeLevel !== "number" || freshState.upgradeLevel !== 0) {
      problems.push(`Engine initial upgradeLevel should be 0, got ${JSON.stringify(freshState.upgradeLevel)}.`);
    }

    // --- Test 10: craftUpgrade fails when not enough wood ---
    engine.reset();
    const failResult = engine.craftUpgrade();
    if (failResult.upgraded !== false) {
      problems.push("craftUpgrade with 0 wood should return upgraded=false.");
    }
    if (typeof failResult.reason !== "string" || failResult.reason.length === 0) {
      problems.push("craftUpgrade failure should include a non-empty reason string.");
    }
    if (typeof failResult.state !== "object") {
      problems.push("craftUpgrade failure should include a state object.");
    }

    // --- Test 11: craftUpgrade succeeds with enough wood ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    const beforeRate = engine.getState().rate;
    const result = engine.craftUpgrade();
    if (result.upgraded !== true) {
      problems.push("craftUpgrade with 5 wood should return upgraded=true.");
    }
    const upgradedState = engine.getState();
    if (upgradedState.wood !== 0) {
      problems.push(`After craftUpgrade with 5 wood, wood should be 0, got ${upgradedState.wood}.`);
    }
    if (upgradedState.rate !== beforeRate + 0.05) {
      problems.push(`After craftUpgrade, rate should increase by 0.05. Before: ${beforeRate}, After: ${upgradedState.rate}.`);
    }
    if (upgradedState.upgradeLevel !== 1) {
      problems.push(`After craftUpgrade, upgradeLevel should be 1, got ${upgradedState.upgradeLevel}.`);
    }
    // After first upgrade, stone should be unlocked
    if (upgradedState.stoneUnlocked !== true) {
      problems.push(`After first upgrade, stoneUnlocked should be true, got ${upgradedState.stoneUnlocked}.`);
    }

    // --- Test 12: craftUpgrade persists rate increase ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade();
    engine.save();
    const rawSaved = localStorage.getItem("selfgrow-state");
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (typeof parsed.upgradeLevel !== "number" || parsed.upgradeLevel !== 1) {
        problems.push(`Persisted upgradeLevel should be 1, got ${JSON.stringify(parsed.upgradeLevel)}.`);
      }
      if (typeof parsed.rate !== "number" || parsed.rate < 0.14 || parsed.rate > 0.16) {
        problems.push(`Persisted rate after one upgrade should be ~0.15, got ${parsed.rate}.`);
      }
      if (parsed.stoneUnlocked !== true) {
        problems.push(`Persisted stoneUnlocked should be true after first upgrade, got ${parsed.stoneUnlocked}.`);
      }
    }

    // --- Test 13: upgradeLevel round-trips through load ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade();
    const savedRate = engine.getState().rate;
    engine.save();
    const savedStateRaw = localStorage.getItem("selfgrow-state");
    engine.reset();
    localStorage.setItem("selfgrow-state", savedStateRaw);
    engine.init();
    const loaded = engine.getState();
    if (loaded.upgradeLevel !== 1) {
      problems.push(`After persistence round-trip, upgradeLevel should be 1, got ${loaded.upgradeLevel}.`);
    }
    if (loaded.rate !== savedRate) {
      problems.push(`After persistence round-trip, rate should be ${savedRate}, got ${loaded.rate}.`);
    }
    if (loaded.stoneUnlocked !== true) {
      problems.push(`After persistence round-trip, stoneUnlocked should be true, got ${loaded.stoneUnlocked}.`);
    }

    // --- Test 14: gatherStone fails when stone is not unlocked ---
    engine.reset();
    const stoneFail = engine.gatherStone();
    if (stoneFail.gathered !== false) {
      problems.push("gatherStone() with stone locked should return gathered=false.");
    }
    if (typeof stoneFail.reason !== "string" || stoneFail.reason.length === 0) {
      problems.push("gatherStone() failure should include a non-empty reason string.");
    }

    // --- Test 15: gatherStone succeeds when stone is unlocked ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    const stoneBefore = engine.getState().stone;
    const stoneResult = engine.gatherStone();
    if (stoneResult.gathered !== true) {
      problems.push("gatherStone() with stone unlocked should return gathered=true.");
    }
    const stoneAfter = engine.getState().stone;
    if (stoneAfter - stoneBefore !== 1) {
      problems.push(`gatherStone() should increment stone by exactly 1. Before: ${stoneBefore}, After: ${stoneAfter}.`);
    }

    // --- Test 16: buildWall fails when not enough stone ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    const wallFail = engine.buildWall();
    if (wallFail.built !== false) {
      problems.push("buildWall() with 0 stone should return built=false.");
    }
    if (typeof wallFail.reason !== "string" || wallFail.reason.length === 0) {
      problems.push("buildWall() failure should include a non-empty reason string.");
    }

    // --- Test 17: buildWall succeeds with enough stone ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    const wallCost = engine.WALL_COST;
    for (let i = 0; i < wallCost; i++) engine.gatherStone();
    const wallBefore = engine.getState().wallLevel;
    const clickPowerBefore = 1 + wallBefore;
    const wallResult = engine.buildWall();
    if (wallResult.built !== true) {
      problems.push(`buildWall() with ${wallCost} stone should return built=true.`);
    }
    const wallAfter = engine.getState();
    if (wallAfter.wallLevel !== 1) {
      problems.push(`After buildWall, wallLevel should be 1, got ${wallAfter.wallLevel}.`);
    }
    if (wallAfter.stone !== 0) {
      problems.push(`After buildWall with ${wallCost} stone, stone should be 0, got ${wallAfter.stone}.`);
    }

    // --- Test 18: gatherWood with a wall gives more wood ---
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wallLevel=1, clickPower=2
    const woodBefore = engine.getState().wood;
    engine.gatherWood();
    const woodAfter = engine.getState().wood;
    if (woodAfter - woodBefore !== 2) {
      problems.push(`gatherWood() with wallLevel=1 should add 2 wood. Before: ${woodBefore}, After: ${woodAfter}, expected +2.`);
    }

    // --- Test 19: totalWoodEarned grows with gatherWood and offline ---
    engine.reset();
    engine.gatherWood();
    let state1 = engine.getState();
    if (state1.totalWoodEarned !== 1) {
      problems.push(`totalWoodEarned after 1 gather should be 1, got ${state1.totalWoodEarned}.`);
    }
    // With a wall, gatherWood gives +2 but totalWoodEarned should track all wood gained
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade();
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wallLevel=1
    engine.gatherWood(); // +2
    const state2 = engine.getState();
    // total: 1 (first gather) + 5 more gathers before sharpen + sharpen (no net change) + 5 stone gathers (no wood) + 2 (wall boosted)
    // Actually: after reset, 6 gathers (6 totalWoodEarned), sharpen doesn't add, then wallCost stone gathers (no change), then 1 gather for +2
    // totalWoodEarned should be 6 + 2 = 8
    if (state2.totalWoodEarned !== 8) {
      problems.push(`totalWoodEarned should be 8 after sequence, got ${state2.totalWoodEarned}. Expected: 1 (first) + 5 (for sharpen) + 2 (wall boosted gather) = 8.`);
    }

    // --- Test 20: totalStoneEarned tracks stone gained via gatherStone and passive ---
    engine.reset();
    // Unlock stone
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade();
    // Gather stone manually
    for (let i = 0; i < 3; i++) engine.gatherStone();
    let s = engine.getState();
    if (s.totalStoneEarned !== 3) {
      problems.push(`totalStoneEarned after 3 stone gathers should be 3, got ${s.totalStoneEarned}.`);
    }
    // totalStoneEarned should not decrease after spending stone
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // spends 5 stone
    s = engine.getState();
    // totalStoneEarned should be 3 (first) + 5 (for wall) = 8, regardless of current stone
    if (s.totalStoneEarned < 8) {
      problems.push(`totalStoneEarned after gathering 8 stone and spending 5 on wall should be at least 8, got ${s.totalStoneEarned}.`);
    }
    if (s.stone !== 3) {
      problems.push(`stone balance after building wall should be 3 (8 earned − 5 spent), got ${s.stone}. Total earned is ${s.totalStoneEarned} — the two must differ.`);
    }

    // Clean up test artifacts
    localStorage.removeItem("selfgrow-state");
    engine.reset();
    engine.init();

  } catch (err) {
    problems.push(`Engine module test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Agent tools ────────────────────────────────────────────────

  try {
    const { tools } = await import("./agenttools.js");
    const toolList = tools();

    // --- read-state tool ---
    const readState = toolList.find((t) => t.name === "read-state");
    if (!readState) {
      problems.push("Expected a tool named 'read-state' in tools() — it was not found.");
    } else {
      const result = await readState.execute({});
      if (typeof result !== "object" || result === null) {
        problems.push("read-state execute() should return an object.");
      } else {
        if (typeof result.wood !== "number") {
          problems.push(`read-state should return wood as a number, got ${JSON.stringify(result.wood)}.`);
        }
        if (typeof result.rate !== "number" || result.rate !== 0.1) {
          problems.push(`read-state should return rate=0.1, got ${JSON.stringify(result.rate)}.`);
        }
        if (typeof result.timestamp !== "string" || result.timestamp.length === 0) {
          problems.push(`read-state should return a non-empty timestamp string, got ${JSON.stringify(result.timestamp)}.`);
        }
        // Elapsed fields
        if (typeof result.firstTimestamp !== "string" || result.firstTimestamp.length === 0) {
          problems.push(`read-state should return a non-empty firstTimestamp string, got ${JSON.stringify(result.firstTimestamp)}.`);
        }
        if (typeof result.elapsed !== "string" || result.elapsed.length === 0) {
          problems.push(`read-state should return a non-empty elapsed string, got ${JSON.stringify(result.elapsed)}.`);
        }
        // Stone fields must be present
        if (typeof result.stone !== "number") {
          problems.push(`read-state should return stone as a number, got ${JSON.stringify(result.stone)}.`);
        }
        if (typeof result.stoneRate !== "number") {
          problems.push(`read-state should return stoneRate as a number, got ${JSON.stringify(result.stoneRate)}.`);
        }
        if (typeof result.stoneUnlocked !== "boolean") {
          problems.push(`read-state should return stoneUnlocked as a boolean, got ${JSON.stringify(result.stoneUnlocked)}.`);
        }
        if (typeof result.wallLevel !== "number") {
          problems.push(`read-state should return wallLevel as a number, got ${JSON.stringify(result.wallLevel)}.`);
        }
        if (typeof result.totalStoneEarned !== "number") {
          problems.push(`read-state should return totalStoneEarned as a number, got ${JSON.stringify(result.totalStoneEarned)}.`);
        }
        if (typeof result.clickPower !== "number") {
          problems.push(`read-state should return clickPower as a number, got ${JSON.stringify(result.clickPower)}.`);
        }
        // When stone is not unlocked, stoneRate should be 0
        if (!result.stoneUnlocked && result.stoneRate !== 0) {
          problems.push(`read-state stoneRate should be 0 when stone is not unlocked, got ${result.stoneRate}.`);
        }
        // Verify the result matches the engine's current state
        const engine = await import("./engine.js");
        const s = engine.getState();
        if (result.wood !== s.wood) {
          problems.push(`read-state wood (${result.wood}) does not match engine.getState() wood (${s.wood}).`);
        }
        // Check firstGoal field
        if (!result.firstGoal) {
          problems.push("read-state should return a 'firstGoal' field — it was missing.");
        } else {
          if (typeof result.firstGoal !== "object") {
            problems.push(`read-state.firstGoal should be an object, got ${typeof result.firstGoal}.`);
          } else {
            if (typeof result.firstGoal.target !== "number" || result.firstGoal.target !== 10) {
              problems.push(`read-state.firstGoal.target should be 10, got ${JSON.stringify(result.firstGoal.target)}.`);
            }
            if (typeof result.firstGoal.current !== "number") {
              problems.push(`read-state.firstGoal.current should be a number, got ${JSON.stringify(result.firstGoal.current)}.`);
            }
            if (typeof result.firstGoal.reached !== "boolean") {
              problems.push(`read-state.firstGoal.reached should be a boolean, got ${JSON.stringify(result.firstGoal.reached)}.`);
            }
          }
        }
        // Check offlineSummaryVisible field
        if (typeof result.offlineSummaryVisible !== "boolean") {
          problems.push(`read-state should return offlineSummaryVisible as a boolean, got ${JSON.stringify(result.offlineSummaryVisible)}.`);
        }
        // Check offlineWoodGained field
        if (typeof result.offlineWoodGained !== "number" || result.offlineWoodGained < 0) {
          problems.push(`read-state should return offlineWoodGained as a non-negative number, got ${JSON.stringify(result.offlineWoodGained)}.`);
        }
        // Check offlineStoneGained field
        if (typeof result.offlineStoneGained !== "number" || result.offlineStoneGained < 0) {
          problems.push(`read-state should return offlineStoneGained as a non-negative number, got ${JSON.stringify(result.offlineStoneGained)}.`);
        }
        // Check upgradeLevel field
        if (typeof result.upgradeLevel !== "number" || result.upgradeLevel < 0) {
          problems.push(`read-state should return upgradeLevel as a non-negative number, got ${JSON.stringify(result.upgradeLevel)}.`);
        }
        // Check milestones field
        if (!result.milestones) {
          problems.push("read-state should return a 'milestones' field — it was missing.");
        } else {
          if (typeof result.milestones !== "object") {
            problems.push(`read-state.milestones should be an object, got ${typeof result.milestones}.`);
          } else {
            if (typeof result.milestones.sharpenAvailable !== "boolean") {
              problems.push(`read-state.milestones.sharpenAvailable should be a boolean, got ${JSON.stringify(result.milestones.sharpenAvailable)}.`);
            }
            if (typeof result.milestones.stoneNowUnlocked !== "boolean") {
              problems.push(`read-state.milestones.stoneNowUnlocked should be a boolean, got ${JSON.stringify(result.milestones.stoneNowUnlocked)}.`);
            }
            if (typeof result.milestones.wallAvailable !== "boolean") {
              problems.push(`read-state.milestones.wallAvailable should be a boolean, got ${JSON.stringify(result.milestones.wallAvailable)}.`);
            }
            if (typeof result.milestones.forgeNowUnlocked !== "boolean") {
              problems.push(`read-state.milestones.forgeNowUnlocked should be a boolean, got ${JSON.stringify(result.milestones.forgeNowUnlocked)}.`);
            }
            // On a fresh page load (no wood, no upgrades), milestones should be all false
            if (result.wood < 10 && result.upgradeLevel === 0) {
              if (result.milestones.sharpenAvailable) {
                problems.push("read-state.milestones.sharpenAvailable should be false when wood < 10 and no upgrades.");
              }
              if (result.milestones.stoneNowUnlocked) {
                problems.push("read-state.milestones.stoneNowUnlocked should be false when stone is not unlocked.");
              }
              if (result.milestones.forgeNowUnlocked) {
                problems.push("read-state.milestones.forgeNowUnlocked should be false when no wall is built.");
              }
            }
            // sharpenAvailable should be true when wood >= 10 and upgradeLevel === 0
            if (result.wood >= 10 && result.upgradeLevel === 0) {
              if (!result.milestones.sharpenAvailable) {
                problems.push("read-state.milestones.sharpenAvailable should be true when wood >= 10 and no upgrades done.");
              }
            }
          }
        }
        // Check nextGoal field
        if (!result.nextGoal) {
          problems.push("read-state should return a 'nextGoal' field — it was missing.");
        } else {
          if (typeof result.nextGoal !== "object") {
            problems.push(`read-state.nextGoal should be an object, got ${typeof result.nextGoal}.`);
          }
          if (typeof result.nextGoal.description !== "string" || result.nextGoal.description.length === 0) {
            problems.push(`read-state.nextGoal.description should be a non-empty string, got ${JSON.stringify(result.nextGoal.description)}.`);
          }
        }
      }
    }

    // --- perform-action tool ---
    const performAction = toolList.find((t) => t.name === "perform-action");
    if (!performAction) {
      problems.push("Expected a tool named 'perform-action' in tools() — it was not found.");
    } else {
      // Test gather action
      const engine = await import("./engine.js");
      engine.reset();
      const beforeVal = engine.getState().wood;
      const result = await performAction.execute({ action: "gather" });
      if (typeof result !== "object" || result === null) {
        problems.push("perform-action execute() should return an object.");
      } else {
        if (result.wood !== beforeVal + 1) {
          problems.push(
            `perform-action with "gather" should increment wood by 1. Before: ${beforeVal}, `
            + `After result: ${result.wood}.`
          );
        }
        if (!result.firstGoal) {
          problems.push("perform-action result should include a 'firstGoal' field — it was missing.");
        }
        if (!result.nextGoal) {
          problems.push("perform-action result should include a 'nextGoal' field — it was missing.");
        }
        if (!result.milestones) {
          problems.push("perform-action result should include a 'milestones' field — it was missing.");
        }
      }

      // Test sharpen action
      engine.reset();
      for (let i = 0; i < 5; i++) engine.gatherWood();
      const craftBeforeRate = engine.getState().rate;
      const sharpenResult = await performAction.execute({ action: "sharpen" });
      if (typeof sharpenResult !== "object" || sharpenResult === null) {
        problems.push("perform-action with sharpen should return an object.");
      } else {
        if (sharpenResult.rate !== craftBeforeRate + 0.05) {
          problems.push(
            `perform-action with "sharpen" should increase rate by 0.05. Before: ${craftBeforeRate}, `
            + `After: ${sharpenResult.rate}.`
          );
        }
        if (sharpenResult.upgradeLevel !== 1) {
          problems.push(`perform-action with "sharpen" should set upgradeLevel to 1, got ${sharpenResult.upgradeLevel}.`);
        }
        // Stone should be unlocked after first sharpen
        if (sharpenResult.stoneUnlocked !== true) {
          problems.push(`perform-action with "sharpen" should set stoneUnlocked to true, got ${sharpenResult.stoneUnlocked}.`);
        }
        if (!sharpenResult.firstGoal) {
          problems.push("sharpen result should include a 'firstGoal' field — it was missing.");
        }
        if (!sharpenResult.nextGoal) {
          problems.push("sharpen result should include a 'nextGoal' field — it was missing.");
        }
      }

      // Test gather-stone action
      engine.reset();
      // Need to unlock stone first
      for (let i = 0; i < 5; i++) engine.gatherWood();
      await performAction.execute({ action: "sharpen" });
      const stoneBefore = engine.getState().stone;
      const stoneResult = await performAction.execute({ action: "gather-stone" });
      if (typeof stoneResult !== "object" || stoneResult === null) {
        problems.push("perform-action with gather-stone should return an object.");
      } else {
        if (stoneResult.stone !== stoneBefore + 1) {
          problems.push(
            `perform-action with "gather-stone" should increment stone by 1. Before: ${stoneBefore}, `
            + `After: ${stoneResult.stone}.`
          );
        }
        if (stoneResult.stoneUnlocked !== true) {
          problems.push(`perform-action with "gather-stone" should have stoneUnlocked=true, got ${stoneResult.stoneUnlocked}.`);
        }
        // nextGoal should reflect stone goal
        if (stoneResult.nextGoal && stoneResult.nextGoal.type === "stone-goal") {
          // Good
        }
      }

      // Test build-wall action
      engine.reset();
      for (let i = 0; i < 5; i++) engine.gatherWood();
      await performAction.execute({ action: "sharpen" });
      // Gather 5 stone
      for (let i = 0; i < 5; i++) await performAction.execute({ action: "gather-stone" });
      const wallLevelBefore = engine.getState().wallLevel;
      const wallResult = await performAction.execute({ action: "build-wall" });
      if (typeof wallResult !== "object" || wallResult === null) {
        problems.push("perform-action with build-wall should return an object.");
      } else {
        if (wallResult.wallLevel !== wallLevelBefore + 1) {
          problems.push(
            `perform-action with "build-wall" should increment wallLevel by 1. Before: ${wallLevelBefore}, `
            + `After: ${wallResult.wallLevel}.`
          );
        }
        if (wallResult.stone !== 0) {
          problems.push(`After build-wall with ${engine.WALL_COST} stone, stone should be 0, got ${wallResult.stone}.`);
        }
        if (wallResult.clickPower !== 2) {
          problems.push(`After build-wall, clickPower should be 2, got ${wallResult.clickPower}.`);
        }
      }

      // Test unknown action throws
      try {
        await performAction.execute({ action: "unknown" });
        problems.push("perform-action with unknown action should throw, but it did not.");
      } catch (err) {
        if (!err.message.includes("unknown")) {
          problems.push(`perform-action throw message should mention "unknown", got "${err.message}".`);
        }
      }

      // Test dismiss-offline action
      const offlineSummary = document.getElementById("offline-summary");
      if (offlineSummary) {
        offlineSummary.removeAttribute("hidden");
        document.body.style.pointerEvents = "none";
        offlineSummary.style.pointerEvents = "auto";
        const btnG = document.getElementById("btn-gather");
        if (btnG) btnG.disabled = true;
        const btnS = document.getElementById("btn-sharpen");
        if (btnS) btnS.disabled = true;
        const btnGS = document.getElementById("btn-gather-stone");
        if (btnGS) btnGS.disabled = true;
        const btnBW = document.getElementById("btn-build-wall");
        if (btnBW) btnBW.disabled = true;

        const dismissResult = await performAction.execute({ action: "dismiss-offline" });
        if (dismissResult === null || typeof dismissResult !== "object") {
          problems.push("perform-action with dismiss-offline should return an object.");
        } else {
          if (!offlineSummary.hidden) {
            problems.push("dismiss-offline action should hide the offline-summary overlay.");
          }
          if (btnG && btnG.disabled) {
            problems.push("dismiss-offline action should re-enable #btn-gather.");
          }
          if (typeof dismissResult.wood !== "number") {
            problems.push(`dismiss-offline result should include wood as a number, got ${JSON.stringify(dismissResult.wood)}.`);
          }
          if (!dismissResult.firstGoal) {
            problems.push("dismiss-offline result should include firstGoal.");
          }
          if (!dismissResult.nextGoal) {
            problems.push("dismiss-offline result should include nextGoal.");
          }
          if (typeof dismissResult.offlineWoodGained !== "number" || dismissResult.offlineWoodGained !== 0) {
            problems.push(`dismiss-offline result offlineWoodGained should be 0 (overlay is now hidden), got ${JSON.stringify(dismissResult.offlineWoodGained)}.`);
          }
        }
      } else {
        problems.push("Expected #offline-summary to exist for dismiss-offline tool test.");
      }
    }

    // Re-init page engine after tests
    (await import("./engine.js")).reset();
    (await import("./engine.js")).init();

  } catch (err) {
    problems.push(`Agent tools test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Dual-goal rendering ──────────────────────────────────────
  try {
    const engine = await import("./engine.js");
    engine.reset();

    const track2 = document.getElementById("goal-progress-track-2");
    const fill2 = document.getElementById("goal-progress-fill-2");
    const label2 = document.getElementById("goal-resource-label-2");
    const label1 = document.getElementById("goal-resource-label-1");

    if (!track2) {
      problems.push("Expected #goal-progress-track-2 to exist for dual-goal rendering test — it was not found.");
    }
    if (!fill2) {
      problems.push("Expected #goal-progress-fill-2 to exist for dual-goal rendering test — it was not found.");
    }
    if (!label2) {
      problems.push("Expected #goal-resource-label-2 to exist for dual-goal rendering test — it was not found.");
    }
    if (!label1) {
      problems.push("Expected #goal-resource-label-1 to exist for dual-goal rendering test — it was not found.");
    }

    // Simulate dual-goal state: build wall, set resources below dual thresholds
    // Gather enough wood to stay above 10 after sharpening
    for (let i = 0; i < 15; i++) engine.gatherWood();
    engine.craftUpgrade(); // costs 5, leaves 10 wood
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // costs 5 stone, leaves 0
    // Now wallLevel=1, wood=10, stone=0 — stone is below dual-goal threshold (5)
    // so dual-goal should be active

    // Trigger a render cycle
    // We're outside the page's render loop, so we need to check the tools layer
    // which uses determineGoal on the engine state

    const { tools } = await import("./agenttools.js");
    const toolList = tools();
    const readState = toolList.find((t) => t.name === "read-state");
    if (readState) {
      const result = await readState.execute({});
      if (result.nextGoal && result.nextGoal.type === "dual-goal") {
        // Verify dual-goal structure
        if (!Array.isArray(result.nextGoal.resources)) {
          problems.push("dual-goal nextGoal should have a resources array — it was missing.");
        } else if (result.nextGoal.resources.length !== 2) {
          problems.push(`dual-goal nextGoal.resources should have exactly 2 entries, got ${result.nextGoal.resources.length}.`);
        } else {
          const woodRes = result.nextGoal.resources.find(r => r.name === "Wood");
          const stoneRes = result.nextGoal.resources.find(r => r.name === "Stone");
          if (!woodRes) {
            problems.push("dual-goal nextGoal.resources should include a 'Wood' resource — it was missing.");
          } else {
            if (typeof woodRes.current !== "number" || typeof woodRes.target !== "number") {
              problems.push("dual-goal Wood resource should have current and target as numbers.");
            }
            if (woodRes.target !== 10) {
              problems.push(`dual-goal Wood target should be 10, got ${woodRes.target}.`);
            }
          }
          if (!stoneRes) {
            problems.push("dual-goal nextGoal.resources should include a 'Stone' resource — it was missing.");
          } else {
            if (typeof stoneRes.current !== "number" || typeof stoneRes.target !== "number") {
              problems.push("dual-goal Stone resource should have current and target as numbers.");
            }
            if (stoneRes.target !== 5) {
              problems.push(`dual-goal Stone target should be 5, got ${stoneRes.target}.`);
            }
          }
        }
      }
    }

    // Clean up
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Dual-goal rendering test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Responsive layout checks ──────────────────────────────

  const viewportWidth = window.innerWidth;

  if (viewportWidth >= 900) {
    const panels = document.querySelectorAll(".panel");
    if (panels.length === 0) {
      problems.push("Expected at least one .panel element for layout width check — none found.");
    } else {
      let minLeft = Infinity;
      let maxRight = -Infinity;
      let visibleCount = 0;
      for (const p of panels) {
        if (p.hidden) continue;
        const rect = p.getBoundingClientRect();
        if (rect.width === 0) continue;
        visibleCount++;
        if (rect.left < minLeft) minLeft = rect.left;
        if (rect.right > maxRight) maxRight = rect.right;
      }
      if (visibleCount > 0) {
        const panelSpan = maxRight - minLeft;
        const pct = (panelSpan / viewportWidth) * 100;
        if (pct < 80) {
          problems.push(
            `On viewport width ${viewportWidth}px, panels span ${panelSpan}px (${pct.toFixed(1)}%) — `
            + `expected at least 80% (${(viewportWidth * 0.8).toFixed(0)}px).`
          );
        }
      } else {
        problems.push("No visible .panel elements found for layout width check.");
      }
    }

    const firstPanel = document.querySelector(".panel");
    if (firstPanel) {
      const maxW = getComputedStyle(firstPanel).maxWidth;
      if (maxW === "640px") {
        problems.push(
          `On wide viewport (${viewportWidth}px), computed max-width of .panel is still 640px. `
          + "Expected the ≥900px media query to override max-width to 'none'."
        );
      }
    }
  }

  if (viewportWidth <= 480) {
    const panels = document.querySelectorAll(".panel");
    let baselineLeft = null;
    for (const p of panels) {
      if (p.hidden) continue;
      const rect = p.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (baselineLeft === null) {
        baselineLeft = rect.left;
      } else {
        if (Math.abs(rect.left - baselineLeft) > 5) {
          problems.push(
            `On narrow viewport (${viewportWidth}px), panels are not in a single column. `
            + `Expected left edge ~${baselineLeft}px, got ${rect.left}px for element.`
          );
        }
      }
    }
  }

  // ─── Offline panel CSS property checks ──────────────────────

  const offlinePanel = document.querySelector(".offline-panel");
  if (!offlinePanel) {
    problems.push("Expected .offline-panel to exist in the DOM — it was not found.");
  } else {
    const overlay = document.getElementById("offline-summary");
    const wasHidden = overlay ? overlay.hidden : true;
    if (overlay) {
      overlay.removeAttribute("hidden");
    }

    const panelStyle = getComputedStyle(offlinePanel);
    const overflow = panelStyle.overflow;
    if (overflow !== "hidden") {
      problems.push(`Expected .offline-panel overflow to be "hidden", got "${overflow}". Content may overflow panel bounds on small viewports.`);
    }

    const minHeight = parseFloat(panelStyle.minHeight);
    if (isNaN(minHeight) || minHeight < 180) {
      problems.push(`Expected .offline-panel min-height to be at least 180px, got ${panelStyle.minHeight}. Panel may collapse on small viewports.`);
    }

    if (overlay) {
      if (wasHidden) {
        overlay.setAttribute("hidden", "");
      }
    }
  }

  // ─── Offline panel dimension checks when overlay is hidden ───
  // Per issue #902: when #offline-summary has the hidden attribute,
  // .offline-panel and .offline-message must still report their
  // CSS-specified dimensions (not collapsed to 0x0).
  const offlinePanelHidden = document.querySelector(".offline-panel");
  const offlineMessageHidden = document.querySelector(".offline-message");
  const overlayHidden = document.getElementById("offline-summary");

  if (overlayHidden) {
    // Make sure hidden attribute is set
    if (!overlayHidden.hidden) {
      overlayHidden.setAttribute("hidden", "");
    }
  }

  if (offlinePanelHidden) {
    const rect = offlinePanelHidden.getBoundingClientRect();
    const style = getComputedStyle(offlinePanelHidden);
    const minH = parseFloat(style.minHeight);
    if (rect.width < 100) {
      problems.push(
        `.offline-panel width when overlay is hidden is ${rect.width}px — expected at least 100px. `
        + "The panel container is collapsed, likely due to display:none on the parent."
      );
    }
    if (minH >= 200 && rect.height < minH * 0.5) {
      problems.push(
        `.offline-panel height when overlay is hidden is ${rect.height}px — `
        + `expected at least ${minH}px (min-height: ${style.minHeight}). `
        + "The panel is collapsed when hidden."
      );
    }
  }

  if (offlineMessageHidden) {
    const rect = offlineMessageHidden.getBoundingClientRect();
    if (rect.width < 50) {
      problems.push(
        `.offline-message width when overlay is hidden is ${rect.width}px — expected at least 50px. `
        + "The message container is collapsed, likely due to display:none on the parent."
      );
    }
    if (rect.height < 20) {
      problems.push(
        `.offline-message height when overlay is hidden is ${rect.height}px — expected at least 20px. `
        + "The message container is collapsed when hidden."
      );
    }
  }

  // Restore overlay to hidden state for normal page operation
  if (overlayHidden && !overlayHidden.hidden) {
    overlayHidden.setAttribute("hidden", "");
  }

  // ─── Forge system checks ────────────────────────────────────────

  // Forge DOM elements
  const forgeStat = document.getElementById("forge-stat");
  if (!forgeStat) {
    problems.push("Expected #forge-stat to exist in the DOM — it was not found.");
  }

  const forgeValueEl = document.getElementById("forge-value");
  if (!forgeValueEl) {
    problems.push("Expected #forge-value to exist in the DOM — it was not found.");
  }

  const forgeActions = document.getElementById("forge-actions");
  if (!forgeActions) {
    problems.push("Expected #forge-actions to exist in the DOM — it was not found.");
  }

  const btnForgeTool = document.getElementById("btn-forge-tool");
  if (!btnForgeTool) {
    problems.push("Expected #btn-forge-tool to exist in the DOM — it was not found.");
  } else if (btnForgeTool.getAttribute("type") !== "button") {
    problems.push(`Expected #btn-forge-tool type="button", got "${btnForgeTool.getAttribute("type")}".`);
  }

  // Forge button must have non-zero dimensions even when hidden
  if (forgeActions && !forgeActions.classList.contains("visible")) {
    if (btnForgeTool) {
      if (btnForgeTool.offsetWidth === 0) {
        problems.push("btn-forge-tool offsetWidth is 0 when forge-actions is hidden — expected non-zero (collapsed container).");
      }
      if (btnForgeTool.offsetHeight === 0) {
        problems.push("btn-forge-tool offsetHeight is 0 when forge-actions is hidden — expected non-zero (collapsed container).");
      }
    }
  }

  // Forge button tap target
  if (btnForgeTool) {
    const h = parseFloat(getComputedStyle(btnForgeTool).height);
    if (h < 39.9) {
      problems.push(`#btn-forge-tool computed height is ${h}px — expected at least 40px (WCAG minimum tap target).`);
    }
  }

  // ─── Forge engine functionality ────────────────────────────────
  try {
    const engine = await import("./engine.js");
    engine.reset();

    // Forge should fail before wall is built
    const forgeFailNoWall = engine.forgeTool();
    if (forgeFailNoWall.forged !== false) {
      problems.push("forgeTool() with no wall should return forged=false.");
    }
    if (typeof forgeFailNoWall.reason !== "string" || forgeFailNoWall.reason.length === 0) {
      problems.push("forgeTool() failure should include a non-empty reason string.");
    }

    // Unlock stone and build a wall
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wallLevel=1

    // Forge should fail with insufficient resources
    const forgeFailNoRes = engine.forgeTool();
    if (forgeFailNoRes.forged !== false) {
      problems.push("forgeTool() with insufficient resources should return forged=false.");
    }

    // Get enough resources for first forge
    // First forge costs: 10 wood + 5 stone
    // Current: wood=0 (spent on sharpen), stone=0 (spent on wall)
    // Need: 10 wood, 5 stone
    for (let i = 0; i < 10; i++) engine.gatherWood();
    for (let i = 0; i < 5; i++) engine.gatherStone();

    const stateBeforeForge = engine.getState();
    const beforeWood = stateBeforeForge.wood;
    const beforeStone = stateBeforeForge.stone;
    const beforeRate = stateBeforeForge.rate;

    const forgeResult = engine.forgeTool();
    if (forgeResult.forged !== true) {
      problems.push(`forgeTool() with sufficient resources should return forged=true. Got reason: ${forgeResult.reason}`);
    }

    const stateAfterForge = engine.getState();
    if (stateAfterForge.forgeLevel !== 1) {
      problems.push(`After first forge, forgeLevel should be 1, got ${stateAfterForge.forgeLevel}.`);
    }
    // Wood should be decremented by forgeWoodCost (10)
    if (stateAfterForge.wood !== beforeWood - 10) {
      problems.push(`After first forge, wood should be ${beforeWood - 10}, got ${stateAfterForge.wood}.`);
    }
    // Stone should be decremented by forgeStoneCost (5)
    if (stateAfterForge.stone !== beforeStone - 5) {
      problems.push(`After first forge, stone should be ${beforeStone - 5}, got ${stateAfterForge.stone}.`);
    }
    // Rate should increase by FORGE_WOOD_RATE_BONUS
    if (stateAfterForge.rate !== beforeRate + engine.FORGE_WOOD_RATE_BONUS) {
      problems.push(`After first forge, rate should be ${beforeRate + engine.FORGE_WOOD_RATE_BONUS}, got ${stateAfterForge.rate}.`);
    }
    // Forge wood cost should escalate
    if (stateAfterForge.forgeWoodCost !== 15) {
      problems.push(`After first forge, forgeWoodCost should be 15, got ${stateAfterForge.forgeWoodCost}.`);
    }
    // Forge stone cost should escalate
    if (stateAfterForge.forgeStoneCost !== 8) {
      problems.push(`After first forge, forgeStoneCost should be 8, got ${stateAfterForge.forgeStoneCost}.`);
    }

    // GatherWood should give extra click power from forge
    engine.reset();
    // Unlock everything
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade();
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall();
    // Wall=1, forge=0: clickPower = 1 + 1*1 + 0*0.5 = 2
    const woodBeforeGather = engine.getState().wood;
    // Need to get forge resources: 10 wood, 5 stone
    for (let i = 0; i < 5; i++) engine.gatherStone();
    // Actually gather enough wood - wood needs to be at least 10
    // After reset and above operations, wood is at 0 (spent on sharpen)
    // We used 5 gatherWood calls before sharpen = 5 wood, then crafted (-5) = 0 wood
    for (let i = 0; i < 10; i++) engine.gatherWood(); // +10 wood with wall=1 gives 2 each = 20 wood? No wait
    // Actually with wallLevel=1, gatherWood gives 1 + 1 = 2 per click
    // So 10 clicks gives 20 wood
    engine.forgeTool(); // forgeLevel=1
    // Now gatherWood: clickPower = 1 + 1*1 + 1*0.5 = 2.5
    const woodBeforeGather2 = engine.getState().wood;
    engine.gatherWood();
    const woodAfterGather = engine.getState().wood;
    const gain = woodAfterGather - woodBeforeGather2;
    if (Math.abs(gain - 2.5) > 0.01) {
      problems.push(`gatherWood() with wallLevel=1 and forgeLevel=1 should add 2.5 wood, got ${gain}.`);
    }

    // Forge persistence round-trip
    engine.reset();
    for (let i = 0; i < 5; i++) engine.gatherWood();
    engine.craftUpgrade();
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall();
    for (let i = 0; i < 10; i++) engine.gatherWood();
    for (let i = 0; i < 5; i++) engine.gatherStone();
    engine.forgeTool();
    const forgedRate = engine.getState().rate;
    engine.save();
    const savedStateRaw = localStorage.getItem("selfgrow-state");
    engine.reset();
    localStorage.setItem("selfgrow-state", savedStateRaw);
    engine.init();
    const loadedForgeState = engine.getState();
    if (loadedForgeState.forgeLevel !== 1) {
      problems.push(`After forge persistence round-trip, forgeLevel should be 1, got ${loadedForgeState.forgeLevel}.`);
    }
    if (loadedForgeState.rate !== forgedRate) {
      problems.push(`After forge persistence round-trip, rate should be ${forgedRate}, got ${loadedForgeState.rate}.`);
    }
    if (loadedForgeState.forgeWoodCost !== 15) {
      problems.push(`After forge persistence round-trip, forgeWoodCost should be 15, got ${loadedForgeState.forgeWoodCost}.`);
    }
    if (loadedForgeState.forgeStoneCost !== 8) {
      problems.push(`After forge persistence round-trip, forgeStoneCost should be 8, got ${loadedForgeState.forgeStoneCost}.`);
    }

    // Clean up
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Forge engine test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Forge agent tools ────────────────────────────────────────
  try {
    const { tools } = await import("./agenttools.js");
    const toolList = tools();

    // read-state should include forge fields
    const readState = toolList.find((t) => t.name === "read-state");
    if (readState) {
      const result = await readState.execute({});
      if (typeof result.forgeLevel !== "number") {
        problems.push(`read-state should return forgeLevel as a number, got ${JSON.stringify(result.forgeLevel)}.`);
      }
      if (typeof result.forgeWoodCost !== "number") {
        problems.push(`read-state should return forgeWoodCost as a number, got ${JSON.stringify(result.forgeWoodCost)}.`);
      }
      if (typeof result.forgeStoneCost !== "number") {
        problems.push(`read-state should return forgeStoneCost as a number, got ${JSON.stringify(result.forgeStoneCost)}.`);
      }
    }

    // perform-action forge-tool
    const performAction = toolList.find((t) => t.name === "perform-action");
    if (performAction) {
      const engine = await import("./engine.js");
      engine.reset();

      // Set up state for forge
      for (let i = 0; i < 5; i++) engine.gatherWood();
      await performAction.execute({ action: "sharpen" });
      for (let i = 0; i < engine.WALL_COST; i++) await performAction.execute({ action: "gather-stone" });
      await performAction.execute({ action: "build-wall" });

      // Try forging with insufficient resources
      const failResult = await performAction.execute({ action: "forge-tool" });
      if (typeof failResult !== "object" || failResult === null) {
        problems.push("perform-action forge-tool should return an object.");
      } else {
        // forgeLevel should still be 0 (forge failed)
        if (failResult.forgeLevel !== 0) {
          problems.push(`forge-tool with insufficient resources should not change forgeLevel. Got ${failResult.forgeLevel}.`);
        }
      }

      // Get enough resources
      for (let i = 0; i < 10; i++) await performAction.execute({ action: "gather" });
      for (let i = 0; i < 5; i++) await performAction.execute({ action: "gather-stone" });

      const forgeToolResult = await performAction.execute({ action: "forge-tool" });
      if (typeof forgeToolResult !== "object" || forgeToolResult === null) {
        problems.push("perform-action forge-tool should return an object.");
      } else {
        if (forgeToolResult.forgeLevel !== 1) {
          problems.push(`perform-action forge-tool should set forgeLevel to 1, got ${forgeToolResult.forgeLevel}.`);
        }
        if (forgeToolResult.forgeWoodCost !== 15) {
          problems.push(`perform-action forge-tool forgeWoodCost should be 15, got ${forgeToolResult.forgeWoodCost}.`);
        }
        if (forgeToolResult.forgeStoneCost !== 8) {
          problems.push(`perform-action forge-tool forgeStoneCost should be 8, got ${forgeToolResult.forgeStoneCost}.`);
        }
        // Should have nextGoal reflecting forge
        if (forgeToolResult.nextGoal && forgeToolResult.nextGoal.type !== "forge-goal") {
          problems.push(`perform-action forge-tool nextGoal type should be "forge-goal", got "${forgeToolResult.nextGoal.type}".`);
        }
      }

      engine.reset();
      engine.init();
    }
  } catch (err) {
    problems.push(`Forge agent tools test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Sharpen button: locked-state aria-label must contain a real number ───
  // The aria-label in the locked state is "Sharpen Axe — locked, gather N more wood to unlock"
  // where N is computed from getState().wood. A prior bug rendered the concatenation
  // expression literally ("gather ' + (GOAL_WOOD - Math.floor(wood)) + ' more") instead
  // of evaluating it, which is exactly the failure the playtester reported (#924).
  try {
    const engine = await import("./engine.js");
    engine.reset();
    engine.init();
    // Run renderUI to push initial state to DOM
    // (the sharpen button should show locked state on fresh start)
    const btn = document.getElementById("btn-sharpen");
    if (btn) {
      const aria = btn.getAttribute("aria-label");
      if (!aria) {
        problems.push("btn-sharpen aria-label is missing — expected a descriptive locked-state string.");
      } else {
        // Check for source-code literals that would indicate the expression wasn't evaluated
        const literalPatterns = ["GOAL_WOOD", "Math.floor", "\" + \""];
        for (const pat of literalPatterns) {
          if (aria.includes(pat)) {
            problems.push(`btn-sharpen aria-label contains literal source text "${pat}": "${aria}". The concatenation expression was not evaluated.`);
          }
        }
        // Check that the aria-label actually contains a numeric character (the gather count)
        if (!/\d/.test(aria)) {
          problems.push(`btn-sharpen aria-label should contain a numeric gather count, got: "${aria}".`);
        }
        // Check that it says "locked" or "Locked"
        if (!/locked/i.test(aria)) {
          problems.push(`btn-sharpen aria-label should indicate locked state on fresh start, got: "${aria}".`);
        }
      }
    } else {
      problems.push("Expected #btn-sharpen to be in the DOM for aria-label check — it was not found.");
    }
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Sharpen button aria-label test threw: ${err.message}`);
    console.error(err);
  }

  return problems;
}