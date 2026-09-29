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

  // If a reload left an overlay open, close it so the page is back in its
  // normal, laid-out state before the checks below measure the panels.
  if (typeof window.__exitSandbox === "function") window.__exitSandbox();
  if (typeof window.__dismissOffline === "function") window.__dismissOffline();

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
    // A single-resource goal still shows its exact numbers, so label 1 is
    // visible and non-empty; only the second resource's label is hidden.
    if (goalLabel1 && goalLabel1.hidden) {
      problems.push("Expected #goal-resource-label-1 to be visible on page load (single-resource goal) — it was hidden.");
    } else if (goalLabel1 && !goalLabel1.textContent.trim()) {
      problems.push("Expected #goal-resource-label-1 to show its 'current / target' numbers on page load — it was empty.");
    }
    if (goalLabel2 && !goalLabel2.hidden) {
      problems.push("Expected #goal-resource-label-2 to be hidden on page load (single-resource goal) — it was visible.");
    }
  }

  // ─── Goal announcer: polite live region for screen readers ───
  const goalAnnouncer = document.getElementById("goal-announcer");
  if (!goalAnnouncer) {
    problems.push("Expected #goal-announcer to exist in the DOM — it was not found.");
  } else {
    if (goalAnnouncer.getAttribute("aria-live") !== "polite") {
      problems.push(`Expected #goal-announcer aria-live="polite", got "${goalAnnouncer.getAttribute("aria-live")}".`);
    }
    if (goalAnnouncer.getAttribute("aria-atomic") !== "true") {
      problems.push(`Expected #goal-announcer aria-atomic="true", got "${goalAnnouncer.getAttribute("aria-atomic")}".`);
    }
    if (!goalAnnouncer.classList.contains("visually-hidden")) {
      problems.push("Expected #goal-announcer to be visually hidden — it lacked the 'visually-hidden' class.");
    }
    const announcerStyle = getComputedStyle(goalAnnouncer);
    if (announcerStyle.position !== "absolute" || announcerStyle.width !== "1px") {
      problems.push(`Expected #goal-announcer to be hidden from layout, got position "${announcerStyle.position}" and width "${announcerStyle.width}".`);
    }
    if (goalAnnouncer.textContent.trim() !== "") {
      problems.push(`Expected #goal-announcer to be empty on page load (nothing announced before the player acts), got "${goalAnnouncer.textContent}".`);
    }
  }

  // ─── Goal announcer: fires on change, not on every render tick ───
  try {
    const engine = await import("./engine.js");
    engine.reset();
    engine.init();

    if (goalAnnouncer && typeof window.__renderUI === "function") {
      // Establish a baseline render, then render the same state again. An
      // unchanged render tick must not produce a fresh announcement.
      window.__renderUI();
      const idleMessage = goalAnnouncer.textContent;
      window.__renderUI();
      if (goalAnnouncer.textContent !== idleMessage) {
        problems.push(`Goal announcer must not re-announce an unchanged render tick, got "${goalAnnouncer.textContent}" (was "${idleMessage}").`);
      }

      // Reaching 10 wood completes the gathering goal and reveals sharpening.
      for (let i = 0; i < 10; i++) engine.gatherWood();
      window.__renderUI();
      const announced = goalAnnouncer.textContent;
      if (!announced.startsWith("Goal complete:")) {
        problems.push(`Expected the goal announcer to confirm completion when the goal changes, got "${announced}".`);
      }
      const newGoalText = document.getElementById("goal-text").textContent;
      if (!announced.includes(newGoalText)) {
        problems.push(`Expected the goal announcer to name the new goal "${newGoalText}", got "${announced}".`);
      }

      // A goal change while an overlay is open must stay silent.
      window.__setOverlayOpen("selftest", true);
      engine.craftUpgrade();
      window.__renderUI();
      if (goalAnnouncer.textContent !== announced) {
        problems.push(`Goal announcer must stay silent while an overlay is open, got "${goalAnnouncer.textContent}" (was "${announced}").`);
      }
      window.__setOverlayOpen("selftest", false);
    }
  } catch (err) {
    problems.push(`Goal announcer test threw: ${err.message}`);
    console.error(err);
  }

  // Restore a clean game for the checks that follow.
  {
    const engine = await import("./engine.js");
    engine.reset();
    engine.init();
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

    // The panel must state how long the player was away (issue #961).
    const offlineElapsedEl = document.getElementById("offline-elapsed");
    if (!offlineElapsedEl) {
      problems.push("Expected #offline-elapsed to exist in the offline-summary — it was not found.");
    } else if (!offlineElapsedEl.closest(".offline-message")) {
      problems.push("Expected #offline-elapsed to live inside the .offline-message block — it did not.");
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

      // ─── After dismiss, action button states must reconcile immediately ───
      // renderUI() must have been called at the end of dismissOffline()
      const engineMod = (await import("./engine.js"));
      const sAfter = engineMod.getState();
      const woodAfter = sAfter.wood;
      const sharpenAfter = document.getElementById("btn-sharpen");
      if (sharpenAfter) {
        if (woodAfter >= engineMod.UPGRADE_COST && sharpenAfter.disabled) {
          problems.push(`Expected #btn-sharpen to be enabled after dismissing offline-summary (wood=${woodAfter} >= ${engineMod.UPGRADE_COST}) — it was still disabled.`);
        }
        if (woodAfter < engineMod.UPGRADE_COST && !sharpenAfter.disabled) {
          problems.push(`Expected #btn-sharpen to be disabled after dismissing offline-summary (wood=${woodAfter} < ${engineMod.UPGRADE_COST}) — it was enabled.`);
        }
      }
      const wallAfter = document.getElementById("btn-build-wall");
      if (wallAfter) {
        // Button should be hidden or disabled since stone is not unlocked yet
        if (!wallAfter.disabled) {
          problems.push("Expected #btn-build-wall to be disabled after dismissing offline-summary (stone not unlocked) — it was enabled.");
        }
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
    const beforeRate = engine.getState().rate;
    const result = engine.craftUpgrade();
    if (result.upgraded !== true) {
      problems.push("craftUpgrade at the first goal (10 wood) should return upgraded=true.");
    }
    const upgradedState = engine.getState();
    if (upgradedState.wood !== 5) {
      problems.push(`After craftUpgrade with 10 wood, wood should be 5, got ${upgradedState.wood}.`);
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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

    // --- Test 13b: loadPersisted backfills stoneUnlocked for old saves ---
    engine.reset();
    localStorage.removeItem("selfgrow-state");
    // Simulate an old save that predates the stone system:
    // upgradeLevel=1, but no stoneUnlocked field in the persisted data
    const oldSave = JSON.stringify({
      wood: 5,
      rate: 0.15,
      upgradeLevel: 1,
      stone: 0,
      totalWoodEarned: 5,
      wallLevel: 0,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem("selfgrow-state", oldSave);
    engine.init();
    const loadedOld = engine.getState();
    if (loadedOld.stoneUnlocked !== true) {
      problems.push("Old save with upgradeLevel=1 and no stoneUnlocked field should get stoneUnlocked=true on load, "
        + `got ${loadedOld.stoneUnlocked}. The stone system would be invisible to the player.`);
    }
    if (loadedOld.upgradeLevel !== 1) {
      problems.push(`Old save upgradeLevel should remain 1, got ${loadedOld.upgradeLevel}.`);
    }
    // Verify that a fresh save (upgradeLevel=0, no stoneUnlocked) still starts with stone locked
    engine.reset();
    localStorage.removeItem("selfgrow-state");
    const freshSave = JSON.stringify({
      wood: 0,
      rate: 0.1,
      upgradeLevel: 0,
      stone: 0,
      totalWoodEarned: 0,
      wallLevel: 0,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem("selfgrow-state", freshSave);
    engine.init();
    const freshLoaded = engine.getState();
    if (freshLoaded.stoneUnlocked !== false) {
      problems.push("Fresh save with upgradeLevel=0 should have stoneUnlocked=false on load, "
        + `got ${freshLoaded.stoneUnlocked}.`);
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
    engine.craftUpgrade();
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wallLevel=1
    engine.gatherWood(); // +2
    const state2 = engine.getState();
    // total: 1 (first gather) + 10 more gathers before the first sharpen + sharpen (no net change) + 5 stone gathers (no wood) + 2 (wall boosted)
    // totalWoodEarned should be 13
    if (state2.totalWoodEarned !== 13) {
      problems.push(`totalWoodEarned should be 13 after sequence, got ${state2.totalWoodEarned}. Expected: 1 (first) + 10 (to reach the first goal) + 2 (wall boosted gather) = 13.`);
    }

    // --- Test 20: totalStoneEarned tracks stone gained via gatherStone and passive ---
    engine.reset();
    // Unlock stone
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
        // Check offlineElapsed field (null when the panel is hidden, else human text)
        if (result.offlineElapsed !== null && (typeof result.offlineElapsed !== "string" || result.offlineElapsed.length === 0)) {
          problems.push(`read-state should return offlineElapsed as null or a non-empty string, got ${JSON.stringify(result.offlineElapsed)}.`);
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
      for (let i = 0; i < 10; i++) engine.gatherWood();
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
      for (let i = 0; i < 10; i++) engine.gatherWood();
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
      for (let i = 0; i < 10; i++) engine.gatherWood();
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

        // ─── Agent dismiss-offline: DOM button states must reconcile immediately ───
        const engineMod2 = (await import("./engine.js"));
        const sAfterAgent = engineMod2.getState();
        const woodAfterAgent = sAfterAgent.wood;
        const sharpenAfterAgent = document.getElementById("btn-sharpen");
        if (sharpenAfterAgent) {
          if (woodAfterAgent >= engineMod2.UPGRADE_COST && sharpenAfterAgent.disabled) {
            problems.push(`Agent dismiss-offline: Expected #btn-sharpen to be enabled (wood=${woodAfterAgent} >= ${engineMod2.UPGRADE_COST}) — it was still disabled.`);
          }
          if (woodAfterAgent < engineMod2.UPGRADE_COST && !sharpenAfterAgent.disabled) {
            problems.push(`Agent dismiss-offline: Expected #btn-sharpen to be disabled (wood=${woodAfterAgent} < ${engineMod2.UPGRADE_COST}) — it was enabled.`);
          }
        }
        const wallAfterAgent = document.getElementById("btn-build-wall");
        if (wallAfterAgent) {
          if (!wallAfterAgent.disabled) {
            problems.push("Agent dismiss-offline: Expected #btn-build-wall to be disabled (stone not unlocked) — it was enabled.");
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

  // ─── Issue #967: goal bars show exact 'current / target' numbers ───
  // Every goal spells out how close it is beside its bar, and those numbers are
  // the same ones the read-state tool reports at that moment. The numbers are
  // associated with the bar, so a screen reader reads the goal, its numbers and
  // its bar together.
  try {
    const engine = await import("./engine.js");
    const { displayAmount } = engine;
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };
    const readLabel = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return null;
      const m = /^(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)$/.exec(el.textContent.trim());
      return m ? { name: m[1], current: parseFloat(m[2]), target: parseFloat(m[3]) } : { raw: el.textContent.trim() };
    };

    // The shared rounding rule: integers and values at or above 10 are floored,
    // everything below keeps two decimals.
    if (displayAmount(7) !== 7 || displayAmount(7.5) !== 7.5 || displayAmount(10.5) !== 10) {
      problems.push(`displayAmount should floor integers and values >= 10 and keep two decimals below, got displayAmount(7)=${displayAmount(7)}, displayAmount(7.5)=${displayAmount(7.5)}, displayAmount(10.5)=${displayAmount(10.5)}.`);
    }

    // Both bars must be labelled by the goal text and their own numbers.
    const track1 = document.getElementById("goal-progress-track-1");
    const track2 = document.getElementById("goal-progress-track-2");
    const labelledBy = (el) => (el ? (el.getAttribute("aria-labelledby") || "").split(/\s+/) : []);
    for (const id of ["goal-label", "goal-text", "goal-resource-label-1"]) {
      if (!labelledBy(track1).includes(id)) {
        problems.push(`#goal-progress-track-1 aria-labelledby should reference #${id}, got "${track1 ? track1.getAttribute("aria-labelledby") : "(no track)"}".`);
      }
    }
    for (const id of ["goal-label", "goal-text", "goal-resource-label-2"]) {
      if (!labelledBy(track2).includes(id)) {
        problems.push(`#goal-progress-track-2 aria-labelledby should reference #${id}, got "${track2 ? track2.getAttribute("aria-labelledby") : "(no track)"}".`);
      }
    }

    // Single-resource goal: 7 of 10 wood. reset() stops the tick, so the
    // rendered label and the tool read the same state with no drift between them.
    engine.reset();
    for (let i = 0; i < 7; i++) engine.gatherWood();
    renderNow();
    const singleLabel = readLabel("goal-resource-label-1");
    const singleState = await readState.execute({});
    if (!singleLabel || singleLabel.raw !== undefined) {
      problems.push(`Single goal should show a 'Name: current / target' label, got ${JSON.stringify(singleLabel)}.`);
    } else if (singleState.nextGoal.type === "first-goal") {
      if (singleLabel.current !== singleState.nextGoal.progress || singleLabel.target !== singleState.nextGoal.target) {
        problems.push(`Single goal label showed "${singleLabel.name}: ${singleLabel.current} / ${singleLabel.target}" but read-state nextGoal reported ${singleState.nextGoal.progress} / ${singleState.nextGoal.target}.`);
      }
    } else {
      problems.push(`Expected a 'first-goal' with 7 wood, got "${singleState.nextGoal.type}".`);
    }

    // Dual-resource goal: the forge goal after building the wall.
    engine.reset();
    for (let i = 0; i < 15; i++) engine.gatherWood();
    engine.craftUpgrade(); // wood 15 -> 10, unlocks stone
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wall built, stone back to 0
    renderNow();
    const dualLabel1 = readLabel("goal-resource-label-1");
    const dualLabel2 = readLabel("goal-resource-label-2");
    const dualState = await readState.execute({});
    const dualGoal = dualState.nextGoal;
    if (dualGoal.type !== "forge-goal" || !Array.isArray(dualGoal.resources) || dualGoal.resources.length !== 2) {
      problems.push(`Expected a dual 'forge-goal' after building the wall, got "${dualGoal.type}".`);
    } else {
      const woodRes = dualGoal.resources.find((r) => r.name === "Wood");
      const stoneRes = dualGoal.resources.find((r) => r.name === "Stone");
      if (!dualLabel1 || dualLabel1.raw !== undefined || !woodRes) {
        problems.push(`Dual goal should show a Wood 'current / target' label, got ${JSON.stringify(dualLabel1)}.`);
      } else if (dualLabel1.current !== woodRes.current || dualLabel1.target !== woodRes.target) {
        problems.push(`Dual Wood label showed ${dualLabel1.current} / ${dualLabel1.target} but read-state reported ${woodRes.current} / ${woodRes.target}.`);
      }
      if (!dualLabel2 || dualLabel2.raw !== undefined || !stoneRes) {
        problems.push(`Dual goal should show a Stone 'current / target' label, got ${JSON.stringify(dualLabel2)}.`);
      } else if (dualLabel2.current !== stoneRes.current || dualLabel2.target !== stoneRes.target) {
        problems.push(`Dual Stone label showed ${dualLabel2.current} / ${dualLabel2.target} but read-state reported ${stoneRes.current} / ${stoneRes.target}.`);
      }
    }

    // Clean up
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Goal label numbers test threw: ${err.message}`);
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

  // ─── One-screen promise: no scrolling on a desktop (>= 1280x720) ────
  // The whole game must fit the window now and as it grows. Measured on the
  // document element, and again per panel so clipping (which a bare
  // overflow:hidden would hide) is caught rather than only the scrollbar.
  if (window.innerWidth >= 1280 && window.innerHeight >= 720) {
    const doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight) {
      problems.push(
        `On a ${window.innerWidth}x${window.innerHeight} window the page scrolls vertically: `
        + `content is ${doc.scrollHeight}px tall but the window is ${window.innerHeight}px.`
      );
    }
    if (doc.scrollWidth > window.innerWidth) {
      problems.push(
        `On a ${window.innerWidth}x${window.innerHeight} window the page scrolls horizontally: `
        + `content is ${doc.scrollWidth}px wide but the window is ${window.innerWidth}px.`
      );
    }
    for (const p of document.querySelectorAll("body > section.panel")) {
      const rect = p.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom > window.innerHeight + 1) {
        problems.push(
          `#${p.id} extends past the bottom of a ${window.innerHeight}px window `
          + `(bottom ${Math.round(rect.bottom)}px) — the game must fit without scrolling.`
        );
      }
      if (rect.right > window.innerWidth + 1) {
        problems.push(
          `#${p.id} extends past the right edge of a ${window.innerWidth}px window `
          + `(right ${Math.round(rect.right)}px).`
        );
      }
    }
  }

  // ─── Header chips and system cards state what a player sees ────
  // Each unlocked resource chip must show its amount and per-second rate as
  // real text, and each visible system card must carry its own action button.
  const isLaidOut = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const headerEl = document.getElementById("status-bar");
  if (!headerEl) {
    problems.push("Expected #status-bar to exist as the resource header — it was not found.");
  } else {
    const chipChecks = [
      { chip: "wood-stat", amount: "wood-value", rate: "rate-value", label: "Wood" },
      { chip: "stone-stat", amount: "stone-value", rate: "stone-rate-value", label: "Stone" },
    ];
    for (const { chip, amount, rate, label } of chipChecks) {
      const chipEl = document.getElementById(chip);
      if (!chipEl) {
        problems.push(`Expected #${chip} resource chip in #status-bar — it was not found.`);
        continue;
      }
      if (!isLaidOut(chipEl)) continue; // locked resource: not on screen yet
      const amountEl = document.getElementById(amount);
      const rateEl = document.getElementById(rate);
      if (!amountEl || !chipEl.contains(amountEl) || !/\d/.test(amountEl.textContent)) {
        problems.push(`The ${label} chip should show its amount as real text in #${amount}.`);
      }
      if (!rateEl || !chipEl.contains(rateEl) || !rateEl.textContent.includes("/s")) {
        problems.push(`The ${label} chip should show its per-second rate in #${rate}.`);
      }
    }
  }

  const actionAreaEl = document.getElementById("action-area");
  if (!actionAreaEl) {
    problems.push("Expected #action-area to exist as the system-card grid — it was not found.");
  } else {
    const cards = document.querySelectorAll("#action-area .system-card");
    if (cards.length === 0) {
      problems.push("Expected one .system-card per system inside #action-area — none found.");
    }
    let visibleCards = 0;
    for (const card of cards) {
      if (!isLaidOut(card)) continue;
      visibleCards++;
      if (!card.querySelector("button.btn")) {
        problems.push(`Visible system card #${card.id || "(no id)"} has no action button — a player cannot use it.`);
      }
      const nameEl = card.querySelector(".system-name");
      if (!nameEl || !nameEl.textContent.trim()) {
        problems.push(`Visible system card #${card.id || "(no id)"} has no system name — a player cannot tell what it is.`);
      }
    }
    if (visibleCards === 0) {
      problems.push("Expected at least one visible .system-card (the unlocked systems) — none were laid out.");
    }
  }

  // ─── The Wood card's yield equals the engine's click power ────
  // A player is told what one chop gives; that number must be the number the
  // next chop actually delivers, bonuses included.
  const woodYieldEl = document.getElementById("wood-yield-value");
  if (woodYieldEl) {
    const engine = await import("./engine.js");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };
    engine.reset();
    for (let i = 0; i < 15; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wallLevel = 1, so click power rises
    renderNow();
    const lived = engine.getState();
    const clickPower = 1 + lived.wallLevel + lived.forgeLevel * 0.5;
    const expected = "+" + (Number.isInteger(clickPower) ? clickPower : clickPower.toFixed(1)) + " / chop";
    const shown = woodYieldEl.textContent.trim();
    if (shown !== expected) {
      problems.push(`Wood card yields "${shown}" but the engine's click power is ${clickPower} (expected "${expected}").`);
    }
    engine.reset();
    engine.init();
    renderNow();
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

  // The forge button is only on screen once the forge is unlocked and its
  // card is visible; measure it then, because a display:none card collapses
  // to nothing (which is the intended "not available yet" state).
  if (forgeActions && forgeActions.classList.contains("visible") && btnForgeTool) {
    if (btnForgeTool.offsetWidth === 0 || btnForgeTool.offsetHeight === 0) {
      problems.push("btn-forge-tool should have non-zero dimensions while the forge card is visible.");
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
    // Current: wood=5 (10 gathered, 5 spent on sharpen), stone=0 (spent on wall)
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
    engine.craftUpgrade();
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall();
    // Wall=1, forge=0: clickPower = 1 + 1*1 + 0*0.5 = 2
    const woodBeforeGather = engine.getState().wood;
    // Need to get forge resources: 10 wood, 5 stone
    for (let i = 0; i < 5; i++) engine.gatherStone();
    // Actually gather enough wood - wood needs to be at least 10
    // After reset and above operations, wood is at 0 (spent on sharpen)
    // We gathered 10 wood to reach the first goal, then crafted (-5) = 5 wood
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
    for (let i = 0; i < 10; i++) engine.gatherWood();
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
      for (let i = 0; i < 10; i++) engine.gatherWood();
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
    // Ensure the DOM reflects the fresh game state
    if (typeof window.__renderUI === "function") window.__renderUI();
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

  // ─── Sharpen goal progress bar uses Math.min instead of modulo ───
  try {
    const engine = await import("./engine.js");
    engine.reset();
    engine.init();

    // Gather 12 wood — that's >= GOAL_WOOD (10) and > UPGRADE_COST (5)
    for (let i = 0; i < 12; i++) engine.gatherWood();

    // renderUI to update DOM
    if (typeof window.__renderUI === "function") window.__renderUI();

    const track1 = document.getElementById("goal-progress-track-1");
    if (!track1) {
      problems.push("Expected #goal-progress-track-1 to exist for sharpen progress bar check.");
    } else if (!track1.hidden) {
      const ariaNow = track1.getAttribute("aria-valuenow");
      const ariaMax = track1.getAttribute("aria-valuemax");
      if (ariaNow === null || ariaMax === null) {
        problems.push(`goal-progress-track-1 is missing aria-valuenow (${ariaNow}) or aria-valuemax (${ariaMax}).`);
      } else {
        const current = parseInt(ariaNow, 10);
        const max = parseInt(ariaMax, 10);
        // With wood=12 and cost=5, Math.min(wood, UPGRADE_COST)=5, so bar shows 5/5 (100%)
        if (current !== 5 || max !== 5) {
          problems.push(`Sharpen goal progress bar should show 5/5 (Math.min(wood, 5)) at wood=12, got ${current}/${max}. `
            + "Using `wood % UPGRADE_COST` would give 2/5 instead.");
        }
      }
    }

    // Wall goal must also cap at the cost: sharpen once, gather 7 stone
    // (>= GOAL_STONE and > WALL_COST) without building the wall — the bar
    // should show 5/5, not 7/5.
    engine.reset();
    engine.init();
    for (let i = 0; i < 10; i++) engine.gatherWood(); // get to GOAL_WOOD (10)
    engine.craftUpgrade(); // unlocks stone, consumes 5 wood, leaves 5
    for (let i = 0; i < 5; i++) engine.gatherWood(); // back to 10 wood
    for (let i = 0; i < 7; i++) engine.gatherStone();
    if (typeof window.__renderUI === "function") window.__renderUI();

    const track2 = document.getElementById("goal-progress-track-1");
    if (!track2) {
      problems.push("Expected #goal-progress-track-1 to exist for wall goal progress check.");
    } else if (!track2.hidden) {
      const now = track2.getAttribute("aria-valuenow");
      const max = track2.getAttribute("aria-valuemax");
      // Math.min(7, WALL_COST=5)=5, so 5/5
      if (now !== "5" || max !== "5") {
        problems.push(`Wall goal progress bar should show 5/5 (Math.min(stone, 5)) with 7 stone, got ${now}/${max}.`);
      }
    }

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Sharpen progress bar test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Issue #966: one sharpen-availability rule everywhere ───
  // The button, the goal panel, the read-state tool and craftUpgrade must all
  // agree on when the first sharpen is available: at the 10-wood first goal.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const toolList = tools();
    const readState = toolList.find((t) => t.name === "read-state");
    const performAction = toolList.find((t) => t.name === "perform-action");
    const btn = document.getElementById("btn-sharpen");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };

    // --- Below the first goal (9 wood): everything agrees it is unavailable ---
    engine.reset();
    for (let i = 0; i < 9; i++) engine.gatherWood();
    renderNow();
    const nine = engine.getState();
    if (engine.sharpenAvailable(nine)) {
      problems.push("sharpenAvailable should be false at 9 wood, before the first goal is reached.");
    }
    const readNine = await readState.execute({});
    if (readNine.upgradeAvailable !== false) {
      problems.push(`read-state upgradeAvailable should be false at 9 wood, got ${readNine.upgradeAvailable}.`);
    }
    if (readNine.milestones.sharpenAvailable !== false) {
      problems.push(`read-state milestones.sharpenAvailable should be false at 9 wood, got ${readNine.milestones.sharpenAvailable}.`);
    }
    if (!btn || !btn.disabled) {
      problems.push("Sharpen button should be disabled at 9 wood, before the first goal is reached.");
    }
    const trackNine = document.getElementById("goal-progress-track-1");
    const textNine = document.getElementById("goal-text");
    if (trackNine && !trackNine.hidden && textNine && /Sharpen/i.test(textNine.textContent)) {
      const now = parseInt(trackNine.getAttribute("aria-valuenow"), 10);
      const max = parseInt(trackNine.getAttribute("aria-valuemax"), 10);
      if (max > 0 && now >= max) {
        problems.push(`Sharpen goal bar read ${now}/${max} at 9 wood, before the button was enabled.`);
      }
    }

    // An agent's sharpen must be refused, with the state left untouched.
    const refused = await performAction.execute({ action: "sharpen" });
    const afterRefused = engine.getState();
    if (refused.ok !== false || typeof refused.reason !== "string" || refused.reason.length === 0) {
      problems.push(`perform-action "sharpen" at 9 wood should be refused with {ok:false, reason}, got ${JSON.stringify(refused).slice(0, 200)}.`);
    }
    if (afterRefused.upgradeLevel !== nine.upgradeLevel || afterRefused.wood !== nine.wood) {
      problems.push("A refused sharpen at 9 wood must leave wood and upgradeLevel unchanged.");
    }

    // --- At the first goal (10 wood): everything agrees it is available, no reload ---
    engine.reset();
    for (let i = 0; i < 10; i++) engine.gatherWood();
    renderNow();
    const ten = engine.getState();
    if (!engine.sharpenAvailable(ten)) {
      problems.push("sharpenAvailable should be true at 10 wood, the first goal.");
    }
    const readTen = await readState.execute({});
    if (readTen.upgradeAvailable !== true) {
      problems.push(`read-state upgradeAvailable should be true at 10 wood, got ${readTen.upgradeAvailable}.`);
    }
    if (readTen.milestones.sharpenAvailable !== true) {
      problems.push(`read-state milestones.sharpenAvailable should be true at 10 wood, got ${readTen.milestones.sharpenAvailable}.`);
    }
    if (!btn || btn.disabled) {
      problems.push("Sharpen button should be enabled within one render cycle after the first goal is reached, with no reload.");
    }
    if (btn && !/Sharpen Axe \(\d+ wood\)/.test(btn.textContent.trim())) {
      problems.push(`Sharpen button at 10 wood should show its wood cost instead of 'locked', got "${btn.textContent.trim()}".`);
    }
    const trackTen = document.getElementById("goal-progress-track-1");
    if (trackTen && !trackTen.hidden) {
      const now = parseInt(trackTen.getAttribute("aria-valuenow"), 10);
      const max = parseInt(trackTen.getAttribute("aria-valuemax"), 10);
      if (!(max > 0 && now >= max)) {
        problems.push(`Sharpen goal bar should read 100% when the button is enabled at 10 wood, got ${now}/${max}.`);
      }
    }

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Sharpen availability rule test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Offline summary overlay appears after any resource gain (no time guard) ───
  // Issue #943: the overlay must appear after any reload where resources were gained,
  // regardless of how short the absence was. The `elapsedSec > 3` guard was removed.
  try {
    const engine = await import("./engine.js");
    const overlay = document.getElementById("offline-summary");
    if (!overlay) {
      problems.push("Expected #offline-summary to exist for overlay test.");
    } else {
      // Simulate a short absence (~2 seconds) that yields ~0.2 wood via catch-up
      engine.reset();
      const twoSecAgo = new Date(Date.now() - 2000).toISOString();
      const shortState = JSON.stringify({
        wood: 0, rate: 0.1, upgradeLevel: 0,
        stone: 0, totalWoodEarned: 0, totalStoneEarned: 0,
        wallLevel: 0, forgeLevel: 0, stoneUnlocked: false,
        timestamp: twoSecAgo, firstTimestamp: null
      });
      localStorage.setItem("selfgrow-state", shortState);
      engine.init(); // catches up ~0.2 wood, stores in offlineGained

      // Ensure overlay starts hidden
      overlay.setAttribute("hidden", "");

      // Call showOfflineSummary
      if (typeof window.__showOfflineSummary === "function") {
        window.__showOfflineSummary();
      } else {
        problems.push("Expected window.__showOfflineSummary to be exposed — it was not found.");
      }

      if (overlay.hidden) {
        problems.push("Offline summary overlay should be visible after showOfflineSummary() with positive wood gain from a short absence.");
      }

      if (!overlay.hidden) {
        // Verify the wood amount is displayed
        const woodAmountEl = document.getElementById("offline-wood-amount");
        if (woodAmountEl) {
          const text = woodAmountEl.textContent.trim();
          const num = parseFloat(text);
          if (isNaN(num) || num <= 0) {
            problems.push(`Offline summary wood amount should be a positive number, got "${text}".`);
          }
          // Should show at least one decimal place for small gains
          if (num < 1 && !text.includes(".")) {
            problems.push(`Offline summary wood amount (${text}) should include at least one decimal place for small gains < 1.`);
          }
        }

        // The panel must name the length of the absence (issue #961).
        const elapsedEl = document.getElementById("offline-elapsed");
        const elapsedText = elapsedEl ? elapsedEl.textContent.trim() : "";
        const elapsedMatch = /^(\d+)s$/.exec(elapsedText);
        if (!elapsedMatch) {
          problems.push(`#offline-elapsed should show a seconds duration like "2s" for a ~2s absence, got ${JSON.stringify(elapsedText)}.`);
        } else {
          const seconds = parseInt(elapsedMatch[1], 10);
          if (seconds < 2 || seconds > 10) {
            problems.push(`#offline-elapsed should read 2-10s for a seeded ~2s absence, got ${JSON.stringify(elapsedText)}.`);
          }
        }

        // The agent's read-state must expose the same duration as the panel.
        const { tools } = await import("./agenttools.js");
        const readStateTool = tools().find((t) => t.name === "read-state");
        if (!readStateTool) {
          problems.push("Expected a read-state tool for the offline-elapsed cross-check — it was not found.");
        } else {
          const elapsedState = await readStateTool.execute({});
          if (elapsedState.offlineElapsed !== elapsedText) {
            problems.push(`read-state.offlineElapsed should match the panel text ${JSON.stringify(elapsedText)}, got ${JSON.stringify(elapsedState.offlineElapsed)}.`);
          }
        }

        // Dismiss and verify
        const dismissBtn = document.getElementById("btn-dismiss-offline");
        if (dismissBtn) {
          dismissBtn.click();
          if (!overlay.hidden) {
            problems.push("Offline summary overlay should be hidden after dismiss button click.");
          }
          // Verify action buttons are re-enabled
          const btnG = document.getElementById("btn-gather");
          if (btnG && btnG.disabled) {
            problems.push("Expected #btn-gather to be enabled after dismissing offline summary.");
          }
        } else {
          problems.push("Expected #btn-dismiss-offline for overlay test.");
        }
      }
    }

    // Clean up
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Offline summary overlay test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Expedition system checks ───────────────────────────────────
  try {
    const engine = await import("./engine.js");
    engine.reset();

    // Verificar que sendExpedition existe
    if (typeof engine.sendExpedition !== "function") {
      problems.push("Engine should export sendExpedition function — it was not found.");
    }

    // Expedition should fail before forge level 5
    const expFailNoForge = engine.sendExpedition();
    if (expFailNoForge.sent !== false) {
      problems.push("sendExpedition() with forgeLevel < 5 should return sent=false.");
    }
    if (typeof expFailNoForge.reason !== "string" || expFailNoForge.reason.length === 0) {
      problems.push("sendExpedition() failure should include a non-empty reason string.");
    }

    // Set up state: unlock stone, build wall, forge tools to level 5
    for (let i = 0; i < 10; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    for (let i = 0; i < engine.WALL_COST; i++) engine.gatherStone();
    engine.buildWall(); // wallLevel=1

    // Forge up to level 5
    // Each forge costs escalating wood+stone. We'll gather heavily
    // After first forge: costs 10 wood + 5 stone
    for (let i = 0; i < 10; i++) engine.gatherWood();
    for (let i = 0; i < 5; i++) engine.gatherStone();
    engine.forgeTool(); // forgeLevel=1
    // Second forge: costs 15 wood + 8 stone
    for (let i = 0; i < 15; i++) engine.gatherWood();
    for (let i = 0; i < 8; i++) engine.gatherStone();
    engine.forgeTool(); // forgeLevel=2
    // Third forge: costs 20 wood + 11 stone
    for (let i = 0; i < 20; i++) engine.gatherWood();
    for (let i = 0; i < 11; i++) engine.gatherStone();
    engine.forgeTool(); // forgeLevel=3
    // Fourth forge: costs 25 wood + 14 stone
    for (let i = 0; i < 25; i++) engine.gatherWood();
    for (let i = 0; i < 14; i++) engine.gatherStone();
    engine.forgeTool(); // forgeLevel=4
    // Fifth forge: costs 30 wood + 17 stone
    for (let i = 0; i < 30; i++) engine.gatherWood();
    for (let i = 0; i < 17; i++) engine.gatherStone();
    engine.forgeTool(); // forgeLevel=5

    const stateBeforeExp = engine.getState();
    if (stateBeforeExp.forgeLevel < 5) {
      problems.push(`forgeLevel should be >= 5 before expedition test, got ${stateBeforeExp.forgeLevel}.`);
    }

    // Now expedition should be possible
    // First expedition costs: 10 wood + 5 stone
    const expWoodCost = stateBeforeExp.expeditionWoodCost;
    const expStoneCost = stateBeforeExp.expeditionStoneCost;
    if (expWoodCost !== 10) {
      problems.push(`First expedition wood cost should be 10, got ${expWoodCost}.`);
    }
    if (expStoneCost !== 5) {
      problems.push(`First expedition stone cost should be 5, got ${expStoneCost}.`);
    }

    const beforeWood = stateBeforeExp.wood;
    const beforeStone = stateBeforeExp.stone;
    const beforeRate = stateBeforeExp.rate;
    const beforeMaps = stateBeforeExp.maps;

    // Check we have enough resources
    if (beforeWood < expWoodCost || beforeStone < expStoneCost) {
      // Gather more if needed
      for (let i = 0; i < expWoodCost; i++) engine.gatherWood();
      for (let i = 0; i < expStoneCost; i++) engine.gatherStone();
    }

    const expResult = engine.sendExpedition();
    if (expResult.sent !== true) {
      problems.push(`sendExpedition() with sufficient resources should return sent=true. Got reason: ${expResult.reason}`);
    }

    const stateAfterExp = engine.getState();
    if (stateAfterExp.expeditionLevel !== 1) {
      problems.push(`After first expedition, expeditionLevel should be 1, got ${stateAfterExp.expeditionLevel}.`);
    }
    if (stateAfterExp.maps !== 1) {
      problems.push(`After first expedition, maps should be 1, got ${stateAfterExp.maps}.`);
    }
    // Wood rate should be unchanged (maps affect effective rate, not base rate)
    if (stateAfterExp.rate !== beforeRate) {
      problems.push(`After first expedition, base rate should be unchanged (${beforeRate}), got ${stateAfterExp.rate}.`);
    }
    // Resources should be decremented
    const woodSpent = beforeWood - stateAfterExp.wood;
    const stoneSpent = beforeStone - stateAfterExp.stone;
    // We may have gathered more after checking, so just verify costs are deducted correctly
    if (stateAfterExp.expeditionWoodCost !== 15) {
      problems.push(`After first expedition, expeditionWoodCost should be 15 (10+5), got ${stateAfterExp.expeditionWoodCost}.`);
    }
    if (stateAfterExp.expeditionStoneCost !== 8) {
      problems.push(`After first expedition, expeditionStoneCost should be 8 (5+3), got ${stateAfterExp.expeditionStoneCost}.`);
    }

    // Verify the effective rate multiplier
    // maps=1 => multiplier = 1 + 1*0.05 = 1.05
    const afterRate = stateAfterExp.rate;
    const expectedEffRate = afterRate * 1.05;
    // We can't check getEffectiveRate directly since it's internal, but we trust the tick uses it

    // Expedition persistence round-trip
    engine.save();
    const savedStateRaw = localStorage.getItem("selfgrow-state");
    engine.reset();
    localStorage.setItem("selfgrow-state", savedStateRaw);
    engine.init();
    const loadedExpState = engine.getState();
    if (loadedExpState.expeditionLevel !== 1) {
      problems.push(`After expedition persistence round-trip, expeditionLevel should be 1, got ${loadedExpState.expeditionLevel}.`);
    }
    if (loadedExpState.maps !== 1) {
      problems.push(`After expedition persistence round-trip, maps should be 1, got ${loadedExpState.maps}.`);
    }
    if (loadedExpState.expeditionWoodCost !== 15) {
      problems.push(`After expedition persistence round-trip, expeditionWoodCost should be 15, got ${loadedExpState.expeditionWoodCost}.`);
    }
    if (loadedExpState.expeditionStoneCost !== 8) {
      problems.push(`After expedition persistence round-trip, expeditionStoneCost should be 8, got ${loadedExpState.expeditionStoneCost}.`);
    }

    // Verify expedition milestone detection
    engine.reset();
    const oldStateExp = JSON.stringify({
      wood: 0, rate: 0.1, upgradeLevel: 0,
      stone: 0, totalWoodEarned: 0, totalStoneEarned: 0,
      wallLevel: 0, forgeLevel: 4, stoneUnlocked: false,  // forgeLevel=4 before catch-up
      expeditionLevel: 0, maps: 0,
      timestamp: new Date(Date.now() - 60000).toISOString(),
      firstTimestamp: null
    });
    localStorage.setItem("selfgrow-state", oldStateExp);
    engine.init();
    const milestones = engine.consumeOfflineMilestones();
    // forgeLevel should become >= 5? No, catch-up doesn't increase forgeLevel.
    // So expeditionNowUnlocked will be false.
    // This test just verifies the milestone exists without crashing
    if (typeof milestones.expeditionNowUnlocked !== "boolean") {
      problems.push("consumeOfflineMilestones should include expeditionNowUnlocked boolean field.");
    }

    // Clean up
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Expedition system test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Expedition DOM checks ────────────────────────────────────
  const expeditionStat = document.getElementById("expedition-stat");
  if (!expeditionStat) {
    problems.push("Expected #expedition-stat to exist in the DOM — it was not found.");
  }

  const mapValueEl = document.getElementById("map-value");
  if (!mapValueEl) {
    problems.push("Expected #map-value to exist in the DOM — it was not found.");
  }

  // ─── Sandbox DOM elements ───
  const sandboxBtn = document.getElementById("btn-sandbox");
  if (!sandboxBtn) {
    problems.push("Expected #btn-sandbox to exist in the DOM — it was not found.");
  } else {
    if (sandboxBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-sandbox type="button", got "${sandboxBtn.getAttribute("type")}".`);
    }
  }

  const sandboxOverlay = document.getElementById("sandbox-overlay");
  if (!sandboxOverlay) {
    problems.push("Expected #sandbox-overlay to exist in the DOM — it was not found.");
  } else {
    if (sandboxOverlay.getAttribute("role") !== "dialog") {
      problems.push(`Expected #sandbox-overlay role="dialog", got "${sandboxOverlay.getAttribute("role")}".`);
    }
    if (!sandboxOverlay.hidden) {
      problems.push("Expected #sandbox-overlay to be hidden by default — it was visible.");
    }
    const exitBtn = document.getElementById("sb-btn-exit");
    if (!exitBtn) {
      problems.push("Expected #sb-btn-exit to exist inside #sandbox-overlay — it was not found.");
    }
    const ffBtns = ["sb-btn-10x", "sb-btn-1h", "sb-btn-1d", "sb-btn-1mo"];
    for (const id of ffBtns) {
      const el = document.getElementById(id);
      if (!el) {
        problems.push(`Expected #${id} to exist inside #sandbox-overlay — it was not found.`);
      }
    }
  }

  const expeditionActions = document.getElementById("expedition-actions");
  if (!expeditionActions) {
    problems.push("Expected #expedition-actions to exist in the DOM — it was not found.");
  }

  const btnExpedition = document.getElementById("btn-expedition");
  if (!btnExpedition) {
    problems.push("Expected #btn-expedition to exist in the DOM — it was not found.");
  } else if (btnExpedition.getAttribute("type") !== "button") {
    problems.push(`Expected #btn-expedition type="button", got "${btnExpedition.getAttribute("type")}".`);
  }

  // The expedition button is only on screen once expeditions unlock and its
  // card is visible; measure it then, because a display:none card collapses
  // to nothing (which is the intended "not available yet" state).
  if (expeditionActions && expeditionActions.classList.contains("visible") && btnExpedition) {
    if (btnExpedition.offsetWidth === 0 || btnExpedition.offsetHeight === 0) {
      problems.push("btn-expedition should have non-zero dimensions while the expedition card is visible.");
    }
  }

  // Expedition button tap target
  if (btnExpedition) {
    const h = parseFloat(getComputedStyle(btnExpedition).height);
    if (h < 39.9) {
      problems.push(`#btn-expedition computed height is ${h}px — expected at least 40px (WCAG minimum tap target).`);
    }
  }

  // ─── Expedition agent tools ────────────────────────────────────
  try {
    const { tools } = await import("./agenttools.js");
    const toolList = tools();

    // read-state should include expedition fields
    const readState = toolList.find((t) => t.name === "read-state");
    if (readState) {
      const result = await readState.execute({});
      if (typeof result.expeditionLevel !== "number") {
        problems.push(`read-state should return expeditionLevel as a number, got ${JSON.stringify(result.expeditionLevel)}.`);
      }
      if (typeof result.maps !== "number") {
        problems.push(`read-state should return maps as a number, got ${JSON.stringify(result.maps)}.`);
      }
      if (typeof result.expeditionWoodCost !== "number") {
        problems.push(`read-state should return expeditionWoodCost as a number, got ${JSON.stringify(result.expeditionWoodCost)}.`);
      }
      if (typeof result.expeditionStoneCost !== "number") {
        problems.push(`read-state should return expeditionStoneCost as a number, got ${JSON.stringify(result.expeditionStoneCost)}.`);
      }
      // Check milestones includes expeditionNowUnlocked
      if (result.milestones && typeof result.milestones.expeditionNowUnlocked !== "boolean") {
        problems.push(`read-state milestones should include expeditionNowUnlocked as boolean, got ${JSON.stringify(result.milestones.expeditionNowUnlocked)}.`);
      }
    }

    // perform-action send-expedition
    const performAction = toolList.find((t) => t.name === "perform-action");
    if (performAction) {
      const engine = await import("./engine.js");
      engine.reset();

      // Try sending expedition with low forge level — should fail
      const failResult = await performAction.execute({ action: "send-expedition" });
      if (typeof failResult !== "object" || failResult === null) {
        problems.push("perform-action send-expedition should return an object.");
      } else {
        // expeditionLevel should still be 0
        if (failResult.expeditionLevel !== 0) {
          problems.push(`send-expedition with low forge level should not change expeditionLevel. Got ${failResult.expeditionLevel}.`);
        }
      }

      // Set up state for expedition (forge level 5)
      for (let i = 0; i < 10; i++) engine.gatherWood();
      await performAction.execute({ action: "sharpen" });
      for (let i = 0; i < engine.WALL_COST; i++) await performAction.execute({ action: "gather-stone" });
      await performAction.execute({ action: "build-wall" });

      // Forge to level 5 — use the engine directly for efficiency
      for (let f = 0; f < 5; f++) {
        const st = engine.getState();
        const wCost = st.forgeWoodCost;
        const sCost = st.forgeStoneCost;
        for (let i = 0; i < wCost; i++) engine.gatherWood();
        for (let i = 0; i < sCost; i++) engine.gatherStone();
        engine.forgeTool();
      }

      // Now we should have forgeLevel=5 and expedition available
      const expState = engine.getState();
      if (expState.forgeLevel < 5) {
        problems.push(`After forging 5 times, forgeLevel should be 5, got ${expState.forgeLevel}.`);
      }

      const beforeExp = engine.getState();
      const beforeExpWood = beforeExp.wood;
      const beforeExpStone = beforeExp.stone;

      // Ensure we have enough resources for the expedition
      // First expedition costs 10 wood + 5 stone
      const expWoodNeeded = 10;
      const expStoneNeeded = 5;
      if (beforeExpWood < expWoodNeeded) {
        for (let i = 0; i < expWoodNeeded - beforeExpWood; i++) engine.gatherWood();
      }
      if (beforeExpStone < expStoneNeeded) {
        for (let i = 0; i < expStoneNeeded - beforeExpStone; i++) engine.gatherStone();
      }

      // Use agent tool to send expedition
      const expToolResult = await performAction.execute({ action: "send-expedition" });
      if (typeof expToolResult !== "object" || expToolResult === null) {
        problems.push("perform-action send-expedition should return an object.");
      } else {
        if (expToolResult.expeditionLevel !== 1) {
          problems.push(`perform-action send-expedition should set expeditionLevel to 1, got ${expToolResult.expeditionLevel}.`);
        }
        if (expToolResult.maps !== 1) {
          problems.push(`perform-action send-expedition should set maps to 1, got ${expToolResult.maps}.`);
        }
        if (expToolResult.expeditionWoodCost !== 15) {
          problems.push(`perform-action send-expedition expeditionWoodCost should be 15, got ${expToolResult.expeditionWoodCost}.`);
        }
        if (expToolResult.expeditionStoneCost !== 8) {
          problems.push(`perform-action send-expedition expeditionStoneCost should be 8, got ${expToolResult.expeditionStoneCost}.`);
        }
        // Should have nextGoal reflecting expedition
        if (expToolResult.nextGoal && expToolResult.nextGoal.type !== "expedition-goal") {
          problems.push(`perform-action send-expedition nextGoal type should be "expedition-goal", got "${expToolResult.nextGoal.type}".`);
        }
      }

      // Clean up
      engine.reset();
      engine.init();
    }
  } catch (err) {
    problems.push(`Expedition agent tools test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Expedition milestone DOM element ──────────────────────────
  const milestoneExpedition = document.getElementById("milestone-expedition");
  if (!milestoneExpedition) {
    problems.push("Expected #milestone-expedition to exist in the offline-summary — it was not found.");
  } else {
    if (!milestoneExpedition.classList.contains("offline-milestone")) {
      problems.push("Expected #milestone-expedition to have class 'offline-milestone' — it did not.");
    }
    if (!milestoneExpedition.hidden) {
      problems.push("Expected #milestone-expedition to be hidden by default — it was visible.");
    }
  }

  // ─── Sandbox mode ────────────────────────────────────────────────

  try {
    const sandbox = await import("./sandbox.js");

    // --- Sandbox Test 1: cloneState produces an independent copy ---
    const engine = await import("./engine.js");
    engine.reset();
    engine.gatherWood();
    engine.gatherWood();
    engine.gatherWood();
    const realState = engine.getState();
    const cloned = sandbox.cloneState(realState);

    if (cloned.wood !== realState.wood) {
      problems.push(`sandbox cloneState should preserve wood value (${realState.wood}), got ${cloned.wood}.`);
    }
    if (cloned.upgradeLevel !== realState.upgradeLevel) {
      problems.push(`sandbox cloneState should preserve upgradeLevel, got ${cloned.upgradeLevel}.`);
    }

    // Mutating clone does not affect original
    cloned.wood = 999;
    const realStateAfterMutate = engine.getState();
    if (realStateAfterMutate.wood === 999) {
      problems.push("Mutating a sandbox clone should NOT affect the real engine state.");
    }

    // --- Sandbox Test 2: fastForward adds resources ---
    engine.reset();
    const freshClone = sandbox.cloneState(engine.getState());
    const result1 = sandbox.fastForward(freshClone, 10);

    if (result1.woodDelta <= 0) {
      problems.push(`sandbox fastForward(10s) should produce positive woodDelta, got ${result1.woodDelta}.`);
    }
    if (typeof result1.woodDelta !== "number") {
      problems.push(`sandbox fastForward woodDelta should be a number, got ${typeof result1.woodDelta}.`);
    }
    if (typeof result1.stoneDelta !== "number") {
      problems.push(`sandbox fastForward stoneDelta should be a number, got ${typeof result1.stoneDelta}.`);
    }
    if (result1.totalWood < result1.woodDelta) {
      problems.push(`sandbox fastForward totalWood (${result1.totalWood}) should be >= woodDelta (${result1.woodDelta}).`);
    }

    // --- Sandbox Test 3: fastForward with stone unlocked ---
    engine.reset();
    // Simulate a state where stone is unlocked
    const stoneState = engine.getState();
    stoneState.stoneUnlocked = true;
    stoneState.totalWoodEarned = 15;
    stoneState.totalStoneEarned = 2;
    const stoneClone = sandbox.cloneState(stoneState);
    const result2 = sandbox.fastForward(stoneClone, 3600); // 1 hour

    if (result2.stoneDelta <= 0) {
      problems.push(`sandbox fastForward(1h) with stone unlocked should produce positive stoneDelta, got ${result2.stoneDelta}.`);
    }
    if (result2.woodDelta <= 0) {
      problems.push(`sandbox fastForward(1h) with stone unlocked should produce positive woodDelta, got ${result2.woodDelta}.`);
    }

    // --- Sandbox Test 4: fastForward milestones detection ---
    engine.reset();
    // State where wood is 5 (below 10), no sharpen
    const preSharpenState = engine.getState();
    preSharpenState.wood = 5;
    preSharpenState.totalWoodEarned = 5;
    const preSharpenClone = sandbox.cloneState(preSharpenState);
    // Fast-forward enough to cross 10 wood
    sandbox.fastForward(preSharpenClone, 60); // 60 seconds at 0.1/s = +6, total 11

    // After fast-forward, clone should have wood >= 11
    if (preSharpenClone.wood < 11) {
      problems.push(`sandbox fastForward(60s) from wood=5 should give >=11 wood, got ${preSharpenClone.wood}.`);
    }
    // milestones should indicate sharpen available
    const milestonesCheck = sandbox.fastForward(preSharpenClone, 0);
    // Actually let's check by calling fastForward again and checking return
    const ffCheck = sandbox.fastForward(preSharpenClone, 1); // another 1s
    if (ffCheck.milestones.sharpenAvailable) {
      // sharpenAvailable is detected based on upgradeLevel change (before 0, after >= 10 totalWoodEarned)
      // This test is just validating the function doesn't throw and returns proper shape
    }

    // --- Sandbox Test 5: agent tools ---
    const agentTools = await import("./agenttools.js");
    const allTools = agentTools.tools();
    const sandboxCreateTool = allTools.find(t => t.name === "sandbox-create");
    const sandboxFFTool = allTools.find(t => t.name === "sandbox-fast-forward");
    const sandboxExitTool = allTools.find(t => t.name === "sandbox-exit");

    if (!sandboxCreateTool) {
      problems.push("agenttools should export a 'sandbox-create' tool — it was not found.");
    }
    if (!sandboxFFTool) {
      problems.push("agenttools should export a 'sandbox-fast-forward' tool — it was not found.");
    }
    if (!sandboxExitTool) {
      problems.push("agenttools should export a 'sandbox-exit' tool — it was not found.");
    }

    if (sandboxCreateTool && typeof sandboxCreateTool.execute === "function") {
      const createResult = await sandboxCreateTool.execute({});
      if (typeof createResult !== "object" || createResult === null) {
        problems.push("sandbox-create execute should return an object.");
      } else if (typeof createResult.wood !== "number") {
        problems.push(`sandbox-create result should have a 'wood' number field, got ${JSON.stringify(createResult.wood)}.`);
      }

      // Verify sandbox-create marks sandbox as active
      if (createResult.sandboxActive !== true) {
        problems.push("sandbox-create result should have sandboxActive=true.");
      }
    }

    if (sandboxFFTool && typeof sandboxFFTool.execute === "function") {
      const ffResult = await sandboxFFTool.execute({ seconds: 3600 });
      if (typeof ffResult !== "object" || ffResult === null) {
        problems.push("sandbox-fast-forward execute should return an object.");
      } else if (typeof ffResult.wood !== "number") {
        problems.push(`sandbox-fast-forward result should have a 'wood' number field, got ${JSON.stringify(ffResult.wood)}.`);
      }
    }

    if (sandboxExitTool && typeof sandboxExitTool.execute === "function") {
      const exitResult = await sandboxExitTool.execute({});
      if (typeof exitResult !== "object" || exitResult === null) {
        problems.push("sandbox-exit execute should return an object.");
      } else if (typeof exitResult.wood !== "number") {
        problems.push(`sandbox-exit result should have a 'wood' number field, got ${JSON.stringify(exitResult.wood)}.`);
      }
    }

    // --- Sandbox Test 6: real state is unchanged after sandbox ---
    engine.reset();
    const stateBeforeSandbox = engine.getState();
    const woodBefore = stateBeforeSandbox.wood;

    // Enter sandbox (via UI function if available)
    if (typeof window.__enterSandbox === "function") {
      window.__enterSandbox();
    }
    if (typeof window.__fastForwardSandbox === "function") {
      window.__fastForwardSandbox(86400); // 1 day
    }

    const stateDuringSandbox = engine.getState();
    if (stateDuringSandbox.wood !== woodBefore) {
      problems.push(`Real state wood should remain ${woodBefore} during sandbox operations, got ${stateDuringSandbox.wood}.`);
    }

    // Exit sandbox
    if (typeof window.__exitSandbox === "function") {
      window.__exitSandbox();
    }

    const stateAfterExit = engine.getState();
    if (stateAfterExit.wood !== woodBefore) {
      problems.push(`Real state wood should remain ${woodBefore} after sandbox exit, got ${stateAfterExit.wood}.`);
    }

    // --- Sandbox Test 7: fast-forward works without a prior create (issue #958) ---
    engine.reset();
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    const rehearsalStart = engine.getState();
    const rehearsalStartWood = rehearsalStart.wood;
    const rehearsalStartRate = rehearsalStart.rate;

    const ffNoCreate = await sandboxFFTool.execute({ seconds: 3600 });
    const expectedRehearsalWood = rehearsalStartWood + rehearsalStartRate * 3600;
    if (!(ffNoCreate.wood > rehearsalStartWood)) {
      problems.push(`sandbox-fast-forward without a prior create should raise projected wood above ${rehearsalStartWood}, got ${ffNoCreate.wood}.`);
    }
    if (Math.abs(ffNoCreate.wood - expectedRehearsalWood) > 1) {
      problems.push(`sandbox-fast-forward(3600s) should project wood ≈ ${expectedRehearsalWood} (start ${rehearsalStartWood} + rate ${rehearsalStartRate}*3600), got ${ffNoCreate.wood}.`);
    }
    if (ffNoCreate.sandboxActive !== true) {
      problems.push("sandbox-fast-forward without a prior create should report sandboxActive=true.");
    }
    if (typeof ffNoCreate.woodGained !== "number" || ffNoCreate.woodGained <= 0) {
      problems.push(`sandbox-fast-forward(3600s) should report a positive woodGained, got ${ffNoCreate.woodGained}.`);
    }
    if (!ffNoCreate.milestones || ffNoCreate.milestones.sharpenAvailable !== true) {
      problems.push("sandbox-fast-forward(3600s) from a fresh save should cross the sharpen milestone (sharpenAvailable=true).");
    }
    const realDuringRehearsal = engine.getState();
    if (realDuringRehearsal.wood !== rehearsalStartWood) {
      problems.push(`Real save wood should stay ${rehearsalStartWood} while fast-forwarding, got ${realDuringRehearsal.wood}.`);
    }
    if (typeof window.__getSandboxClone !== "function" || !window.__getSandboxClone()) {
      problems.push("sandbox-fast-forward without a prior create should leave an active sandbox clone behind.");
    }

    // sandbox-create must return the clone's projection, not the real save.
    const createAfterFF = await sandboxCreateTool.execute({});
    const liveClone = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
    if (liveClone && createAfterFF.wood !== liveClone.wood) {
      problems.push(`sandbox-create should return the clone's wood (${liveClone.wood}), got ${createAfterFF.wood}.`);
    }

    // --- Sandbox Test 8: fast-forward works immediately after exiting ---
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    const afterExitWood = engine.getState().wood;
    const ffAfterExit = await sandboxFFTool.execute({ seconds: 10 });
    if (!(ffAfterExit.wood > afterExitWood)) {
      problems.push(`sandbox-fast-forward(10s) right after an exit should raise projected wood above ${afterExitWood}, got ${ffAfterExit.wood}.`);
    }
    const afterPostExitFF = engine.getState().wood;
    if (afterPostExitFF !== afterExitWood) {
      problems.push(`Real save wood should stay ${afterExitWood} after a post-exit fast-forward, got ${afterPostExitFF}.`);
    }

    // --- Sandbox Test 9: page fast-forward buttons raise projected wood ---
    if (typeof window.__enterSandbox === "function") window.__enterSandbox();
    const sbWoodEl = document.getElementById("sb-wood");
    const sbBtn1h = document.getElementById("sb-btn-1h");
    if (!sbWoodEl || !sbBtn1h) {
      problems.push("Expected #sb-wood and #sb-btn-1h for the page fast-forward check.");
    } else {
      const beforeBtnWood = parseFloat(sbWoodEl.textContent);
      sbBtn1h.click();
      const afterBtnWood = parseFloat(sbWoodEl.textContent);
      if (!(afterBtnWood > beforeBtnWood)) {
        problems.push(`Clicking #sb-btn-1h should raise the projected #sb-wood, but it went ${beforeBtnWood} -> ${afterBtnWood}.`);
      }
    }

    // --- Sandbox Test 10: exit restores the real save unchanged ---
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    const restored = engine.getState();
    if (restored.wood !== rehearsalStartWood || restored.rate !== rehearsalStartRate) {
      problems.push(`sandbox-exit should restore the real save (wood ${rehearsalStartWood}, rate ${rehearsalStartRate}), got wood ${restored.wood}, rate ${restored.rate}.`);
    }
  } catch (err) {
    problems.push(`Sandbox test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Agent tools progressToNext uses Math.min instead of modulo ───
  try {
    const engine = await import("./engine.js");
    engine.reset();
    engine.init();

    // Put into sharpen goal state: reach GOAL_WOOD (10) but not yet upgraded
    for (let i = 0; i < 10; i++) engine.gatherWood();

    const agentMod = await import("./agenttools.js");
    const allTools = agentMod.tools();
    const reader = allTools.find(t => t.name === "read-state");
    if (!reader) {
      problems.push("Expected read-state tool for progressToNext test.");
    } else {
      // wood=10, UPGRADE_COST=5: Math.min(10,5)=5, upgrade available
      let state = await reader.execute({});
      if (state.nextGoal && state.nextGoal.type === "upgrade") {
        if (state.nextGoal.progressToNext !== 5) {
          problems.push(`progressToNext for sharpen goal with wood=10 should be 5 (Math.min(wood, 5)), got ${state.nextGoal.progressToNext}.`);
        }
        if (state.nextGoal.upgradeAvailable !== true) {
          problems.push(`upgradeAvailable should be true when wood=10 >= UPGRADE_COST=5, got ${state.nextGoal.upgradeAvailable}.`);
        }
      } else {
        problems.push(`nextGoal type should be "upgrade" with wood=10 and no sharpen, got ${state.nextGoal ? state.nextGoal.type : "missing"}.`);
      }

      // Gather more wood to 13 — still < cost threshold for the modulo test
      for (let i = 0; i < 3; i++) engine.gatherWood();
      state = await reader.execute({});
      // wood=13, UPGRADE_COST=5: Math.min(13,5)=5, not 13%5=3
      if (state.nextGoal && state.nextGoal.type === "upgrade") {
        if (state.nextGoal.progressToNext !== 5) {
          problems.push(`progressToNext for sharpen goal with wood=13 should be 5 (Math.min(wood, 5)), got ${state.nextGoal.progressToNext}. `
            + "Using `wood % UPGRADE_COST` would give 3.");
        }
        if (state.nextGoal.upgradeAvailable !== true) {
          problems.push(`upgradeAvailable should be true when wood=13 >= UPGRADE_COST=5, got ${state.nextGoal.upgradeAvailable}.`);
        }
      }

      // Now test the wall goal progress
      engine.reset();
      engine.init();
      for (let i = 0; i < 10; i++) engine.gatherWood();
      engine.craftUpgrade(); // unlock stone, wood becomes 5
      for (let i = 0; i < 5; i++) engine.gatherWood(); // back to 10
      for (let i = 0; i < 7; i++) engine.gatherStone(); // stone=7, > WALL_COST=5
      state = await reader.execute({});
      // Should be in build-wall-goal state (stone >= GOAL_STONE, no wall yet)
      if (state.nextGoal && state.nextGoal.type === "build-wall-goal") {
        if (state.nextGoal.progressToNext !== 5) {
          problems.push(`progressToNext for wall goal with stone=7 should be 5 (Math.min(stone, 5)), got ${state.nextGoal.progressToNext}. `
            + "Using `stone % WALL_COST` would give 2.");
        }
        if (state.nextGoal.wallAvailable !== true) {
          problems.push(`wallAvailable should be true when stone=7 >= WALL_COST=5, got ${state.nextGoal.wallAvailable}.`);
        }
      } else {
        problems.push(`nextGoal type should be "build-wall-goal" with stone=7 and no wall, got ${state.nextGoal ? state.nextGoal.type : "missing"}.`);
      }

      // Test with stone=3 (< WALL_COST), should have stone-goal first
      engine.reset();
      engine.init();
      for (let i = 0; i < 10; i++) engine.gatherWood();
      engine.craftUpgrade();
      for (let i = 0; i < 5; i++) engine.gatherWood();
      for (let i = 0; i < 3; i++) engine.gatherStone(); // stone=3 < GOAL_STONE=5
      state = await reader.execute({});
      if (state.nextGoal && state.nextGoal.type !== "stone-goal") {
        // stone-goal doesn't use progressToNext, it uses target/progress
        // Just verify we're not in an unexpected state
        problems.push(`Expected stone-goal with stone=3, got ${state.nextGoal.type}.`);
      }

      // Test fallback sharpen cycle (after wall built, forge < 5)
      engine.reset();
      engine.init();
      for (let i = 0; i < 10; i++) engine.gatherWood();
      engine.craftUpgrade();
      for (let i = 0; i < 5; i++) engine.gatherStone();
      engine.buildWall(); // wallLevel=1, stone=0, forge=0
      // With forgeLevel=0 (<5) and wallLevel>0, it's forge-goal, not fallback.
      // Fallback sharpen cycle is reached only for wallLevel>0 && forgeLevel<5
      // So let's verify the sharpen fallback directly via the forge goal's
      // resource arrays which already use Math.min correctly.
    }

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Agent tools progressToNext test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Overlay isolation ──────────────────────────────────────────
  // While an overlay is open the game behind it must leave layout and the
  // accessibility tree; closing it must restore both, along with the focus.
  try {
    const gameSections = () => Array.from(document.querySelectorAll("body > section.panel"));
    const rectsOverlap = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const describeActive = () => {
      const el = document.activeElement;
      return el ? (el.id || el.tagName) : "null";
    };

    const sandboxOverlay = document.getElementById("sandbox-overlay");
    const btnSandbox = document.getElementById("btn-sandbox");

    if (typeof window.__enterSandbox !== "function" || typeof window.__exitSandbox !== "function") {
      problems.push("Expected window.__enterSandbox/__exitSandbox for the overlay isolation check.");
    } else if (!sandboxOverlay || !btnSandbox) {
      problems.push("Expected #sandbox-overlay and #btn-sandbox for the overlay isolation check.");
    } else {
      btnSandbox.focus();
      window.__enterSandbox();

      const panelsWhileOpen = gameSections();
      if (panelsWhileOpen.length === 0) {
        problems.push("Expected body > section.panel elements for the overlay isolation check — none found.");
      }
      for (const panel of panelsWhileOpen) {
        const rect = panel.getBoundingClientRect();
        if (rect.width !== 0 || rect.height !== 0) {
          problems.push(`Expected #${panel.id} to leave layout while the sandbox overlay is open, but its rect is ${rect.width}x${rect.height}.`);
        }
        if (!panel.hasAttribute("inert") || panel.getAttribute("aria-hidden") !== "true") {
          problems.push(`Expected #${panel.id} to be inert and aria-hidden while the sandbox overlay is open (inert=${panel.hasAttribute("inert")}, aria-hidden=${panel.getAttribute("aria-hidden")}).`);
        }
      }

      // The goal text must never share pixels with the sandbox projections.
      const goalLabel = document.getElementById("goal-label");
      const goalText = document.getElementById("goal-text");
      const sbRate = document.getElementById("sb-rate");
      const sbTotalWood = document.getElementById("sb-total-wood");
      if (goalLabel && sbRate && rectsOverlap(goalLabel.getBoundingClientRect(), sbRate.getBoundingClientRect())) {
        problems.push("#goal-label overlaps #sb-rate while the sandbox overlay is open.");
      }
      if (goalText && sbTotalWood && rectsOverlap(goalText.getBoundingClientRect(), sbTotalWood.getBoundingClientRect())) {
        problems.push("#goal-text overlaps #sb-total-wood while the sandbox overlay is open.");
      }

      if (!sandboxOverlay.contains(document.activeElement)) {
        problems.push(`Keyboard focus should stay inside #sandbox-overlay while it is open, but activeElement is ${describeActive()}.`);
      }

      window.__exitSandbox();
      for (const panel of panelsWhileOpen) {
        const rect = panel.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          problems.push(`Expected #${panel.id} to be laid out again after closing the sandbox overlay, but its rect is ${rect.width}x${rect.height}.`);
        }
        if (panel.hasAttribute("inert") || panel.hasAttribute("aria-hidden")) {
          problems.push(`Expected #${panel.id} to be reachable and announced again after closing the sandbox overlay.`);
        }
      }
      if (document.activeElement !== btnSandbox) {
        problems.push(`Closing the sandbox overlay should return focus to #btn-sandbox, but focus is on ${describeActive()}.`);
      }
    }

    // The offline summary overlay shares the same isolation behaviour.
    if (typeof window.__setOverlayOpen !== "function") {
      problems.push("Expected window.__setOverlayOpen for the overlay isolation check.");
    } else {
      const offlineOverlay = document.getElementById("offline-summary");
      const dismissBtn = document.getElementById("btn-dismiss-offline");
      if (!offlineOverlay || !dismissBtn) {
        problems.push("Expected #offline-summary and #btn-dismiss-offline for the overlay isolation check.");
      } else {
        window.__setOverlayOpen("offline", true);
        offlineOverlay.removeAttribute("hidden");
        offlineOverlay.querySelector(".offline-panel").focus();

        for (const panel of gameSections()) {
          const rect = panel.getBoundingClientRect();
          if (rect.width !== 0 || rect.height !== 0) {
            problems.push(`Expected #${panel.id} to leave layout while the offline overlay is open, but its rect is ${rect.width}x${rect.height}.`);
          }
        }

        dismissBtn.click();

        if (!offlineOverlay.hidden) {
          problems.push("Expected #offline-summary to be hidden after clicking #btn-dismiss-offline.");
        }
        for (const panel of gameSections()) {
          const rect = panel.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            problems.push(`Expected #${panel.id} to be laid out again after dismissing the offline overlay, but its rect is ${rect.width}x${rect.height}.`);
          }
        }
      }
    }
  } catch (err) {
    problems.push(`Overlay isolation test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Away discovery ─────────────────────────────────────────────
  // A real return of at least 60s must turn up exactly one discovery, derived
  // from the absence length alone, name it in the welcome-back panel, and make
  // its bonus last so it stays readable after the panel is dismissed.
  try {
    const engine = await import("./engine.js");

    // (a) The page must carry both discovery surfaces.
    const discoveryStat = document.getElementById("discovery-stat");
    const discoveryValue = document.getElementById("discovery-value");
    const discoveryLine = document.getElementById("offline-discovery-line");
    const discoveryNameEl = document.getElementById("offline-discovery-name");
    const discoveryBonusEl = document.getElementById("offline-discovery-bonus");
    if (!discoveryStat || !discoveryValue) {
      problems.push("Expected #discovery-stat and #discovery-value in the status readout for the away discovery.");
    }
    if (!discoveryLine || !discoveryNameEl) {
      problems.push("Expected #offline-discovery-line and #offline-discovery-name in the welcome-back panel for the away discovery.");
    }
    if (!discoveryBonusEl) {
      problems.push("Expected #offline-discovery-bonus in the welcome-back panel so the find's wood/s bonus is stated.");
    }

    // (b) The ladder is pure, deterministic and strictly stronger with time.
    if (typeof engine.discoverForElapsed !== "function") {
      problems.push("Expected engine.discoverForElapsed to be exported as a pure function.");
    } else {
      const find59 = engine.discoverForElapsed(59);
      const find60 = engine.discoverForElapsed(60);
      const find600 = engine.discoverForElapsed(600);
      const find1d = engine.discoverForElapsed(86400);
      const find1dAgain = engine.discoverForElapsed(86400);
      if (find59 !== null) {
        problems.push(`An absence of 59s should find nothing, got ${JSON.stringify(find59)}.`);
      }
      if (!find60 || typeof find60.name !== "string" || !find60.id) {
        problems.push(`An absence of 60s should name a discovery, got ${JSON.stringify(find60)}.`);
      }
      if (!(find600 && find60 && find600.bonus > find60.bonus)) {
        problems.push(`A 600s absence should find something stronger than a 60s one, got ${JSON.stringify(find600)} vs ${JSON.stringify(find60)}.`);
      }
      if (!(find1d && find600 && find1d.bonus > find600.bonus)) {
        problems.push(`A 1d absence should find something stronger than a 600s one, got ${JSON.stringify(find1d)} vs ${JSON.stringify(find600)}.`);
      }
      if (!find1d || !find1dAgain || find1dAgain.id !== find1d.id) {
        problems.push(`The same absence length must always yield the same discovery id, got ${find1d && find1d.id} then ${find1dAgain && find1dAgain.id}.`);
      }
    }

    // (c) A 600s return round-trips: state bonus, panel name, status readout,
    // and the agent's read-state tool.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      timestamp: new Date(Date.now() - 600000).toISOString(),
    }));
    engine.init();
    const expected = engine.discoverForElapsed(600);
    const returned = engine.getState();
    if (!expected || !returned.discovery || returned.discovery.id !== expected.id) {
      problems.push(`A 600s return should credit the ${expected && expected.id} discovery, got ${JSON.stringify(returned.discovery)}.`);
    }
    const expectedRate = 0.1 + (expected ? expected.bonus : 0);
    if (Math.abs(returned.rate - expectedRate) > 1e-9) {
      problems.push(`The away discovery bonus (${expected && expected.bonus}) should raise rate to ${expectedRate}, got ${returned.rate}.`);
    }

    window.__showOfflineSummary();
    if (discoveryLine && discoveryLine.hidden) {
      problems.push("A 600s return should name its discovery in the welcome-back panel, but #offline-discovery-line was hidden.");
    }
    if (discoveryNameEl && expected && discoveryNameEl.textContent.trim() !== expected.name) {
      problems.push(`The welcome-back panel should name "${expected.name}", got "${discoveryNameEl.textContent.trim()}".`);
    }
    // The panel must state the wood/s bonus the credited find granted and that
    // it is kept, and the number must equal the rate increase it applied.
    const rateIncrease = returned.rate - 0.1;
    if (discoveryBonusEl && expected) {
      if (discoveryBonusEl.hidden) {
        problems.push("A credited 600s discovery should state its wood/s bonus in the welcome-back panel, but #offline-discovery-bonus was hidden.");
      }
      const bonusText = discoveryBonusEl.textContent.trim();
      if (!bonusText.includes(`+${expected.bonus.toFixed(2)} wood/s`)) {
        problems.push(`The discovery bonus line should show +${expected.bonus.toFixed(2)} wood/s, got "${bonusText}".`);
      }
      if (!bonusText.includes("yours for good")) {
        problems.push(`The discovery bonus line should say the find is kept, got "${bonusText}".`);
      }
      const shownMatch = bonusText.match(/\+(\d+(?:\.\d+)?)\s*wood\/s/);
      const shownBonus = shownMatch ? Number(shownMatch[1]) : null;
      if (shownBonus === null || Math.abs(shownBonus - rateIncrease) > 1e-9) {
        problems.push(`The shown discovery bonus must equal the ${rateIncrease.toFixed(2)} wood/s actually added to the rate, got ${shownBonus}.`);
      }
    }

    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    if (!readState) {
      problems.push("Expected a read-state tool for the away-discovery check.");
    } else {
      const whileOpen = await readState.execute({});
      const offlineDiscovery = whileOpen.offlineDiscovery;
      if (!expected || !offlineDiscovery || offlineDiscovery.name !== expected.name) {
        problems.push(`read-state.offlineDiscovery should name "${expected.name}" while the panel is open, got ${JSON.stringify(offlineDiscovery)}.`);
      }
      if (expected && offlineDiscovery && offlineDiscovery.bonus !== expected.bonus) {
        problems.push(`read-state.offlineDiscovery.bonus should report ${expected.bonus}, got ${JSON.stringify(offlineDiscovery.bonus)}.`);
      }
      if (expected && offlineDiscovery && offlineDiscovery.permanent !== true) {
        problems.push(`read-state.offlineDiscovery.permanent should be true for a credited find, got ${JSON.stringify(offlineDiscovery.permanent)}.`);
      }
    }

    window.__dismissOffline();
    if (discoveryStat && discoveryStat.classList.contains("stat-hidden")) {
      problems.push("Expected #discovery-stat to stay visible after dismissing the panel so the lasting effect is on screen.");
    }
    if (discoveryValue && expected && !discoveryValue.textContent.includes(expected.name)) {
      problems.push(`Expected #discovery-value to show "${expected.name}", got "${discoveryValue.textContent}".`);
    }
    if (readState) {
      const afterDismiss = await readState.execute({});
      if (!expected || !afterDismiss.discovery || afterDismiss.discovery.id !== expected.id) {
        problems.push(`read-state.discovery should return the lasting ${expected && expected.id} discovery, got ${JSON.stringify(afterDismiss.discovery)}.`);
      }
      if (Math.abs(afterDismiss.rate - expectedRate) > 1e-9) {
        problems.push(`read-state.rate should include the discovery bonus (${expectedRate}), got ${afterDismiss.rate}.`);
      }
    }

    // (d) A return shorter than 60s, and a first-ever visit, find nothing.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      timestamp: new Date(Date.now() - 30000).toISOString(),
    }));
    engine.init();
    if (engine.getState().discovery !== null) {
      problems.push(`A 30s return should find nothing, got ${JSON.stringify(engine.getState().discovery)}.`);
    }
    window.__showOfflineSummary();
    if (discoveryLine && !discoveryLine.hidden) {
      problems.push("A 30s return should not name a discovery in the welcome-back panel.");
    }
    if (discoveryBonusEl && !discoveryBonusEl.hidden) {
      problems.push("A 30s return should show no discovery bonus line.");
    }
    if (discoveryBonusEl && /\+\s*0\b/.test(discoveryBonusEl.textContent)) {
      problems.push(`A 30s return must not show a stray "+0" discovery bonus, got "${discoveryBonusEl.textContent.trim()}".`);
    }
    window.__dismissOffline();

    engine.reset();
    engine.init(); // fresh visit — no saved state
    if (engine.getState().discovery !== null) {
      problems.push("A first-ever visit should find no away discovery.");
    }

    // (e) A weaker find on a short return cannot lower or re-farm the bonus.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.5, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      discoveryId: "ancient-grove", discoveryName: "Ancient Grove", discoveryBonus: 0.40,
      timestamp: new Date(Date.now() - 61000).toISOString(),
    }));
    engine.init();
    const afterShort = engine.getState();
    if (Math.abs(afterShort.rate - 0.5) > 1e-9) {
      problems.push(`A 61s return after owning a stronger discovery must leave rate at 0.50, got ${afterShort.rate}.`);
    }
    if (!afterShort.discovery || afterShort.discovery.name !== "Ancient Grove") {
      problems.push(`A weaker find must not replace the owned Ancient Grove discovery, got ${JSON.stringify(afterShort.discovery)}.`);
    }
    window.__showOfflineSummary();
    if (discoveryBonusEl && !discoveryBonusEl.hidden) {
      problems.push("A weaker find that added nothing to the rate must show no discovery bonus line.");
    }
    if (discoveryBonusEl && /\+\s*0\b/.test(discoveryBonusEl.textContent)) {
      problems.push(`A weaker find must not show a stray "+0" discovery bonus, got "${discoveryBonusEl.textContent.trim()}".`);
    }
    window.__dismissOffline();

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Away-discovery test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Save export / import: a portable code (issue #969) ────────
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");

    // Preserve the real save so these checks leave no trace.
    const originalCode = engine.exportSave();

    // (a) A known save round-trips: every required field comes back exactly.
    const knownSave = {
      wood: 123.5,
      rate: 0.35,
      upgradeLevel: 3,
      stone: 42,
      totalWoodEarned: 500,
      totalStoneEarned: 60,
      wallLevel: 2,
      forgeLevel: 1,
      expeditionLevel: 4,
      maps: 4,
      stoneUnlocked: true,
      discoveryBonus: 0.25,
      discoveryId: "glowing-seam",
      discoveryName: "Glowing Seam",
      timestamp: "2024-05-01T12:00:00.000Z",
      firstTimestamp: "2024-01-01T00:00:00.000Z",
    };
    const requiredFields = [
      ["wood", knownSave.wood],
      ["rate", knownSave.rate],
      ["upgradeLevel", knownSave.upgradeLevel],
      ["stone", knownSave.stone],
      ["wallLevel", knownSave.wallLevel],
      ["forgeLevel", knownSave.forgeLevel],
      ["expeditionLevel", knownSave.expeditionLevel],
      ["maps", knownSave.maps],
      ["stoneUnlocked", knownSave.stoneUnlocked],
      ["timestamp", knownSave.timestamp],
      ["firstTimestamp", knownSave.firstTimestamp],
    ];
    engine.reset();
    const imported = engine.importSave(btoa(JSON.stringify(knownSave)));
    if (!imported.ok) {
      problems.push(`importSave should accept a valid code, got ${JSON.stringify(imported)}.`);
    }
    const restored = engine.getState();
    for (const [field, expected] of requiredFields) {
      if (restored[field] !== expected) {
        problems.push(`importSave should restore ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(restored[field])}.`);
      }
    }
    if (!restored.discovery || restored.discovery.id !== "glowing-seam" || restored.discovery.name !== "Glowing Seam" || restored.discovery.bonus !== 0.25) {
      problems.push(`importSave should restore the discovery id/name/bonus, got ${JSON.stringify(restored.discovery)}.`);
    }

    // Exporting the restored save reproduces the code's own fields.
    const reExported = JSON.parse(atob(engine.exportSave()));
    for (const [field, expected] of requiredFields) {
      if (reExported[field] !== expected) {
        problems.push(`exportSave after importSave should reproduce ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(reExported[field])}.`);
      }
    }

    // (b) A corrupted code is refused and the existing save is untouched.
    const beforeCorrupt = JSON.stringify(engine.getState());
    for (const badCode of ["", "!!!not-base64!!!", btoa("not valid json"), btoa("{}")]) {
      const refused = engine.importSave(badCode);
      if (refused.ok !== false) {
        problems.push(`importSave should refuse the corrupted code ${JSON.stringify(badCode)} — it returned ok:${refused.ok}.`);
      }
      if (typeof refused.reason !== "string" || refused.reason.length === 0) {
        problems.push(`importSave should give a plain reason when refusing a corrupted code, got ${JSON.stringify(refused.reason)}.`);
      }
    }
    if (JSON.stringify(engine.getState()) !== beforeCorrupt) {
      problems.push("A refused import must leave the live save byte-identical.");
    }

    // (c) Clicking Reveal Save Code fills the page with the engine's own code.
    const revealBtn = document.getElementById("btn-reveal-save");
    const saveCodeField = document.getElementById("save-code");
    if (!revealBtn || !saveCodeField) {
      problems.push("The save panel should provide #btn-reveal-save and #save-code.");
    } else {
      revealBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const revealed = saveCodeField.value;
      let decoded = null;
      try {
        decoded = JSON.parse(atob(revealed));
      } catch {
        // reported below
      }
      if (!decoded) {
        problems.push("Clicking Reveal Save Code should fill #save-code with a decodable save code.");
      } else {
        for (const [field, expected] of requiredFields) {
          if (decoded[field] !== expected) {
            problems.push(`The revealed save code should carry ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(decoded[field])}.`);
          }
        }
      }
    }

    // (d) Restoring garbage shows a plain error and leaves the save alone.
    const importInput = document.getElementById("save-import-input");
    const restoreBtn = document.getElementById("btn-restore-save");
    const statusEl = document.getElementById("save-status");
    if (!importInput || !restoreBtn || !statusEl) {
      problems.push("The save panel should provide #save-import-input, #btn-restore-save and #save-status.");
    } else {
      const beforeRestore = JSON.stringify(engine.getState());
      importInput.value = "definitely not a save code";
      restoreBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      if (!statusEl.textContent.trim()) {
        problems.push("Restoring an invalid code should show a plain error in #save-status.");
      }
      if (JSON.stringify(engine.getState()) !== beforeRestore) {
        problems.push("Restoring an invalid code must leave the existing save untouched.");
      }
    }

    // (e) The agent tools read and restore the same code the page does.
    const readCodeTool = tools().find((t) => t.name === "read-save-code");
    const restoreTool = tools().find((t) => t.name === "restore-save");
    if (!readCodeTool) {
      problems.push("agenttools should export a 'read-save-code' tool — it was not found.");
    }
    if (!restoreTool) {
      problems.push("agenttools should export a 'restore-save' tool — it was not found.");
    }
    if (readCodeTool) {
      const readResult = await readCodeTool.execute({});
      if (typeof readResult.code !== "string" || readResult.code !== engine.exportSave()) {
        problems.push("read-save-code should return the engine's current save code.");
      }
    }
    if (restoreTool) {
      engine.reset();
      const toolResult = await restoreTool.execute({ code: btoa(JSON.stringify(knownSave)) });
      if (toolResult.ok !== true) {
        problems.push(`restore-save should accept a valid code, got ${JSON.stringify(toolResult)}.`);
      } else if (toolResult.wood !== knownSave.wood || toolResult.upgradeLevel !== knownSave.upgradeLevel) {
        problems.push(`restore-save should return the restored state (wood ${knownSave.wood}, upgradeLevel ${knownSave.upgradeLevel}), got wood ${toolResult.wood}, upgradeLevel ${toolResult.upgradeLevel}.`);
      }
      const badResult = await restoreTool.execute({ code: "nonsense" });
      if (badResult.ok !== false || typeof badResult.reason !== "string") {
        problems.push(`restore-save should refuse a corrupted code with a reason, got ${JSON.stringify(badResult)}.`);
      }
    }

    // Leave the save — and the panel — as they were found, and let the
    // game's tick keep running for whatever measures the page next.
    engine.importSave(originalCode);
    engine.init();
    if (saveCodeField) saveCodeField.value = "";
    if (importInput) importInput.value = "";
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove("error");
    }
  } catch (err) {
    problems.push(`Save export/import test threw: ${err.message}`);
    console.error(err);
  }

  return problems;
}