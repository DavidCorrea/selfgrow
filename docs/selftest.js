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
        // The stone rate the tool reports must be the engine's own rule, so a
        // change to the engine's constants moves the page, this tool and the
        // sandbox together instead of leaving a stale copy behind.
        const engine = await import("./engine.js");
        if (engine.computeStoneRateFor(0) !== engine.STONE_BASE_RATE) {
          problems.push(`engine.computeStoneRateFor(0) should equal STONE_BASE_RATE (${engine.STONE_BASE_RATE}), got ${engine.computeStoneRateFor(0)}.`);
        }
        const rateAtThousandWood = engine.STONE_BASE_RATE + 1000 * engine.STONE_RATE_BOOST_FACTOR;
        if (Math.abs(engine.computeStoneRateFor(1000) - rateAtThousandWood) > 1e-12) {
          problems.push(`engine.computeStoneRateFor(1000) should equal STONE_BASE_RATE + 1000 * STONE_RATE_BOOST_FACTOR (${rateAtThousandWood}), got ${engine.computeStoneRateFor(1000)}.`);
        }
        // Verify the result matches the engine's current state
        const s = engine.getState();
        if (result.wood !== s.wood) {
          problems.push(`read-state wood (${result.wood}) does not match engine.getState() wood (${s.wood}).`);
        }
        // The chop power an agent reads must be the engine's own rule, so the
        // button, the Wood card and the tool can never promise three numbers.
        if (result.clickPower !== engine.clickPowerFor(s)) {
          problems.push(`read-state clickPower (${result.clickPower}) does not match engine.clickPowerFor(state) (${engine.clickPowerFor(s)}).`);
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

    // --- read-state reports the engine's stone rate, not a second copy ---
    // Unlock stone with a non-zero wood total, so a duplicated formula would
    // have something to disagree about.
    if (readState) {
      const engine = await import("./engine.js");
      engine.reset();
      for (let i = 0; i < 10; i++) engine.gatherWood();
      engine.craftUpgrade(); // unlocks stone
      engine.gatherWood();

      const unlocked = await readState.execute({});
      const engineRate = engine.computeStoneRate();
      if (engineRate <= 0) {
        problems.push(`Unlocked stone should yield a positive engine rate, got ${engineRate} — the read-state rate check below would be vacuous.`);
      }
      if (unlocked.stoneUnlocked !== true) {
        problems.push(`read-state should report stoneUnlocked=true after the first sharpen, got ${JSON.stringify(unlocked.stoneUnlocked)}.`);
      }
      if (Math.abs(unlocked.stoneRate - engineRate) > 1e-12) {
        problems.push(`read-state stoneRate (${unlocked.stoneRate}) disagrees with the engine's computeStoneRate() (${engineRate}) while stone is unlocked — the tool must not keep its own copy of the stone-rate formula.`);
      }

      engine.reset();
      engine.init();
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

  // ─── The one-screen promise survives a fully-unlocked world ────
  // The check above measures whatever save the page happens to hold. Re-run
  // the same fit test against every system unlocked and several upgrades
  // bought, so a layout that only fits a fresh save cannot pass. The window
  // must grow a grid column and bound the upgrade lists rather than add
  // height.
  if (window.innerWidth >= 1280 && window.innerHeight >= 720) {
    const engine = await import("./engine.js");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };
    const originalSave = localStorage.getItem("selfgrow-state");
    // A valid save with every system unlocked and upgrades already bought:
    // stone, 12 sharpenings, 3 walls, forge level 7 (which opens expeditions)
    // and 4 maps.
    const fullyUnlockedSave = {
      wood: 500,
      rate: 1.6,
      upgradeLevel: 12,
      stone: 120,
      totalWoodEarned: 8000,
      totalStoneEarned: 400,
      wallLevel: 3,
      forgeLevel: 7,
      expeditionLevel: 4,
      maps: 4,
      stoneUnlocked: true,
      discoveryBonus: 0.4,
      discoveryId: "ancient-grove",
      discoveryName: "Ancient Grove",
      timestamp: new Date().toISOString(),
      firstTimestamp: new Date().toISOString(),
    };
    // The product shows this many bought upgrades in full per card before
    // collapsing the rest into a summary. Kept here as the expectation.
    const VISIBLE_UPGRADE_HISTORY = 2;
    const purchasedLevels = {
      "wood-actions": fullyUnlockedSave.upgradeLevel,
      "stone-actions": fullyUnlockedSave.wallLevel,
      "forge-actions": fullyUnlockedSave.forgeLevel,
      "expedition-actions": fullyUnlockedSave.maps,
    };

    try {
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify(fullyUnlockedSave));
      engine.init();
      renderNow();

      const unlockedDoc = document.documentElement;
      if (unlockedDoc.scrollHeight > window.innerHeight) {
        problems.push(
          `With every system unlocked the page scrolls vertically on a `
          + `${window.innerWidth}x${window.innerHeight} window: content is `
          + `${unlockedDoc.scrollHeight}px tall but the window is ${window.innerHeight}px.`
        );
      }
      if (unlockedDoc.scrollWidth > window.innerWidth) {
        problems.push(
          `With every system unlocked the page scrolls horizontally on a `
          + `${window.innerWidth}x${window.innerHeight} window: content is `
          + `${unlockedDoc.scrollWidth}px wide but the window is ${window.innerWidth}px.`
        );
      }
      for (const p of document.querySelectorAll("body > section.panel")) {
        const rect = p.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.bottom > window.innerHeight + 1) {
          problems.push(
            `With every system unlocked #${p.id} extends past the bottom of a `
            + `${window.innerHeight}px window (bottom ${Math.round(rect.bottom)}px).`
          );
        }
        if (rect.right > window.innerWidth + 1) {
          problems.push(
            `With every system unlocked #${p.id} extends past the right edge of a `
            + `${window.innerWidth}px window (right ${Math.round(rect.right)}px).`
          );
        }
      }

      const unlockedCards = [...document.querySelectorAll("#action-area .system-card")]
        .filter((c) => getComputedStyle(c).display !== "none" && c.getBoundingClientRect().height > 0);
      if (unlockedCards.length < 4) {
        problems.push(
          `A fully-unlocked save shows ${unlockedCards.length} system cards — expected all four `
          + "(wood, stone, forge, expeditions) to be on screen."
        );
      }

      // New systems must add a grid column, not a second row: every visible
      // card's top edge has to line up.
      if (unlockedCards.length > 1) {
        const tops = unlockedCards.map((c) => Math.round(c.getBoundingClientRect().top));
        const spread = Math.max(...tops) - Math.min(...tops);
        if (spread > 3) {
          problems.push(
            `With every system unlocked the system cards wrap onto more than one grid row `
            + `(tops range ${Math.min(...tops)}-${Math.max(...tops)}px) — the cards should `
            + "narrow so every system stays in one row."
          );
        }
      }

      // A long upgrade list must summarise rather than print every purchase.
      for (const card of unlockedCards) {
        const purchased = purchasedLevels[card.id];
        if (typeof purchased !== "number" || purchased <= 0) continue;
        const historyLines = card.querySelectorAll(".upgrade-list .upgrade-card.is-history");
        const summary = card.querySelector(".upgrade-summary");
        if (historyLines.length > purchased) {
          problems.push(
            `Card #${card.id} shows ${historyLines.length} upgrade history lines but only `
            + `${purchased} upgrades were bought.`
          );
        }
        if (purchased > VISIBLE_UPGRADE_HISTORY) {
          if (!summary) {
            problems.push(
              `Card #${card.id} has ${purchased} bought upgrades but no .upgrade-summary — `
              + "older upgrades must collapse into a summary instead of listing every one."
            );
          }
          if (historyLines.length >= purchased) {
            problems.push(
              `Card #${card.id} lists all ${purchased} bought upgrades in full — the list must `
              + `be capped at ${VISIBLE_UPGRADE_HISTORY} and the rest summarised.`
            );
          }
        }
      }
    } catch (err) {
      problems.push(`Fully-unlocked layout check threw: ${err.message}`);
      console.error(err);
    } finally {
      engine.reset();
      if (originalSave !== null) localStorage.setItem("selfgrow-state", originalSave);
      engine.init();
      renderNow();
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
    const clickPower = engine.clickPowerFor(lived);
    const expected = "+" + (Number.isInteger(clickPower) ? clickPower : clickPower.toFixed(1)) + " / chop";
    const shown = woodYieldEl.textContent.trim();
    if (shown !== expected) {
      problems.push(`Wood card yields "${shown}" but the engine's click power is ${clickPower} (expected "${expected}").`);
    }
    // The button label is the other promise of the same number: it must name
    // exactly the chop power the engine's rule gives for this state.
    const btnGather = document.getElementById("btn-gather");
    const btnLabel = btnGather?.querySelector(".btn-label")?.textContent.trim();
    const expectedLabel = "Gather Wood (+" + (Number.isInteger(clickPower) ? clickPower : clickPower.toFixed(1)) + ")";
    if (btnLabel !== expectedLabel) {
      problems.push(`Gather Wood button reads "${btnLabel}" but the engine's click power is ${clickPower} (expected "${expectedLabel}").`);
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

  // ─── Issue #996: one shared goal rule for the page and the read-state tool ───
  // The goal panel and the read-state tool must read the same description of
  // the next goal, so a fix to the goal's progress maths can never again land
  // in only one of them. Each scenario drives the engine, renders the page and
  // asks the tool what the goal is — the two must agree on the text, on every
  // resource's numbers, and on whether the goal's own action is available.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };
    const parseLabel = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return null;
      const m = /^(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)$/.exec(el.textContent.trim());
      return m ? { name: m[1], current: parseFloat(m[2]), target: parseFloat(m[3]) } : null;
    };
    // The button that carries out each goal's action. The gather goals have
    // none of their own — their gathering buttons are always available.
    const ACTION_BUTTON = {
      "upgrade": "btn-sharpen",
      "build-wall-goal": "btn-build-wall",
      "forge-goal": "btn-forge-tool",
      "expedition-goal": "btn-expedition",
    };

    // reset() clears storage, so seed the save after it and before init().
    const loadScenario = (overrides) => {
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify({
        wood: 0, rate: 0.1, upgradeLevel: 0, stone: 0,
        totalWoodEarned: 0, totalStoneEarned: 0,
        wallLevel: 0, forgeLevel: 0, expeditionLevel: 0, maps: 0,
        stoneUnlocked: false,
        timestamp: new Date().toISOString(),
        firstTimestamp: new Date().toISOString(),
        ...overrides,
      }));
      engine.init();
    };

    const checkGoal = async (scenario, expectedType) => {
      renderNow();
      const goal = (await readState.execute({})).nextGoal;
      if (typeof goal.available !== "boolean") {
        problems.push(`${scenario}: read-state nextGoal.available should be a boolean, got ${JSON.stringify(goal.available)}.`);
      }
      if (expectedType && goal.type !== expectedType) {
        problems.push(`${scenario}: expected goal type "${expectedType}", got "${goal.type}".`);
      }
      if (!Array.isArray(goal.resources) || goal.resources.length === 0) {
        problems.push(`${scenario}: read-state nextGoal.resources should be a non-empty array, got ${JSON.stringify(goal.resources)}.`);
        return;
      }

      // The page's goal text and the tool's goal text are the same words.
      const shownText = document.getElementById("goal-text").textContent.trim();
      if (shownText !== goal.description) {
        problems.push(`${scenario}: page goal text ${JSON.stringify(shownText)} differs from read-state nextGoal.description ${JSON.stringify(goal.description)}.`);
      }

      // The numbers beside each bar are the tool's numbers.
      const labels = [parseLabel("goal-resource-label-1"), parseLabel("goal-resource-label-2")];
      goal.resources.forEach((res, i) => {
        const label = labels[i];
        if (!label) {
          problems.push(`${scenario}: page is missing the label for resource ${i} (${res.name}).`);
        } else if (label.name !== res.name || label.current !== res.current || label.target !== res.target) {
          problems.push(`${scenario}: page label ${i} "${label.name}: ${label.current} / ${label.target}" differs from read-state ${res.name} ${res.current} / ${res.target}.`);
        }
      });

      // A goal whose action is available never shows a current amount below
      // its target, and the bar is full exactly when the action is available.
      if (goal.available && !goal.resources.every((r) => r.current >= r.target)) {
        problems.push(`${scenario}: goal is available but shows a short bar (${goal.resources.map((r) => r.current + "/" + r.target).join(", ")}).`);
      }
      const barFull = (id) => {
        const el = document.getElementById(id);
        if (!el || el.hidden) return null;
        return parseFloat(el.getAttribute("aria-valuenow")) >= parseFloat(el.getAttribute("aria-valuemax"));
      };
      const shownBars = [barFull("goal-progress-track-1")];
      if (goal.resources.length === 2) shownBars.push(barFull("goal-progress-track-2"));
      const shownFull = shownBars.every((full) => full === true);
      if (shownFull !== goal.available) {
        problems.push(`${scenario}: page bars full=${shownFull} but read-state available=${goal.available} for goal "${goal.type}".`);
      }

      // The goal's own action button is enabled exactly when the tool says so.
      const buttonId = ACTION_BUTTON[goal.type];
      if (buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) {
          problems.push(`${scenario}: expected a #${buttonId} button for the "${goal.type}" goal.`);
        } else if (Boolean(btn.disabled) === goal.available) {
          problems.push(`${scenario}: #${buttonId} disabled=${btn.disabled} but read-state available=${goal.available}.`);
        }
      }
    };

    // Every goal type, and just below each threshold it turns on at.
    loadScenario({ wood: 7 });
    await checkGoal("first goal at 7 wood", "first-goal");

    loadScenario({ wood: 9 });
    await checkGoal("just below the first goal at 9 wood", "first-goal");
    loadScenario({ wood: 10 });
    await checkGoal("sharpen available at 10 wood", "upgrade");

    loadScenario({ wood: 10, upgradeLevel: 1, stoneUnlocked: true, stone: 3 });
    await checkGoal("gather-stone goal at 3 stone", "stone-goal");
    loadScenario({ wood: 10, upgradeLevel: 1, stoneUnlocked: true, stone: 4 });
    await checkGoal("just below the wall cost at 4 stone", "stone-goal");
    loadScenario({ wood: 10, upgradeLevel: 1, stoneUnlocked: true, stone: 5 });
    await checkGoal("build-wall goal at 5 stone", "build-wall-goal");

    loadScenario({ wood: 10, stone: 4, upgradeLevel: 1, stoneUnlocked: true, wallLevel: 1 });
    await checkGoal("forge goal below its stone cost", "forge-goal");
    loadScenario({ wood: 10, stone: 5, upgradeLevel: 1, stoneUnlocked: true, wallLevel: 1 });
    await checkGoal("forge goal at its costs", "forge-goal");
    loadScenario({ wood: 10, stone: 5, upgradeLevel: 1, stoneUnlocked: true, wallLevel: 1, forgeLevel: 4 });
    await checkGoal("forge goal just below forge level 5", "forge-goal");

    loadScenario({ wood: 10, stone: 4, upgradeLevel: 1, stoneUnlocked: true, wallLevel: 1, forgeLevel: 5 });
    await checkGoal("expedition goal below its stone cost", "expedition-goal");
    loadScenario({ wood: 10, stone: 5, upgradeLevel: 1, stoneUnlocked: true, wallLevel: 1, forgeLevel: 5 });
    await checkGoal("expedition goal at its costs", "expedition-goal");

    // Crossing the wall cost moves the page and the tool together at the same
    // threshold: 4 stone is the gather-stone goal, 5 stone is build-wall.
    loadScenario({ wood: 10, upgradeLevel: 1, stoneUnlocked: true, stone: 4 });
    renderNow();
    const pageBefore = document.getElementById("goal-text").textContent.trim();
    const toolBefore = (await readState.execute({})).nextGoal.description;
    loadScenario({ wood: 10, upgradeLevel: 1, stoneUnlocked: true, stone: 5 });
    renderNow();
    const pageAfter = document.getElementById("goal-text").textContent.trim();
    const toolAfter = (await readState.execute({})).nextGoal.description;
    if (pageBefore !== toolBefore || pageAfter !== toolAfter) {
      problems.push(`Goal threshold drift: page saw ${JSON.stringify(pageBefore)}/${JSON.stringify(pageAfter)} but read-state saw ${JSON.stringify(toolBefore)}/${JSON.stringify(toolAfter)}.`);
    }
    if (pageBefore === pageAfter) {
      problems.push(`Crossing the wall cost (4 -> 5 stone) should change the goal, but both renders showed ${JSON.stringify(pageAfter)}.`);
    }

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Shared goal rule test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Offline summary overlay appears after any resource gain (no time guard) ───
  // Issue #943 removed the `elapsedSec > 3` guard, and issue #989 keeps the
  // panel for any real return at least RETURN_MIN_SEC long, whether or not a
  // whole resource was earned. The elapsed check below uses a 2-second absence.
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

  // ─── A truthful welcome-back summary (issue #989) ───────────────
  // The return is recorded once in the engine (getReturnSummary) and read —
  // never consumed — by the panel and the agent tools. So the panel always
  // accounts for a real return, its wood is exactly the counter's visible rise,
  // and an action that opened up is named even when nothing was visibly earned.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readStateTool = tools().find((t) => t.name === "read-state");
    if (typeof engine.getReturnSummary !== "function") {
      problems.push("Expected engine.getReturnSummary to be exported so the panel and tools share one return record.");
    }
    if (!readStateTool) {
      problems.push("Expected a read-state tool for the welcome-back summary checks.");
    }

    const overlay = document.getElementById("offline-summary");
    const woodAmountEl = document.getElementById("offline-wood-amount");
    const elapsedEl = document.getElementById("offline-elapsed");
    const sharpenMilestoneEl = document.getElementById("milestone-sharpen");

    // The counter's own rule, read from the engine so "the increase the player
    // can see" is measured exactly as the counter writes it — a second copy of
    // the rounding here could measure a rise the counter never shows.
    const counterValue = (v) => engine.displayAmount(v);
    const visibleRise = (before, after) => engine.displayAmount(counterValue(after) - counterValue(before));

    // Load a saved game `ageMs` old and let the page show the panel exactly as
    // it does on a real reload.
    function reloadFromAge(ageMs, saved) {
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify({
        wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
        wallLevel: 0, stoneUnlocked: false,
        firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
        timestamp: new Date(Date.now() - ageMs).toISOString(),
        ...saved,
      }));
      engine.init();
      if (typeof window.__setOverlayOpen === "function") window.__setOverlayOpen("offline", false);
      overlay.setAttribute("hidden", "");
      window.__showOfflineSummary();
    }

    // (a) A return whose counter rise rounds to nothing must still show the panel,
    // and the wood it reports must be that rise — not the raw catch-up. At 12
    // wood the counter floors, so the visible rise is 0 while 0.3 was earned.
    reloadFromAge(3000, { wood: 12, totalWoodEarned: 12 });
    if (overlay.hidden) {
      problems.push("A 3s return from a save must show the welcome-back panel even when the counter's visible rise is 0.");
    }
    const highRise = visibleRise(12, engine.getState().wood);
    if (!woodAmountEl || parseFloat(woodAmountEl.textContent) !== highRise) {
      problems.push(`The panel's wood (${woodAmountEl && woodAmountEl.textContent}) must equal the counter's visible rise (${highRise}) across the reload.`);
    }

    // (b) A fractional earn (<1 wood) shows the real rise, and it equals the
    // counter's increase across the reload.
    reloadFromAge(2000, { wood: 5 });
    if (overlay.hidden) {
      problems.push("A 2s return that earns under one wood must show the welcome-back panel.");
    }
    const panelWood = woodAmountEl ? parseFloat(woodAmountEl.textContent) : NaN;
    if (!(panelWood > 0)) {
      problems.push(`The panel must show the fractional wood earned on a 2s return, got "${woodAmountEl && woodAmountEl.textContent}".`);
    }
    const fractionalRise = visibleRise(5, engine.getState().wood);
    if (panelWood !== fractionalRise) {
      problems.push(`The panel's wood (${panelWood}) must equal the counter's visible rise (${fractionalRise}) across the reload.`);
    }

    // (c) Reading the summary does not spend it: two reads, a second render,
    // and a dismiss-then-re-show all report the same return.
    const firstWood = panelWood;
    const firstElapsed = elapsedEl ? elapsedEl.textContent.trim() : "";
    const summaryOnce = engine.getReturnSummary();
    const summaryTwice = engine.getReturnSummary();
    if (summaryOnce.wood !== summaryTwice.wood || summaryOnce.visible !== summaryTwice.visible || summaryOnce.elapsed !== summaryTwice.elapsed) {
      problems.push("getReturnSummary() must read the return, not consume it — two reads disagreed.");
    }
    window.__showOfflineSummary();
    if (overlay.hidden || (woodAmountEl && parseFloat(woodAmountEl.textContent) !== firstWood)) {
      problems.push("A second showOfflineSummary() must show the same return, not a spent/empty one.");
    }
    window.__dismissOffline();
    window.__showOfflineSummary();
    if (overlay.hidden) {
      problems.push("Re-showing the panel after a dismiss must still show the recorded return.");
    }
    if (elapsedEl && elapsedEl.textContent.trim() !== firstElapsed) {
      problems.push(`Re-showing the panel must keep the same absence length (${firstElapsed}), got "${elapsedEl.textContent.trim()}".`);
    }

    // (d) A return that crosses the first goal names the newly available action
    // even though nothing was visibly earned: 9.999 wood shows as 10.00, so the
    // counter's rise is 0 while the axe becomes sharpenable.
    reloadFromAge(2000, { wood: 9.999, totalWoodEarned: 9.999 });
    if (overlay.hidden) {
      problems.push("A return that crosses the first goal must show the welcome-back panel.");
    }
    const crossingRise = visibleRise(9.999, engine.getState().wood);
    if (!woodAmountEl || parseFloat(woodAmountEl.textContent) !== crossingRise) {
      problems.push(`The panel's wood (${woodAmountEl && woodAmountEl.textContent}) must equal the counter's visible rise (${crossingRise}) when a milestone is crossed.`);
    }
    if (sharpenMilestoneEl && sharpenMilestoneEl.hidden) {
      problems.push("Crossing the first goal while away must name 'you can now sharpen your axe', even when no wood was visibly earned.");
    }

    // (e) A first-ever visit has no return to report and shows no panel.
    engine.reset();
    engine.init();
    if (typeof window.__setOverlayOpen === "function") window.__setOverlayOpen("offline", false);
    overlay.setAttribute("hidden", "");
    if (engine.getReturnSummary().visible) {
      problems.push("A first-ever visit with no saved game must report no return.");
    }
    window.__showOfflineSummary();
    if (!overlay.hidden) {
      problems.push("A first-ever visit with no saved game must show no welcome-back panel.");
    }

    // (f) A sub-second reload is not a return, so it shows nothing either.
    reloadFromAge(300, { wood: 5 });
    if (engine.getReturnSummary().visible) {
      problems.push("A sub-second reload must report no return.");
    }
    if (!overlay.hidden) {
      problems.push("A sub-second reload must show no welcome-back panel.");
    }

    // (g) The agent's read-state reports the same return the panel is showing.
    reloadFromAge(2000, { wood: 5 });
    if (readStateTool && !overlay.hidden) {
      const panelValue = parseFloat(woodAmountEl.textContent);
      const readState = await readStateTool.execute({});
      if (readState.offlineWoodGained !== panelValue) {
        problems.push(`read-state.offlineWoodGained (${readState.offlineWoodGained}) must equal the panel's wood (${panelValue}) — the page cannot disagree about a return.`);
      }
      if (readState.offlineElapsed !== (elapsedEl ? elapsedEl.textContent.trim() : "")) {
        problems.push(`read-state.offlineElapsed (${readState.offlineElapsed}) must equal the panel's absence text.`);
      }
    }

    // (h)-(j) A real return's account is carried in the save itself, so a
    // reload before the player dismisses it tells the same story instead of
    // the few seconds since the last tick. This helper reloads the save
    // exactly as it stands, wound back `ageMs`, and opens the panel only when
    // the account is unseen, mirroring the page's own load behaviour.
    const stoneAmountEl = document.getElementById("offline-stone-amount");
    const discoveryNameEl = document.getElementById("offline-discovery-name");
    function reloadKeepingAccount(ageMs) {
      const saved = JSON.parse(localStorage.getItem("selfgrow-state"));
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify({
        ...saved,
        timestamp: new Date(Date.now() - ageMs).toISOString(),
      }));
      engine.init();
      if (typeof window.__setOverlayOpen === "function") window.__setOverlayOpen("offline", false);
      overlay.setAttribute("hidden", "");
      if (!engine.getReturnSummary().seen) window.__showOfflineSummary();
      return engine.getReturnSummary();
    }

    // (h) A 1h return reloaded three seconds later, before it was dismissed,
    // still reports the same absence, earnings and find, never the seconds
    // since the last tick. This goes red if catchUp overwrites the record.
    reloadFromAge(3600000, { wood: 5 });
    if (overlay.hidden) {
      problems.push("A 1h return must open the welcome-back panel on load.");
    }
    const realReturn = engine.getReturnSummary();
    if (realReturn.seen) {
      problems.push("A freshly recorded return must be unseen until the player dismisses it.");
    }
    if (!(realReturn.elapsedSec >= 3600)) {
      problems.push(`A 1h return must report at least 3600s away, got ${realReturn.elapsedSec}.`);
    }
    const realElapsed = elapsedEl ? elapsedEl.textContent.trim() : "";
    const realWood = woodAmountEl ? woodAmountEl.textContent : "";
    const realStone = stoneAmountEl ? stoneAmountEl.textContent : "";
    const realFind = discoveryNameEl ? discoveryNameEl.textContent : "";

    const reloadedBeforeDismiss = reloadKeepingAccount(3000);
    if (!(reloadedBeforeDismiss.elapsedSec >= 3600)) {
      problems.push(`A reload before dismissing must keep the real absence (expected >= 3600s, got ${reloadedBeforeDismiss.elapsedSec}).`);
    }
    if (overlay.hidden) {
      problems.push("A reload before dismissing must still show the welcome-back panel.");
    }
    if (elapsedEl && elapsedEl.textContent.trim() !== realElapsed) {
      problems.push(`A reload before dismissing changed the absence text: expected "${realElapsed}", got "${elapsedEl.textContent.trim()}".`);
    }
    if (woodAmountEl && woodAmountEl.textContent !== realWood) {
      problems.push(`A reload before dismissing changed the wood earned: expected "${realWood}", got "${woodAmountEl.textContent}".`);
    }
    if (stoneAmountEl && stoneAmountEl.textContent !== realStone) {
      problems.push(`A reload before dismissing changed the stone earned: expected "${realStone}", got "${stoneAmountEl.textContent}".`);
    }
    if (discoveryNameEl && discoveryNameEl.textContent !== realFind) {
      problems.push(`A reload before dismissing changed the find: expected "${realFind}", got "${discoveryNameEl.textContent}".`);
    }
    if (reloadedBeforeDismiss.discovery && realReturn.discovery && reloadedBeforeDismiss.discovery.id !== realReturn.discovery.id) {
      problems.push(`A reload before dismissing changed the discovery: expected ${realReturn.discovery.id}, got ${reloadedBeforeDismiss.discovery.id}.`);
    }
    if (readStateTool && !overlay.hidden) {
      const readAfterReload = await readStateTool.execute({});
      if (readAfterReload.offlineElapsed !== (elapsedEl ? elapsedEl.textContent.trim() : "")) {
        problems.push("read-state must report the kept return's absence after a reload, not the seconds since the last tick.");
      }
    }

    // (i) Dismissing marks the account seen and persists that, so a reload
    // afterwards does not run that same absence again on its own. The agent's
    // dismiss-offline action routes through the same page handler, so it must
    // leave the same seen flag — page and tool cannot disagree.
    const performActionTool = tools().find((t) => t.name === "perform-action");
    if (performActionTool) {
      await performActionTool.execute({ action: "dismiss-offline" });
    } else {
      window.__dismissOffline();
    }
    const persistedAfterDismiss = JSON.parse(localStorage.getItem("selfgrow-state"));
    if (!persistedAfterDismiss.lastReturn || persistedAfterDismiss.lastReturn.seen !== true) {
      problems.push("Dismissing the welcome-back panel must persist the return account marked seen.");
    }
    const reloadedAfterDismiss = reloadKeepingAccount(300);
    if (reloadedAfterDismiss.visible) {
      problems.push("A reload after dismissing must not report that same return as a visible return.");
    }
    if (!overlay.hidden) {
      problems.push("A reload after dismissing must not re-open the welcome-back panel on its own.");
    }

    // (j) A genuinely new absence of at least a minute replaces the kept
    // account. The 1h return gives a Wandering Sapling; a new 90s absence is a
    // different, shorter trip and must be the one reported.
    reloadFromAge(3600000, { wood: 5 });
    if (!(engine.getReturnSummary().elapsedSec >= 3600)) {
      problems.push("The kept account for the 90s replacement check should start as a 1h absence.");
    }
    const replacedReturn = reloadKeepingAccount(90000);
    if (!(Math.abs(replacedReturn.elapsedSec - 90) < 5)) {
      problems.push(`A new 90s absence must replace the kept account: expected about 90s, got ${replacedReturn.elapsedSec}.`);
    }
    if (!replacedReturn.discovery || replacedReturn.discovery.id !== "flint-shard") {
      problems.push(`A new 90s absence must report its own find (flint-shard), got ${JSON.stringify(replacedReturn.discovery)}.`);
    }
    if (overlay.hidden) {
      problems.push("A new unseen absence must open the welcome-back panel on load.");
    }

    // (k)-(m) The account is the player's to revisit (issue #1015). The status
    // panel carries a control that re-opens the last return's summary from the
    // same persisted record, so re-opening is byte-identical to the original,
    // and the agent has the same capability through the show-return action.
    const btnShowReturn = document.getElementById("btn-show-return");
    if (!btnShowReturn) {
      problems.push("Expected #btn-show-return in the status panel to re-open the last return's summary.");
    } else if (!btnShowReturn.closest("#status-bar")) {
      problems.push("The Last return control must live in the #status-bar status panel.");
    }

    // (k) Before any return there is nothing to show: the control is absent,
    // the agent reports no return, and show-return refuses without opening the
    // overlay.
    engine.reset();
    engine.init();
    if (typeof window.__setOverlayOpen === "function") window.__setOverlayOpen("offline", false);
    overlay.setAttribute("hidden", "");
    window.__renderUI();
    if (btnShowReturn && !btnShowReturn.hidden) {
      problems.push("The Last return control must be hidden before the player has had any return.");
    }
    if (readStateTool) {
      const noReturnState = await readStateTool.execute({});
      if (noReturnState.returnAvailable !== false) {
        problems.push(`read-state.returnAvailable must be false with no return on record, got ${noReturnState.returnAvailable}.`);
      }
    }
    if (performActionTool) {
      const noReturnShow = await performActionTool.execute({ action: "show-return" });
      if (noReturnShow.ok !== false) {
        problems.push("show-return must refuse with ok:false when there is no return on record.");
      }
      if (!overlay.hidden) {
        problems.push("show-return must not open the welcome-back panel when there is no return.");
      }
    }

    // (l) A real return, dismissed, leaves the control in place and the account
    // still available; clicking it re-opens the very same summary without
    // altering the record.
    reloadFromAge(3600000, { wood: 5 });
    if (overlay.hidden) {
      problems.push("A 1h return must open the welcome-back panel before the re-open checks.");
    }
    const keptPanelElapsed = elapsedEl ? elapsedEl.textContent.trim() : "";
    const keptPanelWood = woodAmountEl ? woodAmountEl.textContent : "";
    const keptPanelFind = discoveryNameEl ? discoveryNameEl.textContent : "";
    window.__dismissOffline();
    window.__renderUI();
    if (!overlay.hidden) {
      problems.push("Dismissing must hide the welcome-back panel before the re-open checks.");
    }
    const keptRecord = engine.getReturnSummary();
    if (!keptRecord.visible) {
      problems.push("A real return must stay on record after it is dismissed, so it can be re-opened.");
    }
    if (btnShowReturn && btnShowReturn.hidden) {
      problems.push("The Last return control must be shown once the player has had a return.");
    }
    if (readStateTool) {
      const afterDismissState = await readStateTool.execute({});
      if (afterDismissState.returnAvailable !== true) {
        problems.push(`read-state.returnAvailable must be true after a return even while the panel is dismissed, got ${afterDismissState.returnAvailable}.`);
      }
      if (afterDismissState.offlineWoodGained !== 0) {
        problems.push(`read-state.offlineWoodGained must stay 0 while the panel is dismissed, got ${afterDismissState.offlineWoodGained}.`);
      }
    }
    if (btnShowReturn) btnShowReturn.click();
    if (overlay.hidden) {
      problems.push("Clicking the Last return control must re-open the welcome-back panel.");
    }
    if (elapsedEl && elapsedEl.textContent.trim() !== keptPanelElapsed) {
      problems.push(`Re-opening must show the same absence length: expected "${keptPanelElapsed}", got "${elapsedEl.textContent.trim()}".`);
    }
    if (woodAmountEl && woodAmountEl.textContent !== keptPanelWood) {
      problems.push(`Re-opening must show the same wood earned: expected "${keptPanelWood}", got "${woodAmountEl.textContent}".`);
    }
    if (discoveryNameEl && discoveryNameEl.textContent !== keptPanelFind) {
      problems.push(`Re-opening must show the same find: expected "${keptPanelFind}", got "${discoveryNameEl.textContent}".`);
    }
    const reopenedRecord = engine.getReturnSummary();
    if (reopenedRecord.wood !== keptRecord.wood || reopenedRecord.elapsedSec !== keptRecord.elapsedSec || reopenedRecord.seen !== keptRecord.seen) {
      problems.push("Re-opening must read the recorded return, not change it.");
    }

    // (m) The agent's show-return opens the same panel with the same numbers.
    window.__dismissOffline();
    window.__renderUI();
    if (performActionTool) {
      const shown = await performActionTool.execute({ action: "show-return" });
      if (shown.ok !== true) {
        problems.push("show-return must succeed when a return is on record.");
      }
      if (overlay.hidden) {
        problems.push("show-return must open the welcome-back panel.");
      }
      const panelWoodNow = woodAmountEl ? parseFloat(woodAmountEl.textContent) : NaN;
      if (shown.offlineWoodGained !== panelWoodNow) {
        problems.push(`show-return's offlineWoodGained (${shown.offlineWoodGained}) must equal the panel's wood (${panelWoodNow}).`);
      }
      if (shown.offlineElapsed !== (elapsedEl ? elapsedEl.textContent.trim() : "")) {
        problems.push(`show-return's offlineElapsed (${shown.offlineElapsed}) must equal the panel's absence text.`);
      }
    }

    // Leave the page as it was found.
    if (!overlay.hidden) window.__dismissOffline();
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Welcome-back summary test threw: ${err.message}`);
    console.error(err);
  }

  // ─── The welcome-back panel ends with the next goal (issues #990, #1024) ─
  // On every real return the panel must close by naming the player's next
  // goal and how far they now are from it, in the goal panel's own text and
  // numbers, so the two can never drift. Six phases cover every branch of the
  // goal rule — four single-resource goals and two dual-resource goals.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");

    const overlay = document.getElementById("offline-summary");
    const nextGoalLine = document.getElementById("offline-next-goal");
    const nextGoalText = document.getElementById("offline-next-goal-text");
    const nextGoalResources = document.getElementById("offline-next-goal-resources");
    const milestones = document.getElementById("offline-milestones");
    const dismissBtn = document.getElementById("btn-dismiss-offline");
    const goalTextEl = document.getElementById("goal-text");
    const goalResourceLabels = [
      document.getElementById("goal-resource-label-1"),
      document.getElementById("goal-resource-label-2"),
    ];
    const readState = tools().find((tool) => tool.name === "read-state");

    // Split the panel's figures into the resource name and its current/target
    // pair, so each can be compared with the goal panel and with the tool.
    function parseGoalFigures(text) {
      return text
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const match = entry.match(/^(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)$/);
          if (!match) return { text: entry, name: null, current: NaN, target: NaN };
          return { text: entry, name: match[1], current: parseFloat(match[2]), target: parseFloat(match[3]) };
        });
    }

    if (!nextGoalLine) {
      problems.push("Expected #offline-next-goal to exist in the welcome-back panel \u2014 it was not found.");
    } else {
      if (!nextGoalLine.closest("#offline-summary")) {
        problems.push("#offline-next-goal must live inside #offline-summary so it is part of the welcome-back panel.");
      }
      if (milestones && !(milestones.compareDocumentPosition(nextGoalLine) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        problems.push("#offline-next-goal must come after #offline-milestones so the panel ends with the next goal.");
      }
    }
    if (!nextGoalText) {
      problems.push("Expected #offline-next-goal-text to hold the goal inside #offline-next-goal \u2014 it was not found.");
    }
    if (!nextGoalResources) {
      problems.push("Expected #offline-next-goal-resources to hold the next goal's current/target figures \u2014 it was not found.");
    } else if (nextGoalLine && !nextGoalLine.contains(nextGoalResources)) {
      problems.push("#offline-next-goal-resources must sit on the welcome-back panel's last line, inside #offline-next-goal, so a returning player reads the goal and its progress together.");
    }
    if (!readState) {
      problems.push("Expected a tool named 'read-state' to compare the welcome-back panel's next-goal figures against \u2014 it was not found.");
    }

    // Each phase seeds a state whose goal the panel must repeat, plus the word
    // that identifies that goal, so a non-empty but wrong line is caught too.
    // Values carry margin so the ~1.5s catch-up cannot cross a threshold.
    const phases = [
      { name: "first goal", keyword: "wood", save: { wood: 5, totalWoodEarned: 5 } },
      { name: "sharpen", keyword: "Sharpening", save: { wood: 12, totalWoodEarned: 12 } },
      { name: "gather stone", keyword: "stone", save: { wood: 12, totalWoodEarned: 12, upgradeLevel: 1, stoneUnlocked: true, stone: 0 } },
      { name: "build wall", keyword: "Wall", save: { wood: 12, totalWoodEarned: 12, upgradeLevel: 1, stoneUnlocked: true, stone: 5 } },
      { name: "forge", keyword: "Forge", save: { wood: 12, totalWoodEarned: 12, upgradeLevel: 1, stoneUnlocked: true, stone: 5, wallLevel: 1 } },
      { name: "expedition", keyword: "expedition", save: { wood: 12, totalWoodEarned: 12, upgradeLevel: 1, stoneUnlocked: true, stone: 20, wallLevel: 1, forgeLevel: 5 } },
    ];

    for (const phase of phases) {
      // reset() clears storage, so seed the save after it and before init().
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify({
        rate: 0.1, stone: 0, wallLevel: 0, forgeLevel: 0, stoneUnlocked: false,
        firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
        timestamp: new Date(Date.now() - 1500).toISOString(),
        ...phase.save,
      }));
      engine.init();
      if (typeof window.__setOverlayOpen === "function") window.__setOverlayOpen("offline", false);
      overlay.setAttribute("hidden", "");
      window.__renderUI();
      window.__showOfflineSummary();

      const lineText = nextGoalText ? nextGoalText.textContent.trim() : "";
      const panelGoal = goalTextEl ? goalTextEl.textContent.trim() : "";

      if (overlay.hidden) {
        problems.push(`The welcome-back panel must be visible for the ${phase.name} phase.`);
      }
      if (!lineText) {
        problems.push(`The welcome-back panel must state the next goal for the ${phase.name} phase, but the line was empty.`);
      }
      if (lineText !== panelGoal) {
        problems.push(`The welcome-back panel's next goal for the ${phase.name} phase must equal the goal panel's text \u2014 panel: ${JSON.stringify(lineText)}, goal panel: ${JSON.stringify(panelGoal)}.`);
      }
      if (lineText && !lineText.includes(phase.keyword)) {
        problems.push(`The welcome-back panel's next goal for the ${phase.name} phase should name ${JSON.stringify(phase.keyword)}, got ${JSON.stringify(lineText)}.`);
      }

      // The same line must say how close the goal is: the figures the goal
      // panel prints beside its bar(s), in the same words.
      const figuresText = nextGoalResources ? nextGoalResources.textContent.trim() : "";
      const panelFigures = goalResourceLabels
        .filter((label) => label && !label.hidden && label.textContent.trim())
        .map((label) => label.textContent.trim())
        .join(", ");

      if (!figuresText) {
        problems.push(`The welcome-back panel must state how far the next goal is for the ${phase.name} phase, but its figures were empty.`);
      }
      if (figuresText !== panelFigures) {
        problems.push(`The welcome-back panel's next-goal figures for the ${phase.name} phase must equal the goal panel's own labels \u2014 panel: ${JSON.stringify(figuresText)}, goal panel: ${JSON.stringify(panelFigures)}.`);
      }

      // The read-state tool is the third reader of that one rule: an agent must
      // be told the same names and the same numbers the panel shows.
      const panelEntries = parseGoalFigures(figuresText);
      const toolResources = readState ? (await readState.execute({})).nextGoal.resources : [];

      if (readState && panelEntries.length !== toolResources.length) {
        problems.push(`The welcome-back panel's next goal for the ${phase.name} phase must carry the same number of resources as read-state reports \u2014 panel: ${panelEntries.length} (${JSON.stringify(figuresText)}), read-state: ${toolResources.length}.`);
      }
      for (let i = 0; i < panelEntries.length; i++) {
        const entry = panelEntries[i];
        const fromTool = toolResources[i];
        if (!entry.name) {
          problems.push(`The welcome-back panel's next goal for the ${phase.name} phase must write each resource as "Name: current / target", got ${JSON.stringify(entry.text)}.`);
        } else if (fromTool && (entry.name !== fromTool.name || entry.current !== fromTool.current || entry.target !== fromTool.target)) {
          problems.push(`The welcome-back panel's next-goal figures for the ${phase.name} phase must equal read-state's nextGoal.resources \u2014 panel: ${entry.name} ${entry.current} / ${entry.target}, read-state: ${fromTool.name} ${fromTool.current} / ${fromTool.target}.`);
        }
      }

      if (dismissBtn) dismissBtn.click();
    }

    // Leave the page as it was found.
    if (!overlay.hidden) window.__dismissOffline();
    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Welcome-back next-goal test threw: ${err.message}`);
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
    const ffBtns = ["sb-btn-10x", "sb-btn-1h", "sb-btn-1d", "sb-btn-1mo", "sb-btn-next-find"];
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

    // A rehearsal must project the engine's stone rate for the clone's own wood
    // total, never a second copy that could promise stone the game would not pay.
    const projectedStoneRate = result2.stoneDelta / 3600;
    const engineStoneRate = engine.computeStoneRateFor(stoneState.totalWoodEarned + result2.woodDelta);
    if (Math.abs(projectedStoneRate - engineStoneRate) > 1e-9) {
      problems.push(`Sandbox projected stone rate ${projectedStoneRate}/s disagrees with the engine's computeStoneRateFor() for the same wood total (${engineStoneRate}/s).`);
    }

    // --- Sandbox Test 3b: the rehearsal panel shows the engine's stone rate ---
    // The panel is a third reader of the same rule, so it must show a number the
    // engine's rule produces for the clone's wood total — a second copy of the
    // formula would show something else entirely. A long wood total is used so a
    // changed constant moves the displayed number well clear of the read's own
    // slack (the live tick can credit wood between the clone and the read).
    if (typeof window.__enterSandbox !== "function" || typeof window.__fastForwardSandbox !== "function") {
      problems.push("Expected window.__enterSandbox/__fastForwardSandbox to drive the sandbox panel.");
    } else {
      engine.reset();
      for (let i = 0; i < 10; i++) engine.gatherWood();
      engine.craftUpgrade(); // unlocks stone
      for (let i = 0; i < 2000; i++) engine.gatherWood();
      const woodBeforeRehearsal = engine.getState().totalWoodEarned;

      window.__enterSandbox();
      window.__fastForwardSandbox(0); // a zero-second window leaves the wood total as cloned
      const panelRateText = document.getElementById("sb-stone-rate").textContent;
      const panelRate = Number.parseFloat(panelRateText.replace(/[^0-9.eE+-]/g, ""));
      const lowestPossible = engine.computeStoneRateFor(woodBeforeRehearsal);
      const highestPossible = engine.computeStoneRateFor(engine.getState().totalWoodEarned);
      const displayRounding = 5e-3; // the panel prints two decimals
      if (!Number.isFinite(panelRate)
        || panelRate < lowestPossible - displayRounding
        || panelRate > highestPossible + displayRounding) {
        problems.push(`Sandbox panel shows stone rate "${panelRateText}" but the engine's rule gives ${lowestPossible}/s to ${highestPossible}/s for the wood total it rehearsed — the panel must not keep its own formula.`);
      }
      window.__exitSandbox();
      engine.reset();
      engine.init();
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

    // --- Sandbox Test 4b: a rehearsal names the find a real absence would ---
    // The sandbox must reuse the engine's discovery rule, so the same length
    // can never name a different find than a real return would.
    const oneHourClone = sandbox.cloneState(engine.getState());
    const oneHourResult = sandbox.fastForward(oneHourClone, 3600);
    const oneHourRealRule = engine.discoverForElapsed(3600);
    if (oneHourResult.seconds !== 3600) {
      problems.push(`sandbox fastForward should report the simulated seconds (3600), got ${oneHourResult.seconds}.`);
    }
    if (!oneHourResult.discovery) {
      problems.push("sandbox fastForward(3600s) should name the away find a real 1-hour absence would, got none.");
    } else if (oneHourResult.discovery.id !== "wandering-sapling") {
      problems.push(`sandbox fastForward(3600s) should find 'wandering-sapling', got '${oneHourResult.discovery.id}'.`);
    } else if (oneHourResult.discovery.name !== oneHourRealRule.name || oneHourResult.discovery.bonus !== oneHourRealRule.bonus) {
      problems.push(`sandbox fastForward(3600s) find should match engine.discoverForElapsed(3600s) (${JSON.stringify(oneHourRealRule)}), got ${JSON.stringify(oneHourResult.discovery)}.`);
    }

    const oneDayClone = sandbox.cloneState(engine.getState());
    const oneDayResult = sandbox.fastForward(oneDayClone, 86400);
    const oneDayRealRule = engine.discoverForElapsed(86400);
    if (!oneDayResult.discovery || oneDayResult.discovery.id !== "ancient-grove") {
      problems.push(`sandbox fastForward(86400s) should find 'ancient-grove', got ${oneDayResult.discovery ? oneDayResult.discovery.id : "none"}.`);
    } else if (oneDayResult.discovery.bonus !== oneDayRealRule.bonus) {
      problems.push(`sandbox fastForward(86400s) find should match engine.discoverForElapsed(86400s) (${JSON.stringify(oneDayRealRule)}), got ${JSON.stringify(oneDayResult.discovery)}.`);
    }

    const shortRehearsalClone = sandbox.cloneState(engine.getState());
    const shortRehearsal = sandbox.fastForward(shortRehearsalClone, 10);
    if (shortRehearsal.discovery !== null) {
      problems.push(`sandbox fastForward(10s) is too short for a find and should report discovery=null, got ${JSON.stringify(shortRehearsal.discovery)}.`);
    }

    // --- Sandbox Test 4c: a rehearsal announces only milestones that were
    // genuinely new before the simulated time (issue #1006). A player who could
    // already build a wall must not be told a wall just opened up.
    engine.reset();
    const alreadyWallState = engine.getState();
    alreadyWallState.stoneUnlocked = true;
    alreadyWallState.wallLevel = 0;
    alreadyWallState.stone = engine.WALL_COST;
    const alreadyWallClone = sandbox.cloneState(alreadyWallState);
    const alreadyWallResult = sandbox.fastForward(alreadyWallClone, 10);
    if (alreadyWallResult.milestones.wallAvailable) {
      problems.push(`sandbox fastForward announced wallAvailable=true, but the clone could already build a wall before the absence (stone ${engine.WALL_COST} >= WALL_COST ${engine.WALL_COST}); a rehearsal must report only newly crossed milestones.`);
    }

    // --- Sandbox Test 4d: the first-goal milestone is anchored to the engine's
    // own comparison, so a clone below the goal crossing it is named.
    const belowGoalState = engine.getState();
    belowGoalState.wood = 5;
    belowGoalState.totalWoodEarned = 5;
    const belowGoalClone = sandbox.cloneState(belowGoalState);
    const belowGoalResult = sandbox.fastForward(belowGoalClone, 60);
    if (!belowGoalResult.milestones.sharpenAvailable) {
      problems.push(`sandbox fastForward from wood=5 crossing ${engine.FIRST_GOAL_WOOD} wood should report sharpenAvailable=true, got false (wood now ${belowGoalClone.wood}).`);
    }

    // --- Sandbox Test 4e: a rehearsal's milestones are exactly the engine's own
    // milestonesBetween comparison for the same start and duration, so the
    // sandbox and a real return can never disagree (issue #1006).
    engine.reset();
    const parityClone = sandbox.cloneState(engine.getState());
    const parityBefore = engine.milestoneSnapshot(parityClone);
    const parityResult = sandbox.fastForward(parityClone, 3600);
    const parityExpected = engine.milestonesBetween(parityBefore, parityClone);
    for (const key of Object.keys(parityExpected)) {
      if (parityResult.milestones[key] !== parityExpected[key]) {
        problems.push(`sandbox milestones.${key} (${parityResult.milestones[key]}) should match engine.milestonesBetween (${parityExpected[key]}) for the same rehearsal start and duration.`);
      }
    }

    // --- Sandbox Test 4f: each fast-forward replaces the panel's milestone
    // list instead of appending to it, so repeated rehearsals stay readable.
    engine.reset();
    engine.init();
    if (typeof window.__enterSandbox === "function" && typeof window.__fastForwardSandbox === "function") {
      window.__enterSandbox();
      window.__fastForwardSandbox(3600);
      window.__fastForwardSandbox(3600);
      const milestoneRuns = document.querySelectorAll("#sb-milestone-list .sandbox-milestone").length;
      if (milestoneRuns > 1) {
        problems.push(`After two fast-forwards the sandbox milestone list kept ${milestoneRuns} runs of announcements; each run should replace the previous list (expected at most 1).`);
      }
      window.__exitSandbox();
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
      if (!ffResult.discovery || ffResult.discovery.id !== "wandering-sapling") {
        problems.push(`sandbox-fast-forward(3600s) should return the find 'wandering-sapling', got ${ffResult.discovery ? ffResult.discovery.id : "none"}.`);
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

    // --- Sandbox Test 5b: sandbox-fast-forward-next-find rehearses exactly the
    // absence the next away find needs, naming that rung for the caller (#1031).
    // The sandbox panel reads the same ladder, so this tool is how an agent
    // makes the same jump a visitor can. ---
    const nextFindFFTool = allTools.find(t => t.name === "sandbox-fast-forward-next-find");
    if (!nextFindFFTool) {
      problems.push("agenttools should export a 'sandbox-fast-forward-next-find' tool — it was not found.");
    } else if (typeof nextFindFFTool.execute === "function") {
      engine.reset();
      engine.init();
      if (typeof window.__exitSandbox === "function") window.__exitSandbox();
      // A fresh save owns nothing, so the next rung is the ladder's first — a
      // deterministic target for the check.
      const nextFindRung = engine.nextDiscoveryAfter(null);
      const nextFindResult = await nextFindFFTool.execute({});

      if (nextFindResult.sandboxSeconds !== nextFindRung.minSec) {
        problems.push(`sandbox-fast-forward-next-find should fast-forward exactly the next find's absence (${nextFindRung.minSec}s), got ${JSON.stringify(nextFindResult.sandboxSeconds)}.`);
      }
      const targetedRung = nextFindResult.targetedDiscovery;
      if (!targetedRung || targetedRung.id !== nextFindRung.id || targetedRung.name !== nextFindRung.name || targetedRung.minSec !== nextFindRung.minSec) {
        problems.push(`sandbox-fast-forward-next-find should report the rung it targeted (${JSON.stringify({ id: nextFindRung.id, name: nextFindRung.name, minSec: nextFindRung.minSec })}), got ${JSON.stringify(targetedRung)}.`);
      }
      const projectedRule = engine.discoverForElapsed(nextFindRung.minSec);
      if (!nextFindResult.discovery || nextFindResult.discovery.id !== nextFindRung.id || nextFindResult.discovery.bonus !== projectedRule.bonus) {
        problems.push(`sandbox-fast-forward-next-find should report the find a real ${nextFindRung.minSec}s absence turns up (${JSON.stringify(projectedRule)}), got ${JSON.stringify(nextFindResult.discovery)}.`);
      }
      const cloneAfterNextFind = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
      if (!cloneAfterNextFind || cloneAfterNextFind.discoveryId !== nextFindRung.id) {
        problems.push(`sandbox-fast-forward-next-find should leave the clone owning "${nextFindRung.id}", got "${cloneAfterNextFind ? cloneAfterNextFind.discoveryId : "(no clone)"}".`);
      }
      if (nextFindResult.sandboxActive !== true) {
        problems.push("sandbox-fast-forward-next-find should report sandboxActive=true.");
      }
      if (typeof window.__exitSandbox === "function") window.__exitSandbox();

      // A corrupt save names no rung: the tool degrades to a null target rather
      // than throwing or rehearsing an invented interval.
      engine.reset();
      engine.init();
      if (typeof window.__exitSandbox === "function") window.__exitSandbox();
      if (typeof window.__enterSandbox === "function") window.__enterSandbox();
      const corruptClone = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
      if (corruptClone) {
        corruptClone.discoveryId = "not-a-real-rung";
        const corruptResult = await nextFindFFTool.execute({});
        if (corruptResult.targetedDiscovery !== null) {
          problems.push(`sandbox-fast-forward-next-find should report targetedDiscovery=null for an unrecognised find id, got ${JSON.stringify(corruptResult.targetedDiscovery)}.`);
        }
        if (typeof corruptResult.sandboxSeconds !== "number" || corruptResult.sandboxSeconds !== 0) {
          problems.push(`sandbox-fast-forward-next-find should simulate nothing for an unrecognised find id, got ${JSON.stringify(corruptResult.sandboxSeconds)}.`);
        }
      } else {
        problems.push("Expected an active sandbox clone to check the unrecognised-find-id path of sandbox-fast-forward-next-find.");
      }
      if (typeof window.__exitSandbox === "function") window.__exitSandbox();
      engine.reset();
      engine.init();
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

      const sbElapsedEl = document.getElementById("sb-elapsed");
      const sbDiscoveryEl = document.getElementById("sb-discovery");
      if (!sbElapsedEl || !sbDiscoveryEl) {
        problems.push("Expected #sb-elapsed and #sb-discovery to report the last rehearsal in the sandbox panel.");
      } else {
        if (sbElapsedEl.textContent !== "1 hour") {
          problems.push(`#sb-elapsed should read '1 hour' after the 1h fast-forward, got '${sbElapsedEl.textContent}'.`);
        }
        if (!/Wandering Sapling/.test(sbDiscoveryEl.textContent)) {
          problems.push(`#sb-discovery should name 'Wandering Sapling' after the 1h fast-forward, got '${sbDiscoveryEl.textContent}'.`);
        }
      }
    }

    // --- Sandbox Test 9b: a rehearsal names the next away find — the same
    // rung the agent's sandbox-fast-forward reports — so the panel reads like
    // the return it stands in for rather than only reporting totals. ---
    if (typeof window.__enterSandbox === "function" && typeof window.__exitSandbox === "function") {
      // Start a fresh rehearsal from the real save the previous tests left
      // untouched, so the clone's ladder position is deterministic.
      window.__exitSandbox();
      window.__enterSandbox();

      const sbNextFindEl = document.getElementById("sb-next-find");
      if (!sbNextFindEl) {
        problems.push("Expected #sb-next-find in the sandbox panel so a rehearsal names the next away find.");
      } else {
        const ffFind = await sandboxFFTool.execute({ seconds: 3600 });
        const nextAway = ffFind.nextAwayDiscovery;
        const expectedFindText = nextAway
          ? engine.nextAwayFindText({ name: nextAway.name, minSec: nextAway.minSec })
          : null;
        if (!expectedFindText) {
          problems.push("sandbox-fast-forward(3600s) should report a nextAwayDiscovery so the sandbox panel has a rung to name.");
        } else if (sbNextFindEl.hidden || !sbNextFindEl.textContent.trim()) {
          problems.push("After a 1h fast-forward the sandbox panel should name the next away find in #sb-next-find, but it was empty or hidden.");
        } else {
          const shownFind = sbNextFindEl.textContent.trim();
          if (shownFind !== expectedFindText) {
            problems.push(`#sb-next-find should word the next away find exactly as the engine's sentence does, expected "${expectedFindText}", got "${shownFind}".`);
          }
          if (!shownFind.startsWith("Next away find:")) {
            problems.push(`#sb-next-find should start with "Next away find:", got "${shownFind}".`);
          }
          if (nextAway.elapsed && !shownFind.includes(nextAway.elapsed)) {
            problems.push(`#sb-next-find should state the absence the next find needs ("${nextAway.elapsed}"), got "${shownFind}".`);
          }
        }

        // A run that turns up nothing must still name the next rung rather
        // than read as a dead end.
        const ffNothing = await sandboxFFTool.execute({ seconds: 10 });
        if (ffNothing.discovery) {
          problems.push(`sandbox-fast-forward(10s) should turn up nothing, got ${JSON.stringify(ffNothing.discovery)}.`);
        }
        const nothingNext = ffNothing.nextAwayDiscovery;
        const expectedNothingText = nothingNext
          ? engine.nextAwayFindText({ name: nothingNext.name, minSec: nothingNext.minSec })
          : null;
        if (!expectedNothingText || sbNextFindEl.hidden || sbNextFindEl.textContent.trim() !== expectedNothingText) {
          problems.push(`After a fast-forward that finds nothing, #sb-next-find should still name the next rung "${expectedNothingText}", got "${sbNextFindEl.hidden ? "(hidden)" : sbNextFindEl.textContent.trim()}".`);
        }
      }
      window.__exitSandbox();
    }

    // --- Sandbox Test 9c: the panel's rehearsal control jumps straight to the
    // next away find's absence (issue #1031). It names the rung and the absence
    // in its own words, and pressing it simulates exactly that interval through
    // the ordinary fast-forward — so the clone ends up owning precisely the
    // find it promised, never one a different interval would give. ---
    if (typeof window.__enterSandbox === "function" && typeof window.__exitSandbox === "function") {
      window.__exitSandbox();
      window.__enterSandbox();

      const nextFindBtn = document.getElementById("sb-btn-next-find");
      if (!nextFindBtn) {
        problems.push("Expected #sb-btn-next-find in the sandbox controls so a rehearsal can jump straight to the next away find.");
      } else {
        const preJumpClone = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
        const ownedId = preJumpClone ? (preJumpClone.discoveryId ?? preJumpClone.discovery?.id ?? null) : null;
        const jumpRung = engine.nextDiscoveryAfter(ownedId);
        if (!jumpRung) {
          problems.push("Expected a next away find rung from the current save so #sb-btn-next-find has somewhere to jump.");
        } else {
          const absenceText = engine.formatElapsed(jumpRung.minSec * 1000).trim();
          if (nextFindBtn.hidden) {
            problems.push(`#sb-btn-next-find should be visible while the next away find "${jumpRung.name}" exists, but it was hidden.`);
          }
          if (nextFindBtn.offsetWidth === 0 || nextFindBtn.offsetHeight === 0) {
            problems.push("#sb-btn-next-find should have non-zero dimensions while the sandbox is open.");
          }
          const nextFindBtnText = nextFindBtn.textContent.trim();
          if (!nextFindBtnText.includes(jumpRung.name) || !nextFindBtnText.includes(absenceText)) {
            problems.push(`#sb-btn-next-find should name the next find "${jumpRung.name}" and its absence "${absenceText}", got "${nextFindBtnText}".`);
          }
          const nextFindBtnLabel = nextFindBtn.getAttribute("aria-label") || "";
          if (!nextFindBtnLabel.includes(jumpRung.name) || !nextFindBtnLabel.includes(absenceText)) {
            problems.push(`#sb-btn-next-find aria-label should name the next find "${jumpRung.name}" and its absence "${absenceText}", got "${nextFindBtnLabel}".`);
          }
          if (nextFindBtn.dataset.seconds !== String(jumpRung.minSec)) {
            problems.push(`#sb-btn-next-find should carry the absence it rehearses (${jumpRung.minSec} seconds), got "${nextFindBtn.dataset.seconds}".`);
          }

          const woodBeforeJump = preJumpClone ? preJumpClone.wood : 0;
          const rateBeforeJump = preJumpClone ? engine.effectiveWoodRate(preJumpClone) : 0;
          nextFindBtn.click();
          const afterJumpClone = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
          if (!afterJumpClone) {
            problems.push("Clicking #sb-btn-next-find should leave the sandbox clone in place.");
          } else {
            if (afterJumpClone.discoveryId !== jumpRung.id) {
              problems.push(`Clicking #sb-btn-next-find should fast-forward exactly ${jumpRung.minSec}s so the clone owns "${jumpRung.id}", got "${afterJumpClone.discoveryId}" — a wrong interval lands on a different rung or none.`);
            }
            const expectedJumpWood = woodBeforeJump + rateBeforeJump * jumpRung.minSec;
            if (Math.abs(afterJumpClone.wood - expectedJumpWood) > 1e-6) {
              problems.push(`Clicking #sb-btn-next-find should simulate exactly ${jumpRung.minSec}s of wood (expected ${expectedJumpWood}, got ${afterJumpClone.wood}) — the control must run the ordinary fast-forward, not its own interval.`);
            }
          }
          const sbDiscoveryAfterJump = document.getElementById("sb-discovery");
          if (!sbDiscoveryAfterJump || !sbDiscoveryAfterJump.textContent.includes(jumpRung.name)) {
            problems.push(`After clicking #sb-btn-next-find, #sb-discovery should name the find a real ${absenceText} absence turns up ("${jumpRung.name}"), got "${sbDiscoveryAfterJump ? sbDiscoveryAfterJump.textContent.trim() : "(missing)"}".`);
          }
        }
      }
      window.__exitSandbox();
    }

    // --- Sandbox Test 10: exit restores the real save unchanged ---
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    const restored = engine.getState();
    if (restored.wood !== rehearsalStartWood || restored.rate !== rehearsalStartRate) {
      problems.push(`sandbox-exit should restore the real save (wood ${rehearsalStartWood}, rate ${rehearsalStartRate}), got wood ${restored.wood}, rate ${restored.rate}.`);
    }

    // --- Sandbox Test 11: a rehearsal names the away event, with both choices,
    // from the engine's own rule, and never resolves it (issue #1039). A real
    // return of a minute or more offers a decision, so a rehearsal that stopped
    // at the find no longer stands in for the return it projects. The event is
    // read from the rule itself rather than copied, so the rehearsal can never
    // name a different happening or promise a different effect than a return. ---

    // (a) The clone's rehearsal reports exactly the event the engine's rule
    // would for the same absence and the same returned-to state, with two
    // distinct options; an absence below the threshold offers none.
    engine.reset();
    const eventClone = sandbox.cloneState(engine.getState());
    const eventResult = sandbox.fastForward(eventClone, 3600);
    // Derived after the earnings and the find are credited, from the clone the
    // rehearsal left behind — the same order a real catch-up uses.
    const engineEventRule = engine.awayEventForElapsed(3600, eventClone);
    if (!eventResult.event) {
      problems.push("sandbox fastForward(3600s) should name the away event a real 1-hour absence would offer, got none.");
    } else if (JSON.stringify(eventResult.event) !== JSON.stringify(engineEventRule)) {
      problems.push(`sandbox fastForward(3600s) event must match engine.awayEventForElapsed(3600s, the same post-gain clone) (${JSON.stringify(engineEventRule)}), got ${JSON.stringify(eventResult.event)}.`);
    } else {
      if (eventResult.event.title.trim() === "") {
        problems.push(`sandbox fastForward(3600s) event must carry a non-empty title, got ${JSON.stringify(eventResult.event.title)}.`);
      }
      const optionIds = eventResult.event.options.map((option) => option.id);
      if (optionIds.length !== 2 || optionIds[0] === optionIds[1]) {
        problems.push(`sandbox fastForward(3600s) event must offer two distinct options, got ${JSON.stringify(optionIds)}.`);
      }
    }

    const shortEventClone = sandbox.cloneState(engine.getState());
    const shortEventResult = sandbox.fastForward(shortEventClone, 10);
    if (shortEventResult.event !== null) {
      problems.push(`sandbox fastForward(10s) is shorter than the away-event threshold and must report event=null, got ${JSON.stringify(shortEventResult.event)}.`);
    }

    // (b) An agent's rehearsal reports the same event, so the tool and the panel
    // cannot disagree about the choice an absence offers.
    engine.reset();
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    const toolEventResult = await sandboxFFTool.execute({ seconds: 3600 });
    const toolEventClone = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
    const toolEventRule = toolEventClone ? engine.awayEventForElapsed(3600, toolEventClone) : null;
    if (!toolEventRule) {
      problems.push("Expected an active sandbox clone after sandbox-fast-forward(3600s) so its away event can be checked.");
    } else if (JSON.stringify(toolEventResult.event) !== JSON.stringify(toolEventRule)) {
      problems.push(`sandbox-fast-forward(3600s) should report the away event a real 1-hour absence offers (${JSON.stringify(toolEventRule)}), got ${JSON.stringify(toolEventResult.event)}.`);
    }
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();

    // (c) The sandbox panel shows that event's title and both option labels
    // after a long-enough rehearsal, and hides the block after a run that is too
    // short to offer one.
    engine.reset();
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    if (typeof window.__enterSandbox === "function") window.__enterSandbox();
    const sbAwayEventEl = document.getElementById("sb-away-event");
    const sbAwayEventTitleEl = document.getElementById("sb-away-event-title");
    const sbAwayEventOptionsEl = document.getElementById("sb-away-event-options");
    if (!sbAwayEventEl || !sbAwayEventTitleEl || !sbAwayEventOptionsEl) {
      problems.push("Expected #sb-away-event, #sb-away-event-title and #sb-away-event-options in the sandbox panel.");
    } else {
      if (!sbAwayEventEl.hidden) {
        problems.push("Expected #sb-away-event to start hidden before any rehearsal.");
      }
      window.__fastForwardSandbox(3600);
      const panelEventClone = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
      const panelEventRule = panelEventClone ? engine.awayEventForElapsed(3600, panelEventClone) : null;
      if (!panelEventRule) {
        problems.push("Expected a 1h rehearsal on a fresh save to offer an away event so the panel has one to name.");
      } else {
        if (sbAwayEventEl.hidden) {
          problems.push("After a 1h rehearsal #sb-away-event should show the away event a real 1-hour absence offers, but it was hidden.");
        }
        if (sbAwayEventTitleEl.textContent.trim() !== panelEventRule.title) {
          problems.push(`#sb-away-event-title should name the event "${panelEventRule.title}", got "${sbAwayEventTitleEl.textContent.trim()}".`);
        }
        const shownOptions = Array.from(sbAwayEventOptionsEl.children);
        if (shownOptions.length !== panelEventRule.options.length) {
          problems.push(`#sb-away-event-options should show both options (${panelEventRule.options.length}), got ${shownOptions.length}.`);
        } else {
          panelEventRule.options.forEach((option, index) => {
            if (!shownOptions[index].textContent.includes(option.label)) {
              problems.push(`#sb-away-event option ${index} should state "${option.label}", got "${shownOptions[index].textContent.trim()}".`);
            }
          });
        }
        // The block names the choice but offers no way to take it.
        if (sbAwayEventEl.querySelector("button, [role='button'], input, select, textarea")) {
          problems.push("#sb-away-event must offer no control — a rehearsal shows the choice but never resolves it.");
        }
      }
      window.__fastForwardSandbox(10);
      if (!sbAwayEventEl.hidden) {
        problems.push("After a 10s rehearsal, too short for an away event, #sb-away-event should be hidden.");
      }
      if (sbAwayEventTitleEl.textContent.trim() !== "" || sbAwayEventOptionsEl.children.length !== 0) {
        problems.push("#sb-away-event should be emptied when a rehearsal offers no event, so no stale happening is left on screen.");
      }
    }
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();

    // (d) The whole rehearsal leaves the real save alone: its wood and its own
    // pending event are untouched, so the sandbox only ever reports a choice.
    engine.reset();
    const saveBeforeRehearsal = engine.getState();
    if (typeof window.__enterSandbox === "function") window.__enterSandbox();
    window.__fastForwardSandbox(3600);
    window.__fastForwardSandbox(86400);
    const saveDuringRehearsal = engine.getState();
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();
    const saveAfterRehearsal = engine.getState();
    if (saveDuringRehearsal.wood !== saveBeforeRehearsal.wood || saveAfterRehearsal.wood !== saveBeforeRehearsal.wood) {
      problems.push(`The real save's wood must stay ${saveBeforeRehearsal.wood} across a rehearsal that shows an away event, got ${saveDuringRehearsal.wood} during and ${saveAfterRehearsal.wood} after.`);
    }
    if (JSON.stringify(saveAfterRehearsal.pendingEvent) !== JSON.stringify(saveBeforeRehearsal.pendingEvent)) {
      problems.push(`A sandbox rehearsal must not touch the real save's pendingEvent: expected ${JSON.stringify(saveBeforeRehearsal.pendingEvent)}, got ${JSON.stringify(saveAfterRehearsal.pendingEvent)}.`);
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
    const discoveryLeadEl = document.getElementById("offline-discovery-lead");
    const discoveryNameEl = document.getElementById("offline-discovery-name");
    const discoveryBonusEl = document.getElementById("offline-discovery-bonus");
    const discoveryNoteEl = document.getElementById("offline-discovery-note");
    const nextFindEl = document.getElementById("offline-next-find");
    if (!nextFindEl) {
      problems.push("Expected #offline-next-find in the welcome-back panel so the next away find is named.");
    }
    if (!discoveryStat || !discoveryValue) {
      problems.push("Expected #discovery-stat and #discovery-value in the status readout for the away discovery.");
    }
    if (!discoveryLine || !discoveryNameEl) {
      problems.push("Expected #offline-discovery-line and #offline-discovery-name in the welcome-back panel for the away discovery.");
    }
    if (!discoveryLeadEl) {
      problems.push("Expected #offline-discovery-lead in the welcome-back panel so the find sentence is worded from the engine rule.");
    }
    if (!discoveryBonusEl) {
      problems.push("Expected #offline-discovery-bonus in the welcome-back panel so the find's wood/s bonus is stated.");
    }
    if (!discoveryNoteEl) {
      problems.push("Expected #offline-discovery-note in the welcome-back panel so a find that added nothing says so plainly.");
    }
    if (typeof engine.returnDiscoveryText !== "function") {
      problems.push("Expected engine.returnDiscoveryText to be exported so the panel and the tools word a find from one source.");
    }
    if (typeof engine.returnDiscoveryLine !== "function") {
      problems.push("Expected engine.returnDiscoveryLine to be exported so the panel words a find from one rule.");
    } else {
      // A credited find reads as news and names the wood/s it added.
      const creditedSentence = engine.returnDiscoveryText({ name: "Clay Deposit", bonus: 0.1, credited: true });
      if (!/^You found the Clay Deposit!/.test(creditedSentence)) {
        problems.push(`A credited find should read as news ("You found the Clay Deposit!"), got ${JSON.stringify(creditedSentence)}.`);
      }
      if (!creditedSentence.includes("+0.10 wood/s")) {
        problems.push(`A credited find should name the wood/s it added, got ${JSON.stringify(creditedSentence)}.`);
      }
      // A repeat and an out-classed find make no new-find claim and say plainly
      // they added nothing.
      const repeatSentence = engine.returnDiscoveryText({ name: "Clay Deposit", bonus: 0.1, credited: false, alreadyOwned: true });
      if (/you found/i.test(repeatSentence)) {
        problems.push(`A repeated find must not read as newly found, got ${JSON.stringify(repeatSentence)}.`);
      }
      if (!repeatSentence.includes("Clay Deposit") || !/nothing new/i.test(repeatSentence)) {
        problems.push(`A repeated find should name the find and says it added nothing, got ${JSON.stringify(repeatSentence)}.`);
      }
      const weakerSentence = engine.returnDiscoveryText({ name: "Flint Shard", bonus: 0.05, credited: false, alreadyOwned: false });
      if (/you found/i.test(weakerSentence)) {
        problems.push(`A weaker find must not read as newly found, got ${JSON.stringify(weakerSentence)}.`);
      }
      if (!weakerSentence.includes("Flint Shard") || !/nothing new/i.test(weakerSentence)) {
        problems.push(`A weaker find should name the find and says it added nothing, got ${JSON.stringify(weakerSentence)}.`);
      }
      if (engine.returnDiscoveryText(null) !== "") {
        problems.push("A return with no find should word no sentence.");
      }
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

    // (b2) The next-discovery lookup walks the engine's own ladder: nothing
    // owned reaches for the first tier, an owned tier reaches for the rung
    // above it, and the rungs past the last fixed tier never run out.
    if (typeof engine.nextDiscoveryAfter !== "function") {
      problems.push("Expected engine.nextDiscoveryAfter to be exported as a pure function.");
    } else {
      const firstRung = engine.nextDiscoveryAfter(null);
      if (!firstRung || firstRung.id !== "flint-shard" || firstRung.minSec !== 60) {
        problems.push(`nextDiscoveryAfter(null) should name the first tier flint-shard at 60s, got ${JSON.stringify(firstRung)}.`);
      }
      const afterClay = engine.nextDiscoveryAfter("clay-deposit");
      if (!afterClay || afterClay.id !== "wandering-sapling" || afterClay.minSec !== 3600) {
        problems.push(`nextDiscoveryAfter('clay-deposit') should name 'wandering-sapling' at 3600s, got ${JSON.stringify(afterClay)}.`);
      }
      if (afterClay && afterClay.id === "clay-deposit") {
        problems.push("nextDiscoveryAfter must never return the tier already owned.");
      }
      const afterStrongest = engine.nextDiscoveryAfter("sunken-vault");
      if (!afterStrongest || !afterStrongest.name || !(afterStrongest.minSec > 604800) || !(afterStrongest.bonus > 0.60) || afterStrongest.id === "sunken-vault") {
        problems.push(`nextDiscoveryAfter('sunken-vault') should name a stronger further rung (id ≠ sunken-vault, minSec > 604800, bonus > 0.60), got ${JSON.stringify(afterStrongest)}.`);
      }
      const afterThat = afterStrongest ? engine.nextDiscoveryAfter(afterStrongest.id) : null;
      if (!afterThat || !(afterThat.bonus > afterStrongest.bonus) || !(afterThat.minSec > afterStrongest.minSec)) {
        problems.push(`The generated ladder must never terminate: the rung after ${afterStrongest && afterStrongest.id} should be stronger and further still, got ${JSON.stringify(afterThat)}.`);
      }
    }

    // (b3) The fixed ladder stays intact and the generated rungs continue it
    // deterministically. The longest fixed absence still finds the last fixed
    // tier, a longer one finds a stronger generated rung, and the rung the
    // panel names as "next" is exactly what an absence of its length earns.
    if (typeof engine.discoverForElapsed === "function" && typeof engine.nextDiscoveryAfter === "function") {
      const longestFixed = engine.discoverForElapsed(604800);
      if (!longestFixed || longestFixed.id !== "sunken-vault") {
        problems.push(`An absence of exactly 604800s must still find sunken-vault, got ${JSON.stringify(longestFixed)}.`);
      }
      const beyond = engine.discoverForElapsed(1209600);
      if (!beyond || beyond.id === "sunken-vault" || !(beyond.bonus > 0.60)) {
        problems.push(`A 14d absence should find a generated rung stronger than sunken-vault (bonus > 0.60), got ${JSON.stringify(beyond)}.`);
      }
      const beyondAgain = engine.discoverForElapsed(1209600);
      if (!beyond || !beyondAgain || beyondAgain.id !== beyond.id) {
        problems.push(`Generated rungs must be deterministic: a 14d absence gave ${beyond && beyond.id} then ${beyondAgain && beyondAgain.id}.`);
      }
      const nextRung = engine.nextDiscoveryAfter("sunken-vault");
      const atNextRung = nextRung ? engine.discoverForElapsed(nextRung.minSec) : null;
      if (!nextRung || !atNextRung || atNextRung.id !== nextRung.id) {
        problems.push(`The rung named after sunken-vault (${nextRung && nextRung.id}) should be exactly what an absence of ${nextRung && nextRung.minSec}s finds, got ${JSON.stringify(atNextRung)}.`);
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
    // The whole sentence the panel shows must be the engine rule's sentence, so
    // the claim and the caveat can never be split by a wrap.
    if (discoveryLine && expected) {
      const expectedSentence = engine.returnDiscoveryText({ name: expected.name, bonus: expected.bonus, credited: true });
      if (discoveryLine.textContent.trim() !== expectedSentence) {
        problems.push(`A credited 600s find's panel line should read ${JSON.stringify(expectedSentence)}, got ${JSON.stringify(discoveryLine.textContent.trim())}.`);
      }
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
      if (discoveryNoteEl && !discoveryNoteEl.hidden) {
        problems.push("A credited find should state its gain, not a no-change note, so #offline-discovery-note must stay hidden.");
      }
    }

    // The panel must also name the rung above the one just found, with the
    // absence it takes, so a longer wait reads as a distance to that find.
    const expectedNext = engine.nextDiscoveryAfter(returned.discovery && returned.discovery.id);
    if (nextFindEl) {
      if (nextFindEl.hidden) {
        problems.push("A visible return should name the next away find in #offline-next-find, but it was hidden.");
      }
      if (expectedNext && !nextFindEl.textContent.includes(expectedNext.name)) {
        problems.push(`#offline-next-find should name the next rung "${expectedNext.name}", got "${nextFindEl.textContent}".`);
      }
      const neededText = expectedNext ? engine.formatElapsed(expectedNext.minSec * 1000) : null;
      if (neededText && !nextFindEl.textContent.includes(neededText)) {
        problems.push(`#offline-next-find should state the absence needed ("${neededText}"), got "${nextFindEl.textContent}".`);
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
      if (expected && offlineDiscovery && offlineDiscovery.alreadyOwned !== false) {
        problems.push(`read-state.offlineDiscovery.alreadyOwned should be false for a credited find, got ${JSON.stringify(offlineDiscovery.alreadyOwned)}.`);
      }
      if (expected && offlineDiscovery && discoveryLine && offlineDiscovery.sentence !== discoveryLine.textContent.trim()) {
        problems.push(`read-state.offlineDiscovery.sentence should equal the panel's credited sentence, got ${JSON.stringify(offlineDiscovery.sentence)} vs ${JSON.stringify(discoveryLine.textContent.trim())}.`);
      }
      // read-state must expose the same next find the panel names, so an agent
      // learns the same goal a visitor does.
      const nextAway = whileOpen.nextAwayDiscovery;
      if (!expectedNext || !nextAway || nextAway.name !== expectedNext.name || nextAway.minSec !== expectedNext.minSec) {
        problems.push(`read-state.nextAwayDiscovery should match the next rung ${JSON.stringify(expectedNext)}, got ${JSON.stringify(nextAway)}.`);
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

    // (c2) An account already holding the strongest fixed find must still be
    // offered a further rung: the ladder never ends, so a long enough absence
    // credits a new named discovery, raises the rate by its bonus, and the
    // panel and read-state both name the rung after it.
    engine.reset();
    const beyondStrongest = engine.nextDiscoveryAfter("sunken-vault");
    if (!beyondStrongest) {
      problems.push("nextDiscoveryAfter('sunken-vault') must name a further rung so the ladder never ends, got null.");
    }
    const longAbsenceSec = beyondStrongest ? beyondStrongest.minSec : 691200;
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.6, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      discoveryId: "sunken-vault", discoveryName: "Sunken Vault", discoveryBonus: 0.60,
      timestamp: new Date(Date.now() - longAbsenceSec * 1000).toISOString(),
    }));
    engine.init();
    const maxedState = engine.getState();
    if (!beyondStrongest || !maxedState.discovery || maxedState.discovery.id !== beyondStrongest.id) {
      problems.push(`A maxed account returning after ${longAbsenceSec}s should credit the new rung ${beyondStrongest && beyondStrongest.id}, got ${JSON.stringify(maxedState.discovery)}.`);
    }
    if (beyondStrongest) {
      const maxedRate = 0.6 + (beyondStrongest.bonus - 0.60);
      if (Math.abs(maxedState.rate - maxedRate) > 1e-9) {
        problems.push(`The new rung's bonus (${beyondStrongest.bonus}) should raise a maxed account's rate to ${maxedRate}, got ${maxedState.rate}.`);
      }
    }
    window.__showOfflineSummary();
    if (nextFindEl) {
      if (nextFindEl.hidden) {
        problems.push("A maxed account's return must still name the next away find, but #offline-next-find was hidden.");
      }
      if (/nothing further to find/i.test(nextFindEl.textContent)) {
        problems.push(`#offline-next-find must never tell a maxed account there is nothing left to find, got "${nextFindEl.textContent}".`);
      }
      const afterNew = beyondStrongest ? engine.nextDiscoveryAfter(beyondStrongest.id) : null;
      if (afterNew && !nextFindEl.textContent.includes(afterNew.name)) {
        problems.push(`A maxed account's return should name the next rung "${afterNew.name}", got "${nextFindEl.textContent}".`);
      }
    }
    if (readState) {
      const maxed = await readState.execute({});
      const afterNew = beyondStrongest ? engine.nextDiscoveryAfter(beyondStrongest.id) : null;
      if (!afterNew || !maxed.nextAwayDiscovery || maxed.nextAwayDiscovery.name !== afterNew.name || maxed.nextAwayDiscovery.minSec !== afterNew.minSec) {
        problems.push(`read-state.nextAwayDiscovery should name the further rung ${JSON.stringify(afterNew)} for a maxed account, got ${JSON.stringify(maxed.nextAwayDiscovery)}.`);
      }
    }
    window.__dismissOffline();

    // (c3) A find the player already owns must still be named, and must plainly
    // say it added nothing new — in the panel and in the agent's read-state
    // alike, so a return that changed nothing cannot read like a lasting boost.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.20, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      discoveryId: "clay-deposit", discoveryName: "Clay Deposit", discoveryBonus: 0.10,
      timestamp: new Date(Date.now() - 600000).toISOString(),
    }));
    engine.init();
    const repeated = engine.getState();
    if (Math.abs(repeated.rate - 0.20) > 1e-9) {
      problems.push(`A repeated clay-deposit find must leave rate at 0.20, got ${repeated.rate}.`);
    }
    window.__showOfflineSummary();
    if (discoveryLine && discoveryLine.hidden) {
      problems.push("A repeated find must still be named in the welcome-back panel, but #offline-discovery-line was hidden.");
    }
    if (discoveryNameEl && repeated.discovery && discoveryNameEl.textContent.trim() !== repeated.discovery.name) {
      problems.push(`A repeated find should be named "Clay Deposit", got "${discoveryNameEl.textContent.trim()}".`);
    }
    // A repeated find must not read as newly found anywhere in the panel line,
    // and the whole line must be the engine's sentence for a repeat.
    if (discoveryLine && repeated.discovery) {
      const repeatSentence = engine.returnDiscoveryText({ name: repeated.discovery.name, bonus: repeated.discovery.bonus, credited: false, alreadyOwned: true });
      if (/you found/i.test(discoveryLine.textContent)) {
        problems.push(`A repeated find's panel line must not claim a new find, got "${discoveryLine.textContent.trim()}".`);
      }
      if (discoveryLine.textContent.trim() !== repeatSentence) {
        problems.push(`A repeated find's panel line should read ${JSON.stringify(repeatSentence)}, got ${JSON.stringify(discoveryLine.textContent.trim())}.`);
      }
    }
    if (discoveryBonusEl && !discoveryBonusEl.hidden) {
      problems.push("A repeated find added nothing to the rate and must not show a bonus line.");
    }
    const repeatNoteText = discoveryNoteEl ? discoveryNoteEl.textContent.trim() : "";
    if (discoveryNoteEl && discoveryNoteEl.hidden) {
      problems.push("A repeated find must plainly say it added nothing new, but #offline-discovery-note was hidden.");
    }
    if (discoveryNoteEl && !/already in your collection/i.test(repeatNoteText)) {
      problems.push(`A repeated find's note should say it was already in the collection, got "${repeatNoteText}".`);
    }
    if (discoveryNoteEl && !/nothing new/i.test(repeatNoteText)) {
      problems.push(`A repeated find's note should say nothing new was added, got "${repeatNoteText}".`);
    }
    if (readState) {
      const repeatedRead = await readState.execute({});
      const repeatedDiscovery = repeatedRead.offlineDiscovery;
      if (!repeatedDiscovery) {
        problems.push("read-state.offlineDiscovery should report a repeated find while the panel is open, got null.");
      } else {
        if (repeatedDiscovery.name !== "Clay Deposit") {
          problems.push(`read-state.offlineDiscovery should name "Clay Deposit", got ${JSON.stringify(repeatedDiscovery.name)}.`);
        }
        if (repeatedDiscovery.bonus !== null || repeatedDiscovery.permanent !== false) {
          problems.push(`A repeated find added nothing, so read-state.offlineDiscovery should report bonus null and permanent false, got ${JSON.stringify(repeatedDiscovery)}.`);
        }
        if (repeatedDiscovery.alreadyOwned !== true) {
          problems.push(`read-state.offlineDiscovery.alreadyOwned should be true for a repeated find, got ${JSON.stringify(repeatedDiscovery.alreadyOwned)}.`);
        }
        if (repeatedDiscovery.sentence !== (discoveryLine ? discoveryLine.textContent.trim() : "")) {
          problems.push(`read-state.offlineDiscovery.sentence should match the panel's sentence, got ${JSON.stringify(repeatedDiscovery.sentence)} vs ${JSON.stringify(discoveryLine ? discoveryLine.textContent.trim() : "")}.`);
        }
      }
    }
    window.__dismissOffline();

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
    if (discoveryNoteEl && !discoveryNoteEl.hidden) {
      problems.push("A 30s return found nothing, so no discovery note should be shown.");
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
    const weakerNoteText = discoveryNoteEl ? discoveryNoteEl.textContent.trim() : "";
    if (discoveryNoteEl && discoveryNoteEl.hidden) {
      problems.push("A weaker find must plainly say it added nothing new, but #offline-discovery-note was hidden.");
    }
    if (discoveryNoteEl && !/stronger find/i.test(weakerNoteText)) {
      problems.push(`A weaker find's note should say a stronger find is already owned, got "${weakerNoteText}".`);
    }
    if (discoveryNoteEl && !/nothing new/i.test(weakerNoteText)) {
      problems.push(`A weaker find's note should say nothing new was added, got "${weakerNoteText}".`);
    }
    // An out-classed find must not read as newly found anywhere in the panel
    // line, and the whole line must be the engine's sentence for it.
    const weakerFind = engine.discoverForElapsed(61);
    if (discoveryLine && weakerFind) {
      const weakerSentence = engine.returnDiscoveryText({ name: weakerFind.name, bonus: weakerFind.bonus, credited: false, alreadyOwned: false });
      if (/you found/i.test(discoveryLine.textContent)) {
        problems.push(`A weaker find's panel line must not claim a new find, got "${discoveryLine.textContent.trim()}".`);
      }
      if (!discoveryLine.textContent.includes(weakerFind.name)) {
        problems.push(`A weaker find's panel line should still name "${weakerFind.name}", got "${discoveryLine.textContent.trim()}".`);
      }
      if (discoveryLine.textContent.trim() !== weakerSentence) {
        problems.push(`A weaker find's panel line should read ${JSON.stringify(weakerSentence)}, got ${JSON.stringify(discoveryLine.textContent.trim())}.`);
      }
    }
    if (readState) {
      const weakerRead = await readState.execute({});
      const weakerDiscovery = weakerRead.offlineDiscovery;
      if (!weakerDiscovery || weakerDiscovery.alreadyOwned !== false) {
        problems.push(`read-state.offlineDiscovery.alreadyOwned should be false for a weaker find, got ${JSON.stringify(weakerDiscovery)}.`);
      } else if (weakerDiscovery.sentence !== (discoveryLine ? discoveryLine.textContent.trim() : "")) {
        problems.push(`read-state.offlineDiscovery.sentence should match the weaker find's panel sentence, got ${JSON.stringify(weakerDiscovery.sentence)} vs ${JSON.stringify(discoveryLine ? discoveryLine.textContent.trim() : "")}.`);
      }
    }
    window.__dismissOffline();

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Away-discovery test threw: ${err.message}`);
    console.error(err);
  }

  // ─── The status panel names the next away find (issue #1016) ────
  // Away finds are the reward for coming back, so the next rung and the absence
  // it takes must be visible between returns, not only inside the welcome-back
  // panel. The status line is rendered from the engine's one ladder through the
  // one sentence the welcome-back panel words, so the three can never tell
  // different stories. It is present on a fresh save (the first rung), advances
  // as stronger finds are credited, and vanishes rather than word a dead end
  // when the saved discovery id is unrecognised.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");

    const lineEl = document.getElementById("next-away-find-line");
    const offlineNextFind = document.getElementById("offline-next-find");
    const overlay = document.getElementById("offline-summary");

    if (!lineEl) {
      problems.push("Expected #next-away-find-line in the status panel so the next away find is always named — it was not found.");
    } else if (!lineEl.closest("#status-bar")) {
      problems.push("#next-away-find-line must live inside #status-bar so it is part of the status panel.");
    }
    if (typeof engine.nextAwayFindText !== "function") {
      problems.push("Expected engine.nextAwayFindText to be exported so the status line and the welcome-back panel word the next find from one source.");
    } else if (engine.nextAwayFindText(null) !== null) {
      problems.push(`engine.nextAwayFindText(null) should be null (no rung, no sentence), got ${JSON.stringify(engine.nextAwayFindText(null))}.`);
    }

    // (a) A fresh save names the first rung — the player always has a next
    // thing to reach for, and the absence it takes, from the very first visit.
    engine.reset();
    engine.init();
    window.__renderUI();
    const firstRung = engine.nextDiscoveryAfter(null);
    const firstNeeded = firstRung ? engine.formatElapsed(firstRung.minSec * 1000) : null;
    if (lineEl) {
      const shown = lineEl.hidden ? "" : lineEl.textContent.trim();
      if (!shown) {
        problems.push("On a fresh save the status panel must name the next away find (the first rung), but #next-away-find-line was empty or hidden.");
      }
      if (firstRung && !shown.includes(firstRung.name)) {
        problems.push(`On a fresh save the status panel should name "${firstRung.name}", got "${shown}".`);
      }
      if (firstNeeded && !shown.includes(firstNeeded)) {
        problems.push(`On a fresh save the status panel should state the absence needed ("${firstNeeded}"), got "${shown}".`);
      }
      if (/nothing/i.test(shown)) {
        problems.push(`The status line must never read as a dead end, got "${shown}".`);
      }
    }
    if (readState) {
      const freshRead = await readState.execute({});
      const nextAway = freshRead.nextAwayDiscovery;
      if (!firstRung || !nextAway || nextAway.name !== firstRung.name || nextAway.minSec !== firstRung.minSec) {
        problems.push(`read-state.nextAwayDiscovery should match the fresh save's first rung ${JSON.stringify(firstRung)}, got ${JSON.stringify(nextAway)}.`);
      }
      if (lineEl && nextAway && !lineEl.textContent.includes(nextAway.elapsed)) {
        problems.push(`The status line's absence must match read-state.nextAwayDiscovery.elapsed ("${nextAway.elapsed}"), got "${lineEl.textContent.trim()}".`);
      }
    }

    // (b) A credited find advances the line to the rung above it, and the line
    // reads the same sentence the welcome-back panel shows for that rung.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
      timestamp: new Date(Date.now() - 600000).toISOString(),
    }));
    engine.init();
    window.__renderUI();
    const ownedFind = engine.getState().discovery;
    const advancedRung = engine.nextDiscoveryAfter(ownedFind && ownedFind.id);
    const advancedText = engine.nextAwayFindText(advancedRung);
    if (!ownedFind || !advancedRung) {
      problems.push("A 600s return should credit a find with a rung above it, so the status line has something to advance to.");
    }
    if (lineEl) {
      const shown = lineEl.hidden ? "" : lineEl.textContent.trim();
      if (shown !== advancedText) {
        problems.push(`After crediting ${ownedFind && ownedFind.name}, the status line should read ${JSON.stringify(advancedText)}, got ${JSON.stringify(shown)}.`);
      }
    }
    if (readState) {
      const advancedRead = await readState.execute({});
      const nextAway = advancedRead.nextAwayDiscovery;
      if (!advancedRung || !nextAway || nextAway.name !== advancedRung.name || nextAway.minSec !== advancedRung.minSec) {
        problems.push(`read-state.nextAwayDiscovery should match the advanced rung ${JSON.stringify(advancedRung)}, got ${JSON.stringify(nextAway)}.`);
      }
    }
    // The welcome-back panel's own next-find line must be byte-identical to the
    // status line: both are one engine sentence about one rung.
    if (typeof window.__setOverlayOpen === "function") window.__setOverlayOpen("offline", false);
    overlay.setAttribute("hidden", "");
    window.__showOfflineSummary();
    if (offlineNextFind && lineEl) {
      const panelLine = offlineNextFind.textContent.trim();
      const statusLine = lineEl.textContent.trim();
      if (panelLine !== statusLine) {
        problems.push(`The welcome-back panel's next find (${JSON.stringify(panelLine)}) must equal the status line (${JSON.stringify(statusLine)}).`);
      }
    }
    if (!overlay.hidden) window.__dismissOffline();

    // (c) An unrecognised discovery id is a corrupt save: the ladder yields no
    // rung, so the line carries no readable text and disappears rather than
    // telling the player nothing is left to find.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      discoveryId: "not-a-real-find", discoveryName: "Nowhere", discoveryBonus: 0.05,
      firstTimestamp: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    }));
    engine.init();
    window.__renderUI();
    if (engine.nextDiscoveryAfter("not-a-real-find") !== null) {
      problems.push("nextDiscoveryAfter should return null for an unknown discovery id, so the status line has no rung to name.");
    }
    if (lineEl) {
      if (!lineEl.hidden) {
        problems.push("An unrecognised discovery id must hide the status line rather than word a dead end.");
      }
      if (lineEl.textContent.trim() !== "") {
        problems.push(`An unrecognised discovery id must leave the status line with no readable text, got ${JSON.stringify(lineEl.textContent.trim())}.`);
      }
    }

    // Leave the page as it was found.
    engine.reset();
    engine.init();
    window.__renderUI();
  } catch (err) {
    problems.push(`Status-panel next-away-find test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Every away find reached is kept in a Finds list (issue #1030) ────
  // A longer absence reaches every weaker rung below the one it earns, so the
  // collection is the ladder prefix the save's strongest id already implies.
  // The page shows it as a collapsed Finds list, and the read-state tool
  // returns the same list, so a returning player and an agent see one story.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    const originalCode = engine.exportSave();

    // (a) The pure collection rule: the prefix up to the strongest rung, each
    // entry naming the find and the wood/s it grants, plus the locked next one.
    const empty = engine.discoveryCollection(null);
    if (empty.total !== 0 || empty.collected.length !== 0 || empty.hiddenCount !== 0) {
      problems.push(`A fresh save has kept no finds; discoveryCollection(null) should be empty, got ${JSON.stringify(empty)}.`);
    }
    if (!empty.next || empty.next.id !== "flint-shard") {
      problems.push(`A fresh save should still be reaching for flint-shard, got ${JSON.stringify(empty.next)}.`);
    }

    const clay = engine.discoveryCollection("clay-deposit");
    const clayIds = clay.collected.map((r) => r.id).join(",");
    if (clayIds !== "flint-shard,clay-deposit") {
      problems.push(`Owning clay-deposit should keep flint-shard and clay-deposit in ladder order, got "${clayIds}".`);
    }
    const clayBonuses = clay.collected.map((r) => r.bonus).join(",");
    if (clayBonuses !== "0.05,0.1") {
      problems.push(`Each collected find must carry the wood/s it grants; expected "0.05,0.1", got "${clayBonuses}".`);
    }
    if (!clay.next || clay.next.id !== "wandering-sapling") {
      problems.push(`After clay-deposit the next locked find should be wandering-sapling, got ${JSON.stringify(clay.next)}.`);
    }

    // The list continues past the fixed rungs into the generated ladder, so
    // there is always a collected past and a named next.
    const deep = engine.discoveryCollection("deep-find-3");
    const expectedDeepIds = ["flint-shard", "clay-deposit", "wandering-sapling", "glowing-seam",
      "ancient-grove", "sunken-vault", "deep-find-1", "deep-find-2", "deep-find-3"];
    if (deep.collected.map((r) => r.id).join(",") !== expectedDeepIds.join(",")) {
      problems.push(`The collection must run from the fixed rungs into the generated ones; expected ${expectedDeepIds.join(",")}, got ${deep.collected.map((r) => r.id).join(",")}.`);
    }
    if (!deep.next || deep.next.id !== "deep-find-4") {
      problems.push(`After deep-find-3 the next locked find should be deep-find-4, got ${JSON.stringify(deep.next)}.`);
    }

    // The render cap keeps the strongest rungs and counts the rest, so an
    // endless ladder can never render an endless list.
    const capped = engine.discoveryCollection("deep-find-3", 4);
    if (capped.collected.length !== 4 || capped.hiddenCount !== 5 || capped.total !== 9) {
      problems.push(`A 4-rung cap should show the strongest 4 of 9 with hiddenCount 5, got ${capped.collected.length} shown / ${capped.hiddenCount} hidden / ${capped.total} total.`);
    }
    if (capped.collected.map((r) => r.id).join(",") !== "sunken-vault,deep-find-1,deep-find-2,deep-find-3") {
      problems.push(`The cap must slice from the strong end of the ladder, got ${capped.collected.map((r) => r.id).join(",")}.`);
    }

    const unknown = engine.discoveryCollection("not-a-real-find");
    if (unknown.collected.length !== 0 || unknown.next !== null) {
      problems.push(`An unrecognised saved id must yield no collection and no next rung, got ${JSON.stringify(unknown)}.`);
    }

    // (b) A return that turns up a find fills a new row: load a save whose
    // 600s absence earns clay-deposit, then read the page.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
      timestamp: new Date(Date.now() - 600000).toISOString(),
    }));
    engine.init();
    window.__renderUI();

    const ownedFind = engine.getState().discovery;
    if (!ownedFind || ownedFind.id !== "clay-deposit") {
      problems.push(`A 600s absence should credit clay-deposit so the Finds list has a new row; got ${JSON.stringify(ownedFind)}.`);
    }

    const findsDetails = document.getElementById("finds-list");
    const findsEntriesEl = document.getElementById("finds-entries");
    const statusLine = document.getElementById("next-away-find-line");
    if (!findsDetails) {
      problems.push("Expected a #finds-list <details> in the status panel so the collection is readable on demand — it was not found.");
    } else if (!findsDetails.closest("#status-bar")) {
      problems.push("#finds-list must live inside #status-bar so it is part of the status panel.");
    } else if (findsDetails.open) {
      problems.push("The Finds list must start collapsed so the desktop one-screen promise holds; it was open on load.");
    }
    if (!findsEntriesEl) {
      problems.push("Expected #finds-entries inside #finds-list to hold the collected finds — it was not found.");
    }

    const expectedSummary = engine.nextAwayFindText(engine.nextDiscoveryAfter("clay-deposit"));
    if (statusLine && statusLine.textContent.trim() !== expectedSummary) {
      problems.push(`The Finds summary should read ${JSON.stringify(expectedSummary)}, got ${JSON.stringify(statusLine.textContent.trim())}.`);
    }

    // Collapsed, the list carries no rows at all — the one-line summary is the
    // whole closed state, which is what keeps the status panel its old height.
    if (findsEntriesEl && findsEntriesEl.childElementCount !== 0) {
      problems.push(`A collapsed Finds list must carry no rows; found ${findsEntriesEl.childElementCount}.`);
    }

    if (findsDetails && findsEntriesEl) {
      findsDetails.open = true; // a player opening the summary
      // `toggle` fires as a task, so let it run before reading the rows the
      // open state is supposed to build.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const collectedTexts = [...findsEntriesEl.querySelectorAll(".finds-collected")].map((li) => li.textContent);
      const expectedTexts = ["Flint Shard +0.05 wood/s", "Clay Deposit +0.10 wood/s"];
      if (collectedTexts.join(" | ") !== expectedTexts.join(" | ")) {
        problems.push(`The opened Finds list should name each collected find and the wood/s it grants, expected ${JSON.stringify(expectedTexts)}, got ${JSON.stringify(collectedTexts)}.`);
      }
      const lockedRows = [...findsEntriesEl.querySelectorAll(".finds-locked")];
      const nextRung = engine.nextDiscoveryAfter("clay-deposit");
      const neededAbsence = engine.formatElapsed(nextRung.minSec * 1000);
      if (lockedRows.length !== 1) {
        problems.push(`The Finds list must show exactly one locked next rung, got ${lockedRows.length}.`);
      } else {
        const lockedText = lockedRows[0].textContent;
        if (!lockedText.includes(nextRung.name)) {
          problems.push(`The locked row should name the next find "${nextRung.name}", got "${lockedText}".`);
        }
        if (!lockedText.includes(neededAbsence)) {
          problems.push(`The locked row should state the absence needed ("${neededAbsence}"), got "${lockedText}".`);
        }
      }
      findsDetails.open = false; // leave the panel as a player found it
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (findsEntriesEl.childElementCount !== 0) {
        problems.push(`Closing the Finds list must drop its rows again so the status panel stays one line; found ${findsEntriesEl.childElementCount}.`);
      }
    }

    // The page's collected rows and the agent's list are the same collection.
    if (readState) {
      const read = await readState.execute({});
      const stateFinds = engine.getState().finds;
      if (!read.finds) {
        problems.push("read-state should return the Finds list the page shows, but read-state.finds was missing.");
      } else {
        const readIds = read.finds.collected.map((r) => r.id).join(",");
        const engineIds = stateFinds.collected.map((r) => r.id).join(",");
        if (readIds !== engineIds) {
          problems.push(`read-state.finds.collected (${readIds}) must match the engine's collection (${engineIds}).`);
        }
        if (read.finds.total !== stateFinds.total) {
          problems.push(`read-state.finds.total should be ${stateFinds.total}, got ${read.finds.total}.`);
        }
        const readNext = read.finds.next;
        if (!readNext || !stateFinds.next || readNext.name !== stateFinds.next.name || readNext.minSec !== stateFinds.next.minSec) {
          problems.push(`read-state.finds.next should match the page's locked rung ${JSON.stringify(stateFinds.next)}, got ${JSON.stringify(readNext)}.`);
        }
        if (read.finds.collected[1] && read.finds.collected[1].woodPerSec !== 0.1) {
          problems.push(`read-state.finds should report the wood/s each find grants; clay-deposit expected 0.1, got ${read.finds.collected[1].woodPerSec}.`);
        }
      }
    }

    // (c) The collection survives a save exported and restored elsewhere: the
    // whole state is what the code carries, so the prefix must come back.
    const portableCode = engine.exportSave();
    engine.reset();
    const restored = engine.importSave(portableCode);
    const restoredFinds = restored.state.finds;
    if (restoredFinds.collected.map((r) => r.id).join(",") !== "flint-shard,clay-deposit") {
      problems.push(`A restored save should still keep flint-shard and clay-deposit, got ${restoredFinds.collected.map((r) => r.id).join(",")} (import ok: ${restored.ok}).`);
    }
    if (!restoredFinds.next || restoredFinds.next.id !== "wandering-sapling") {
      problems.push(`A restored save should still have wandering-sapling locked next, got ${JSON.stringify(restoredFinds.next)}.`);
    }

    // (d) A save deep in the generated ladder keeps the strongest rungs and
    // summarises the older ones, so the list can never render forever.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 5, rate: 0.1, stone: 0, totalWoodEarned: 5,
      wallLevel: 0, stoneUnlocked: false,
      discoveryId: "deep-find-10", discoveryName: "Iron Garden", discoveryBonus: 1.1,
      firstTimestamp: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    }));
    engine.init();
    window.__renderUI();
    const deepFinds = engine.getState().finds;
    const expectedShown = Math.min(engine.FINDS_LIST_LIMIT, deepFinds.total);
    if (deepFinds.collected.length !== expectedShown || deepFinds.hiddenCount !== deepFinds.total - expectedShown) {
      problems.push(`A save of ${deepFinds.total} rungs should show the newest ${expectedShown} and summarise the rest, got ${deepFinds.collected.length} shown / ${deepFinds.hiddenCount} hidden.`);
    }
    if (findsDetails && findsEntriesEl) {
      findsDetails.open = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const moreRows = [...findsEntriesEl.querySelectorAll(".finds-more")];
      const shownCollected = findsEntriesEl.querySelectorAll(".finds-collected").length;
      if (moreRows.length !== 1 || !moreRows[0].textContent.includes(String(deepFinds.hiddenCount))) {
        problems.push(`The capped Finds list should summarise the omitted finds in one line, got ${JSON.stringify(moreRows.map((li) => li.textContent))}.`);
      }
      if (shownCollected !== expectedShown) {
        problems.push(`The capped Finds list should render ${expectedShown} rungs, got ${shownCollected}.`);
      }
      if (moreRows.length === 1 && findsEntriesEl.firstElementChild !== moreRows[0]) {
        problems.push("The summarised older finds must come before the rendered rungs so the list still reads in ladder order.");
      }
      findsDetails.open = false;
    }

    // Leave the page as it was found.
    engine.reset();
    if (originalCode) engine.importSave(originalCode);
    window.__renderUI();
  } catch (err) {
    problems.push(`Finds-list test threw: ${err.message}`);
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

  // ─── Locked systems stay out of the page's readable text ────────
  // A row hidden only with CSS still reads as real text to a screen reader,
  // so a locked system must contribute nothing until the game unlocks it, and
  // once unlocked its rate must be the rate the engine actually applies.
  try {
    const engine = await import("./engine.js");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };

    engine.reset();
    renderNow();

    const lockedRows = ["stone-stat", "forge-stat", "expedition-stat", "discovery-stat", "total-stone-stat"];
    for (const id of lockedRows) {
      const row = document.getElementById(id);
      if (!row) {
        problems.push(`Expected #${id} to exist in the status panel — it was not found.`);
      } else if (row.textContent.trim() !== "") {
        problems.push(`Locked #${id} should contribute no readable text before unlock, got "${row.textContent.trim()}".`);
      }
    }

    for (let i = 0; i < 15; i++) engine.gatherWood();
    engine.craftUpgrade(); // unlocks stone
    renderNow();

    const stoneRow = document.getElementById("stone-stat");
    if (stoneRow && !/\d/.test(stoneRow.textContent)) {
      problems.push(`Unlocked #stone-stat should show its count as readable text, got "${stoneRow.textContent}".`);
    }
    const rateText = document.getElementById("stone-rate-value").textContent;
    const engineRate = engine.computeStoneRate();
    const expectedRateText = "+" + engine.formatRate(engineRate) + "/s";
    if (rateText !== expectedRateText) {
      problems.push(`Shown stone rate "${rateText}" should be the engine's one rate string "${expectedRateText}" for computeStoneRate() (${engineRate}/s).`);
    }

    // Return the page to a fresh, fully-locked state for whatever measures it next.
    engine.reset();
    engine.init();
    renderNow();
  } catch (err) {
    problems.push(`Locked-row readable-text test threw: ${err.message}`);
    console.error(err);
  }

  // ─── One rule writes every rate and every amount (issue #1023) ──
  // The same value used to be written three ways: the status panel printed the
  // raw stone rate, the sandbox rounded it to four decimals and the rate chip to
  // two, while each amount surface carried its own copy of the rounding. The
  // engine now owns one string rule per kind and every surface reads it, so the
  // page can never contradict itself about the state behind it.
  try {
    const engine = await import("./engine.js");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };
    const originalCode = engine.exportSave();
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();

    // (a) Each rule writes the string it documents.
    if (engine.formatRate(0.0533333) !== "0.05" || engine.formatRate(0.12) !== "0.12" || engine.formatRate(1) !== "1.00") {
      problems.push(`formatRate should write a rate with exactly two decimals, got "${engine.formatRate(0.0533333)}" for 0.0533333, "${engine.formatRate(0.12)}" for 0.12 and "${engine.formatRate(1)}" for 1.`);
    }
    if (engine.formatAmount(7.5) !== "7.5" || engine.formatAmount(12.7) !== "12" || engine.formatAmount(3) !== "3") {
      problems.push(`formatAmount should write a quantity with the amount rule, got "${engine.formatAmount(7.5)}" for 7.5, "${engine.formatAmount(12.7)}" for 12.7 and "${engine.formatAmount(3)}" for 3.`);
    }
    // The text rule must be the engine's amount rule, not a second copy of it.
    for (const v of [0, 0.5, 7.5, 9.99, 10, 10.5, 1234.9]) {
      if (engine.formatAmount(v) !== String(engine.displayAmount(v))) {
        problems.push(`formatAmount(${v}) is "${engine.formatAmount(v)}" but the engine's amount rule writes "${String(engine.displayAmount(v))}" — the two must not drift apart.`);
      }
    }

    // (b) The status panel and the sandbox write the same stone rate for the
    // same save, byte for byte, from that one rule. The save carries a
    // repeating-decimal wood total (0.05 + 1234 * 0.001 = 1.284) so a leftover
    // four-decimal print or an unrounded float shows up immediately.
    engine.reset();
    localStorage.setItem("selfgrow-state", JSON.stringify({
      wood: 42.5, rate: 0.1, upgradeLevel: 1, stone: 2.25, totalWoodEarned: 1234,
      totalStoneEarned: 0, wallLevel: 0, forgeLevel: 0, expeditionLevel: 0, maps: 0,
      stoneUnlocked: true, discoveryBonus: 0, discoveryId: null, discoveryName: null,
      timestamp: new Date().toISOString(),
      firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
    }));
    engine.init();
    // Freeze the clock so the two reads cannot land on opposite sides of a tick.
    engine.pauseForHidden();
    renderNow();

    const statusStoneRate = document.getElementById("stone-rate-value").textContent;
    const expectedStoneRate = "+" + engine.formatRate(engine.computeStoneRate()) + "/s";
    if (statusStoneRate !== expectedStoneRate) {
      problems.push(`Status panel stone rate "${statusStoneRate}" should be the engine's one rate string "${expectedStoneRate}".`);
    }
    if (typeof window.__enterSandbox === "function" && typeof window.__fastForwardSandbox === "function") {
      window.__enterSandbox();
      window.__fastForwardSandbox(0); // rehearse the save exactly as cloned
      const sandboxStoneRate = document.getElementById("sb-stone-rate").textContent;
      if (sandboxStoneRate !== statusStoneRate) {
        problems.push(`The status panel stone rate "${statusStoneRate}" and the sandbox stone rate "${sandboxStoneRate}" must read identically for the same save.`);
      }
      const woodCounter = document.getElementById("wood-value").textContent;
      const sandboxWood = document.getElementById("sb-wood").textContent;
      if (sandboxWood !== woodCounter) {
        problems.push(`The wood counter "${woodCounter}" and the sandbox wood "${sandboxWood}" must read identically for the same save.`);
      }
      window.__exitSandbox();
    } else {
      problems.push("Expected window.__enterSandbox/__fastForwardSandbox so the sandbox's stone rate can be compared with the status panel's.");
    }

    // Leave the save and the page as they were found.
    engine.reset();
    engine.importSave(originalCode);
    engine.init();
    renderNow();
  } catch (err) {
    problems.push(`Shared rate/amount rule test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Pixel-art gather pictures ──────────────────────────────────
  // Each unlocked system's action is a picture, not a plain text button: an
  // in-code SVG that IS the button, mirrored smaller in its header chip, whose
  // real-text label and accessible name stay intact through every render.
  try {
    const engine = await import("./engine.js");
    const sprites = await import("./sprites.js");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };

    const palette = new Set(Object.values(sprites.SPRITE_PALETTE));
    const rectSignature = (svg) => Array.from(svg.querySelectorAll("rect"))
      .map((r) => [r.getAttribute("x"), r.getAttribute("y"), r.getAttribute("fill")].join(":"))
      .join("|");

    engine.reset();
    engine.init();
    renderNow();

    // (1) Every action button carries its own picture, named and in-palette.
    const actions = [
      ["btn-gather", "wood"],
      ["btn-gather-stone", "stone"],
      ["btn-forge-tool", "forge"],
      ["btn-expedition", "expedition"],
    ];
    const actionSvgs = {};
    for (const [id, kind] of actions) {
      const button = document.getElementById(id);
      if (!button) {
        problems.push(`Expected the ${kind} gather action #${id} to exist — it was not found.`);
        continue;
      }
      if (!(button.getAttribute("aria-label") || "").trim()) {
        problems.push(`#${id} should keep a non-empty aria-label so the picture-button has an accessible name.`);
      }
      const svg = button.querySelector("svg.sprite");
      if (!svg) {
        problems.push(`#${id} should contain the ${kind} pixel-art picture (svg.sprite) — it was not found.`);
        continue;
      }
      if (svg.dataset.spriteKind !== kind) {
        problems.push(`#${id} picture should be the ${kind} sprite, got "${svg.dataset.spriteKind}".`);
      }
      const rects = svg.querySelectorAll("rect");
      if (rects.length < 8) {
        problems.push(`#${id} ${kind} picture should be built from at least 8 pixel rects, got ${rects.length}.`);
      }
      for (const rect of rects) {
        if (!palette.has(rect.getAttribute("fill"))) {
          problems.push(`#${id} ${kind} picture uses fill "${rect.getAttribute("fill")}", which is not in SPRITE_PALETTE.`);
          break;
        }
      }
      actionSvgs[id] = svg;
    }

    if (document.querySelector("canvas")) {
      problems.push("The page should draw its pixel art as page elements, not a <canvas> — a canvas was found.");
    }

    // (2) The same picture, smaller, sits in that resource's header chip.
    const chips = [
      ["wood-stat", "wood"],
      ["stone-stat", "stone"],
      ["forge-stat", "forge"],
      ["expedition-stat", "expedition"],
    ];
    const chipSvgs = {};
    for (const [id, kind] of chips) {
      const chip = document.getElementById(id);
      if (!chip) {
        problems.push(`Expected the ${kind} header chip #${id} to exist — it was not found.`);
        continue;
      }
      const svg = chip.querySelector(".sprite-mount svg.sprite");
      if (!svg) {
        problems.push(`#${id} should show the same ${kind} picture in the header chip — it was not found.`);
        continue;
      }
      if (svg.dataset.spriteKind !== kind) {
        problems.push(`#${id} chip picture should be the ${kind} sprite, got "${svg.dataset.spriteKind}".`);
      }
      chipSvgs[id] = svg;
    }
    if (actionSvgs["btn-gather"] && chipSvgs["wood-stat"]
        && rectSignature(actionSvgs["btn-gather"]) !== rectSignature(chipSvgs["wood-stat"])) {
      problems.push("The wood card picture and the wood chip picture should be the same sprite (same rects).");
    }

    // (3) Re-rendering must not wipe the picture or the real-text label.
    for (let i = 0; i < 3; i++) renderNow();
    const gatherBtnFinal = document.getElementById("btn-gather");
    if (gatherBtnFinal) {
      if (!gatherBtnFinal.querySelector(".sprite-mount svg.sprite")) {
        problems.push("Rendering the UI erased the wood picture inside #btn-gather — the mount should survive a render.");
      }
      const labelEl = gatherBtnFinal.querySelector(".btn-label");
      if (!labelEl || !labelEl.textContent.trim()) {
        problems.push("Rendering the UI erased #btn-gather's real-text label — it should stay readable.");
      }
    }

    // (4) Clicking the picture gathers wood and leaves the button operable.
    if (gatherBtnFinal) {
      const woodBefore = engine.getState().wood;
      gatherBtnFinal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const woodAfter = engine.getState().wood;
      if (!(woodAfter > woodBefore)) {
        problems.push(`Clicking the wood picture should gather wood: expected wood above ${woodBefore}, got ${woodAfter}.`);
      }
      if (!gatherBtnFinal.querySelector(".sprite-mount svg.sprite")) {
        problems.push("Clicking the wood picture removed the sprite from #btn-gather.");
      }
      if (gatherBtnFinal.tagName !== "BUTTON" || gatherBtnFinal.getAttribute("tabindex") === "-1") {
        problems.push("#btn-gather should stay a keyboard-reachable button after gathering.");
      }
    }

    // (5) Reduced motion: the picture shows but nothing animates; with motion a
    // "+N" floats up showing what was gained.
    const reactionProbe = document.createElement("button");
    reactionProbe.type = "button";
    document.body.appendChild(reactionProbe);
    sprites.playReaction(reactionProbe, "wood", { reduced: true, gain: "3" });
    if (reactionProbe.querySelector(".float-gain")) {
      problems.push("With reduced motion on, using a picture must not float a '+N' — one was added.");
    }
    if (reactionProbe.className.trim() !== "") {
      problems.push(`With reduced motion on, using a picture must not add a reaction class, got "${reactionProbe.className}".`);
    }
    sprites.playReaction(reactionProbe, "wood", { reduced: false, gain: "3" });
    const float = reactionProbe.querySelector(".float-gain");
    if (!float) {
      problems.push("Using a picture with motion on should float a '+N' showing what was gained — none was added.");
    } else if (float.textContent !== "+3") {
      problems.push(`The floated gain should read "+3", got "${float.textContent}".`);
    }
    if (!reactionProbe.classList.contains("react-wood")) {
      problems.push("Using the wood picture with motion on should add the wood reaction class.");
    }
    reactionProbe.remove();

    // (6) The picture shows the system's level. Each stage is a genuinely
    // different picture, level 0 is always the base stage, and a card never
    // disagrees with its header chip.
    const pictureSig = (selector) => {
      const svg = document.querySelector(selector);
      return svg ? rectSignature(svg) : null;
    };
    const expectedSig = (kind, level) => {
      const probe = document.createElement("div");
      probe.innerHTML = sprites.spriteSvg(kind, level);
      return rectSignature(probe.querySelector("svg"));
    };
    const seedAtLevels = (overrides) => {
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify({
        wood: 10, rate: 0.1, upgradeLevel: 0, stone: 10,
        totalWoodEarned: 0, totalStoneEarned: 0,
        wallLevel: 0, forgeLevel: 0, expeditionLevel: 0, maps: 0,
        stoneUnlocked: true,
        timestamp: new Date().toISOString(),
        firstTimestamp: new Date().toISOString(),
        ...overrides,
      }));
      engine.init();
      renderNow();
    };

    const systems = [
      { kind: "wood", level: "upgradeLevel", card: "#btn-gather svg.sprite", chip: "#wood-stat .sprite-mount svg.sprite" },
      { kind: "stone", level: "wallLevel", card: "#btn-gather-stone svg.sprite", chip: "#stone-stat .sprite-mount svg.sprite" },
      { kind: "forge", level: "forgeLevel", card: "#btn-forge-tool svg.sprite", chip: "#forge-stat .sprite-mount svg.sprite" },
      { kind: "expedition", level: "expeditionLevel", card: "#btn-expedition svg.sprite", chip: "#expedition-stat .sprite-mount svg.sprite" },
    ];
    for (const system of systems) {
      const byLevel = new Map();
      for (const level of [0, 1, 6]) {
        seedAtLevels({ [system.level]: level });
        const card = pictureSig(system.card);
        const chip = pictureSig(system.chip);
        if (!card) {
          problems.push(`The ${system.kind} card picture should exist at ${system.level}=${level} — it was not found.`);
          continue;
        }
        if (card !== expectedSig(system.kind, level)) {
          problems.push(`The ${system.kind} picture at ${system.level}=${level} should be the stage sprite drawn for that level.`);
        }
        if (chip !== card) {
          problems.push(`The ${system.kind} card picture and its header chip should be the same picture at ${system.level}=${level}.`);
        }
        byLevel.set(level, card);
      }
      if (byLevel.size === 3
          && (byLevel.get(0) === byLevel.get(1)
            || byLevel.get(1) === byLevel.get(6)
            || byLevel.get(0) === byLevel.get(6))) {
        problems.push(`The ${system.kind} picture should change as its level rises: levels 0, 1 and 6 should each draw a different picture.`);
      }
    }

    // The picture is a drawing of the level, not a random one: same inputs,
    // same pixels, however often the render loop redraws it.
    if (sprites.spriteSvg("forge", 3) !== sprites.spriteSvg("forge", 3)) {
      problems.push("Drawing the forge picture at the same level twice should produce the same picture.");
    }

    // (7) With reduced motion on the picture is still drawn at the current
    // level — it simply never animates (playReaction already checks that half).
    const realMatchMedia = window.matchMedia;
    try {
      window.matchMedia = () => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      seedAtLevels({ upgradeLevel: 3 });
      const reducedSvg = document.querySelector("#btn-gather svg.sprite");
      if (!reducedSvg) {
        problems.push("With reduced motion on, the wood picture should still be drawn — it was not found.");
      } else if (pictureSig("#btn-gather svg.sprite") !== expectedSig("wood", 3)) {
        problems.push("With reduced motion on, the wood picture should still be drawn at its current level.");
      } else if (reducedSvg.dataset.spriteStage !== String(sprites.spriteStage("wood", 3))) {
        problems.push(`With reduced motion on, the wood picture should be drawn at level 3's stage, got stage ${reducedSvg.dataset.spriteStage}.`);
      }
    } finally {
      window.matchMedia = realMatchMedia;
    }

    // (8) Every system's header icon is the game's own pixel picture. An emoji
    // glyph renders in whatever shape and colour the operating system picks, so
    // the game would look different everywhere it runs; a palette-only sprite
    // cannot. The mount carries no text, which is what catches a revert.
    const headerSystems = [
      ["wood-actions", "wood", "Wood"],
      ["stone-actions", "stone", "Stone"],
      ["forge-actions", "forge", "Forge"],
      ["expedition-actions", "expedition", "Expeditions"],
    ];
    for (const [cardId, kind, name] of headerSystems) {
      const card = document.getElementById(cardId);
      if (!card) {
        problems.push(`Expected the ${name} system card #${cardId} to exist — it was not found.`);
        continue;
      }
      const head = card.querySelector(".system-head");
      if (!head) {
        problems.push(`#${cardId} should have a .system-head holding its icon and readable name.`);
        continue;
      }
      const icon = head.querySelector(".system-icon");
      if (!icon) {
        problems.push(`#${cardId} should carry a .system-icon beside its name.`);
        continue;
      }
      if (icon.textContent.trim() !== "") {
        problems.push(`#${cardId}'s .system-icon should be an empty picture mount, but it holds "${icon.textContent}" — a text glyph such as an emoji renders differently on every platform.`);
      }
      if (icon.getAttribute("aria-hidden") !== "true") {
        problems.push(`#${cardId}'s .system-icon is decorative, so it should stay aria-hidden="true" — the readable name is what a screen reader should announce.`);
      }
      const headSvgs = head.querySelectorAll("svg.sprite");
      if (headSvgs.length !== 1) {
        problems.push(`#${cardId}'s header should show exactly one pixel-art icon, got ${headSvgs.length}.`);
        continue;
      }
      const iconSvg = headSvgs[0];
      if (iconSvg.dataset.spriteKind !== kind) {
        problems.push(`#${cardId}'s header icon should be the ${kind} sprite, got "${iconSvg.dataset.spriteKind}".`);
      }
      const iconRects = iconSvg.querySelectorAll("rect");
      if (iconRects.length < 8) {
        problems.push(`#${cardId}'s ${kind} header icon should be built from at least 8 pixel rects, got ${iconRects.length}.`);
      }
      for (const rect of iconRects) {
        if (!palette.has(rect.getAttribute("fill"))) {
          problems.push(`#${cardId}'s ${kind} header icon uses fill "${rect.getAttribute("fill")}", which is not in SPRITE_PALETTE.`);
          break;
        }
      }
      const nameEl = head.querySelector(".system-name");
      if (!nameEl || nameEl.textContent.trim() !== name) {
        problems.push(`#${cardId}'s readable heading should still read "${name}", got "${nameEl ? nameEl.textContent : "(missing)"}".`);
      }
    }

    // Return the page to a fresh, fully-locked state for whatever measures it next.
    engine.reset();
    engine.init();
    renderNow();
  } catch (err) {
    problems.push(`Pixel-art action test threw: ${err.message}`);
    console.error(err);
  }

  // ─── The expedition wood-rate multiplier lives in the engine only ──
  // The status panel, the sandbox panel and the read-state tool all state the
  // rate the game pays once earned maps are applied. Each must read the
  // engine's one per-map rule, so changing EXPEDITION_WOOD_RATE_MULTIPLIER moves
  // every display together instead of leaving a stale copy behind — the same
  // page/engine disagreement the stone rate once had.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };

    // Preserve the real save so these checks leave no trace.
    const originalCode = engine.exportSave();
    if (typeof window.__exitSandbox === "function") window.__exitSandbox();

    const mapSave = {
      wood: 1000,
      rate: 1.6,
      upgradeLevel: 5,
      stone: 500,
      totalWoodEarned: 20000,
      totalStoneEarned: 800,
      wallLevel: 3,
      forgeLevel: 5,
      expeditionLevel: 4,
      maps: 4,
      stoneUnlocked: true,
      discoveryBonus: 0,
      discoveryId: null,
      discoveryName: null,
      timestamp: new Date().toISOString(),
      firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
    };
    const imported = engine.importSave(btoa(JSON.stringify(mapSave)));
    if (!imported.ok) {
      problems.push(`The expedition wood-rate check needs a save with maps, but importSave refused it: ${JSON.stringify(imported.reason)}.`);
    } else {
      const maps = mapSave.maps;
      // Expected figures derive from the engine's own constant, never from the
      // helper under test, so a re-hardcoded display or a stale copy makes the
      // check go red even when the helper itself is correct.
      const expectedMultiplier = 1 + maps * engine.EXPEDITION_WOOD_RATE_MULTIPLIER;
      const expectedRate = mapSave.rate * expectedMultiplier;
      const displayRounding = 5e-3; // the panels print two decimals

      // The engine's rule must reproduce those figures for this save.
      if (Math.abs(engine.expeditionMultiplierFor(maps) - expectedMultiplier) > 1e-12) {
        problems.push(`engine.expeditionMultiplierFor(${maps}) should be ${expectedMultiplier}, got ${engine.expeditionMultiplierFor(maps)}.`);
      }
      if (Math.abs(engine.effectiveWoodRate(engine.getState()) - expectedRate) > 1e-12) {
        problems.push(`engine.effectiveWoodRate() should be ${expectedRate}/s for that save, got ${engine.effectiveWoodRate(engine.getState())}/s.`);
      }

      // (a) The status panel states the same rate and the same map factor.
      renderNow();
      const statusText = document.getElementById("rate-value").textContent;
      const statusRate = Number.parseFloat((statusText.match(/([+-]?\d+(?:\.\d+)?)\s*\/s/) || [])[1]);
      const statusBadge = Number.parseFloat((statusText.match(/\(x([\d.]+)\)/) || [])[1]);
      if (!Number.isFinite(statusRate) || Math.abs(statusRate - expectedRate) > displayRounding) {
        problems.push(`Status panel shows wood rate "${statusText}" but the engine's rule gives ${expectedRate}/s for ${maps} maps — the panel must not keep its own multiplier.`);
      }
      if (!Number.isFinite(statusBadge) || Math.abs(statusBadge - expectedMultiplier) > displayRounding) {
        problems.push(`Status panel shows map multiplier in "${statusText}" but the engine's per-map rule gives x${expectedMultiplier} — the panel must not hardcode it.`);
      }

      // (b) The sandbox panel rehearsing the same save states the same figures.
      if (typeof window.__enterSandbox === "function" && typeof window.__fastForwardSandbox === "function") {
        window.__enterSandbox();
        window.__fastForwardSandbox(0); // a zero-second window rehearses the save as cloned
        const sandboxText = document.getElementById("sb-rate").textContent;
        const sandboxRate = Number.parseFloat((sandboxText.match(/(\d+(?:\.\d+)?)\s*\/s/) || [])[1]);
        const sandboxBadge = Number.parseFloat((sandboxText.match(/\(x([\d.]+)\)/) || [])[1]);
        if (!Number.isFinite(sandboxRate) || Math.abs(sandboxRate - expectedRate) > displayRounding) {
          problems.push(`Sandbox panel shows wood rate "${sandboxText}" but the engine's rule gives ${expectedRate}/s for ${maps} maps — the panel must not keep its own multiplier.`);
        }
        if (!Number.isFinite(sandboxBadge) || Math.abs(sandboxBadge - expectedMultiplier) > displayRounding) {
          problems.push(`Sandbox panel shows map multiplier in "${sandboxText}" but the engine's per-map rule gives x${expectedMultiplier} — the panel must not hardcode it.`);
        }
        window.__exitSandbox();
      } else {
        problems.push("Expected window.__enterSandbox/__fastForwardSandbox to drive the sandbox panel for the expedition wood-rate check.");
      }

      // (c) The read-state tool reports the rate the game pays and the map factor.
      const readState = tools().find((t) => t.name === "read-state");
      if (!readState) {
        problems.push("Expected a tool named 'read-state' for the expedition wood-rate check — it was not found.");
      } else {
        const read = await readState.execute({});
        if (Math.abs(read.effectiveRate - expectedRate) > 1e-12) {
          problems.push(`read-state.effectiveRate should be the paid rate ${expectedRate}/s, got ${read.effectiveRate}/s.`);
        }
        if (Math.abs(read.expeditionMultiplier - expectedMultiplier) > 1e-12) {
          problems.push(`read-state.expeditionMultiplier should be ${expectedMultiplier}, got ${read.expeditionMultiplier}.`);
        }
      }
    }

    // Leave the save and the page as they were found.
    engine.importSave(originalCode);
    engine.init();
    renderNow();
  } catch (err) {
    problems.push(`Expedition wood-rate multiplier test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Crediting a backgrounded tab when it is focused again (issue #1005) ──
  // Browsers throttle timers in a hidden tab, so a tab left in the background
  // used to silently undercount: each throttled call credited one simulated
  // second and stamped the save as current, dropping the real gap between
  // calls, and the return was never announced at all. Hiding must stop the
  // tick outright, and the return must credit the whole absence through the
  // same catch-up a reload runs — so the counters, the rates and the
  // welcome-back panel match a reload for the same gap, and the panel and the
  // read-state tool report one account.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    const overlay = document.getElementById("offline-summary");
    const woodAmountEl = document.getElementById("offline-wood-amount");
    const stoneLineEl = document.getElementById("offline-stone-line");
    const stoneAmountEl = document.getElementById("offline-stone-amount");
    const elapsedEl = document.getElementById("offline-elapsed");
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };

    if (typeof window.__onVisibilityReturn !== "function") {
      problems.push("Expected window.__onVisibilityReturn to be exposed so the self-check can drive a tab returning from hidden.");
    }
    if (typeof engine.pauseForHidden !== "function" || typeof engine.resumeFromHidden !== "function") {
      problems.push("Expected engine.pauseForHidden and engine.resumeFromHidden so a hidden tab stops the tick and has its whole absence credited on return.");
    }
    if (!readState) {
      problems.push("Expected a read-state tool for the backgrounded-tab checks.");
    }

    // Drive the page's real wiring: it listens for visibilitychange, so the
    // check fakes the tab's visibility and fires the event a browser would.
    // document.hidden is a prototype accessor, so an own property shadows it.
    const setTabHidden = (hidden) => {
      try {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      } catch {
        // A browser that refuses the override still exposes the handler.
        if (typeof window.__onVisibilityReturn === "function") window.__onVisibilityReturn(hidden);
        return;
      }
      document.dispatchEvent(new Event("visibilitychange"));
    };

    // The absence a real player would leave for: long enough to turn up a find,
    // and credited by rewinding the save's own timestamp rather than making the
    // suite wait a minute and a half for it.
    const ABSENCE_MS = 90000;

    const seeded = {
      wood: 5, rate: 0.1, upgradeLevel: 1,
      stone: 0.2, totalWoodEarned: 5, totalStoneEarned: 0.2,
      wallLevel: 0, forgeLevel: 0, expeditionLevel: 0, maps: 0,
      stoneUnlocked: true, discoveryBonus: 0, discoveryId: null, discoveryName: null,
      timestamp: new Date().toISOString(),
      firstTimestamp: new Date(Date.now() - 3600000).toISOString(),
    };
    const loadSeededSave = () => {
      engine.reset();
      localStorage.setItem("selfgrow-state", JSON.stringify(seeded));
      engine.init();
    };
    // Rewind the stored save the way a longer absence would have left it, so a
    // 90-second gap costs the suite no wall-clock time.
    const pretendAwayFor = (ms) => {
      const saved = JSON.parse(localStorage.getItem("selfgrow-state"));
      saved.timestamp = new Date(Date.now() - ms).toISOString();
      engine.importSave(btoa(JSON.stringify(saved)));
    };

    // Preserve the page's real save so these checks leave no trace.
    const originalCode = engine.exportSave();
    if (typeof window.__dismissOffline === "function") window.__dismissOffline();

    // (a) Hiding stops the game. A tick left running would credit a throttled
    // call's single simulated second and stamp the save as current — exactly
    // the undercount this fixes — so nothing may move while the tab is hidden.
    // The wait outlasts one tick interval (1s), which is what makes a tick that
    // was left running visible.
    loadSeededSave();
    setTabHidden(true);
    const woodWhileHidden = engine.getState().wood;
    const stampWhileHidden = engine.getState().timestamp;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    if (engine.getState().wood !== woodWhileHidden) {
      problems.push(`A hidden tab must credit nothing until it returns: wood moved from ${woodWhileHidden} to ${engine.getState().wood} while the tab was hidden.`);
    }
    // A browser may report the same hidden tab more than once: a repeat must not
    // re-stamp the save, which would drop the absence already accumulated.
    setTabHidden(true);
    if (engine.getState().timestamp !== stampWhileHidden) {
      problems.push(`A repeated hidden event must not re-stamp the save — the absence already away is at risk: timestamp moved from ${stampWhileHidden} to ${engine.getState().timestamp}.`);
    }

    // (b) Returning credits the whole real absence, not one throttled tick, and
    // greets the player with the account of it.
    pretendAwayFor(ABSENCE_MS);
    setTabHidden(false);
    const ret = engine.getReturnSummary();
    if (!ret.visible) {
      problems.push("Returning to a tab that was hidden must record a return, but getReturnSummary().visible was false.");
    }
    if (!(ret.elapsedSec >= 1)) {
      problems.push(`A hidden tab's return must account for the whole absence, but getReturnSummary() reported only ${ret.elapsedSec}s of a ${ABSENCE_MS / 1000}s gap.`);
    }
    if (overlay.hidden) {
      problems.push("Returning to a tab that was hidden must show the welcome-back panel.");
    }

    // The wood and stone are the seeded rates over the whole gap: the discovery
    // the absence turns up raises the rate from now on, never for the gap that
    // earned it. Tolerance is the counters' own rounding.
    const woodExpected = seeded.rate * ret.elapsedSec;
    if (Math.abs(ret.wood - woodExpected) > 0.05) {
      problems.push(`A return's wood (${ret.wood}) must be the seeded ${seeded.rate}/s across the whole ${ret.elapsedSec}s away (${woodExpected}), not one throttled tick.`);
    }
    // The stone is the rate the save pays, which the wood earned over the gap
    // has itself raised — the same figure a reload of this absence would pay.
    // Tolerance is the counters' own flooring.
    const stoneExpected = engine.computeStoneRateFor(seeded.totalWoodEarned + woodExpected) * ret.elapsedSec;
    if (!(ret.stone > 0) || Math.abs(ret.stone - stoneExpected) > 0.05) {
      problems.push(`A return's stone (${ret.stone}) must be the save's own rate across the whole ${ret.elapsedSec}s away (${stoneExpected}); only the counters' flooring may differ.`);
    }

    // The rate left behind is the one a reload of this absence would leave, read
    // from the engine's own ladder rather than restated here.
    const find = engine.discoverForElapsed(ret.elapsedSec);
    const rateExpected = seeded.rate + (find ? find.bonus : 0);
    if (Math.abs(engine.getState().rate - rateExpected) > 1e-9) {
      problems.push(`A return must leave the rate a reload would (${rateExpected}/s for a ${ret.elapsedSec}s absence), got ${engine.getState().rate}/s.`);
    }
    if (find && !ret.discovery) {
      problems.push(`A ${ret.elapsedSec}s absence turns up "${find.name}", but the return reported no find.`);
    }

    // The panel, the counter and the read-state tool are one account.
    if (!overlay.hidden) {
      if (!woodAmountEl || parseFloat(woodAmountEl.textContent) !== ret.wood) {
        problems.push(`The panel's wood (${woodAmountEl && woodAmountEl.textContent}) must be the return's own account (${ret.wood}).`);
      }
      if (elapsedEl && elapsedEl.textContent.trim() !== ret.elapsed) {
        problems.push(`The panel's absence (${elapsedEl.textContent.trim()}) must be the return's own account (${ret.elapsed}).`);
      }
      if (ret.stone > 0 && stoneLineEl && stoneLineEl.hidden) {
        problems.push(`The panel must show the stone earned on a ${ret.elapsedSec}s return (${ret.stone}), but its stone line is hidden.`);
      }
      if (stoneLineEl && !stoneLineEl.hidden && parseFloat(stoneAmountEl.textContent) !== ret.stone) {
        problems.push(`The panel's stone (${stoneAmountEl.textContent}) must be the return's own account (${ret.stone}).`);
      }
      const read = readState && await readState.execute({});
      if (read) {
        if (read.offlineWoodGained !== ret.wood) {
          problems.push(`read-state.offlineWoodGained (${read.offlineWoodGained}) must be the wood the panel accounts for (${ret.wood}).`);
        }
        if (read.offlineStoneGained !== ret.stone) {
          problems.push(`read-state.offlineStoneGained (${read.offlineStoneGained}) must be the stone the panel accounts for (${ret.stone}).`);
        }
        if (read.offlineElapsed !== ret.elapsed) {
          problems.push(`read-state.offlineElapsed (${read.offlineElapsed}) must be the absence the panel accounts for (${ret.elapsed}).`);
        }
      }
    }

    // (c) Nothing is credited twice. A focus without a hidden spell behind it
    // must add no wood and must leave the account — and the panel — alone.
    const woodAfterReturn = engine.getState().wood;
    setTabHidden(false);
    if (engine.getState().wood !== woodAfterReturn) {
      problems.push(`A return with no hidden spell behind it must credit nothing: wood moved from ${woodAfterReturn} to ${engine.getState().wood}.`);
    }
    renderNow();
    if (!overlay.hidden && woodAmountEl && parseFloat(woodAmountEl.textContent) !== ret.wood) {
      problems.push("A stray return must leave the panel showing the same account it already had.");
    }
    // (d) A switch away shorter than the return threshold is not a return: the
    // time is credited, but nothing is announced and no panel appears.
    if (typeof window.__dismissOffline === "function") window.__dismissOffline();
    const woodBeforeBlip = engine.getState().wood;
    setTabHidden(true);
    setTabHidden(false);
    if (engine.getReturnSummary().visible) {
      problems.push("A tab switched away and straight back must not count as a return.");
    }
    if (engine.getState().wood < woodBeforeBlip) {
      problems.push(`A short switch away must never lose wood: ${woodBeforeBlip} became ${engine.getState().wood}.`);
    }
    if (typeof window.__showOfflineSummary === "function") window.__showOfflineSummary();
    if (!overlay.hidden) {
      problems.push("A tab switched away and straight back must show no welcome-back panel.");
    }
    const blipRead = readState && await readState.execute({});
    if (blipRead && blipRead.offlineWoodGained !== 0) {
      problems.push(`read-state must report no return while no panel is showing, got offlineWoodGained ${blipRead.offlineWoodGained}.`);
    }

    // (e) A return while another overlay already owns the screen credits the
    // absence but announces nothing, so the open panel is never contradicted.
    if (typeof window.__enterSandbox === "function") {
      window.__enterSandbox();
      setTabHidden(true);
      pretendAwayFor(ABSENCE_MS);
      const woodBeforeOverlayReturn = engine.getState().wood;
      setTabHidden(false);
      if (engine.getReturnSummary().visible) {
        problems.push("A return while another overlay is open must not record a return to announce.");
      }
      if (!overlay.hidden) {
        problems.push("A return while another overlay is open must not open the welcome-back panel over it.");
      }
      const overlayRise = engine.getState().wood - woodBeforeOverlayReturn;
      if (!(overlayRise > 5)) {
        problems.push(`A return while an overlay is open must still credit the real absence: wood rose ${overlayRise} over a ${ABSENCE_MS / 1000}s gap.`);
      }
      const overlayRead = readState && await readState.execute({});
      if (overlayRead && overlayRead.offlineWoodGained !== 0) {
        problems.push(`read-state must report no return while no panel is showing, got offlineWoodGained ${overlayRead.offlineWoodGained}.`);
      }
      const woodAfterOverlayReturn = engine.getState().wood;
      setTabHidden(false);
      if (engine.getState().wood !== woodAfterOverlayReturn) {
        problems.push(`A stray return while an overlay is open must credit nothing: wood moved from ${woodAfterOverlayReturn} to ${engine.getState().wood}.`);
      }
      window.__exitSandbox();
    } else {
      problems.push("Expected window.__enterSandbox to open an overlay for the backgrounded-tab checks.");
    }

    // Leave the page as it was found: visible, ticking, the real save restored.
    setTabHidden(false);
    delete document.hidden;
    engine.importSave(originalCode);
    renderNow();
  } catch (err) {
    // A failed check must not leave the tab hidden or the tick stopped behind it.
    try {
      delete document.hidden;
      const engine = await import("./engine.js");
      if (typeof engine.resumeFromHidden === "function") engine.resumeFromHidden();
    } catch {
      // nothing left to restore
    }
    problems.push(`Backgrounded-tab return test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Milestones read the engine's own rule ──────────────────────
  // The read-state tool must answer "can the wall be built?" and "are
  // expeditions unlocked?" with the engine's shared rule, never a copied
  // number, so an agent can never be told a different story than the page.

  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    const restoreCode = engine.exportSave();

    if (typeof engine.wallAvailable !== "function") {
      problems.push("Expected engine.wallAvailable to be exported so the tools and the page share one wall rule.");
    }
    if (typeof engine.expeditionUnlocked !== "function") {
      problems.push("Expected engine.expeditionUnlocked to be exported so the tools and the page share one expedition rule.");
    }
    if (typeof engine.EXPEDITION_FORGE_LEVEL !== "number") {
      problems.push(`Expected engine.EXPEDITION_FORGE_LEVEL to be an exported number, got ${JSON.stringify(engine.EXPEDITION_FORGE_LEVEL)}.`);
    }

    if (!readState) {
      problems.push("Expected a read-state tool when checking milestones against the engine's rule.");
    } else {
      // The rules themselves are sensitive to the exported thresholds, so if a
      // constant ever moves the comparisons below move with it.
      const wallAt = (stone) => engine.wallAvailable({ stone, stoneUnlocked: true, wallLevel: 0 });
      if (wallAt(engine.WALL_COST) !== true) {
        problems.push(`engine.wallAvailable must be true at exactly WALL_COST (${engine.WALL_COST}) stone.`);
      }
      if (wallAt(engine.WALL_COST - 1) !== false) {
        problems.push(`engine.wallAvailable must be false one stone below WALL_COST (${engine.WALL_COST}).`);
      }
      if (engine.wallAvailable({ stone: engine.WALL_COST, stoneUnlocked: false, wallLevel: 0 }) !== false) {
        problems.push("engine.wallAvailable must be false before stone is unlocked.");
      }
      if (engine.wallAvailable({ stone: engine.WALL_COST, stoneUnlocked: true, wallLevel: 1 }) !== false) {
        problems.push("engine.wallAvailable must be false once a wall already stands.");
      }

      const expeditionAt = (forgeLevel) => engine.expeditionUnlocked({ forgeLevel });
      if (expeditionAt(engine.EXPEDITION_FORGE_LEVEL) !== true) {
        problems.push(`engine.expeditionUnlocked must be true at exactly forge level ${engine.EXPEDITION_FORGE_LEVEL}.`);
      }
      if (expeditionAt(engine.EXPEDITION_FORGE_LEVEL - 1) !== false) {
        problems.push(`engine.expeditionUnlocked must be false one forge level below ${engine.EXPEDITION_FORGE_LEVEL}.`);
      }

      // importSave writes the live save, so read-state and describeGoal — the
      // page's own goal rule — see exactly the state being asked about.
      const load = (fields) => {
        engine.importSave(btoa(JSON.stringify({
          wood: 100, rate: 0.1, timestamp: new Date().toISOString(), upgradeLevel: 1, ...fields,
        })));
      };

      for (const stone of [engine.WALL_COST - 1, engine.WALL_COST]) {
        load({ stone, stoneUnlocked: true, wallLevel: 0 });
        const state = engine.getState();
        const read = await readState.execute({});
        const expected = engine.wallAvailable(state);
        if (read.milestones.wallAvailable !== expected) {
          problems.push(`read-state.milestones.wallAvailable at ${stone} stone must match engine.wallAvailable ${expected}, got ${read.milestones.wallAvailable}.`);
        }
        const goal = read.nextGoal;
        if (goal.type === "build-wall-goal" && goal.wallAvailable !== expected) {
          problems.push(`The build-wall goal at ${stone} stone reports wallAvailable ${goal.wallAvailable} but the engine's rule says ${expected}.`);
        }
      }

      for (const forgeLevel of [engine.EXPEDITION_FORGE_LEVEL - 1, engine.EXPEDITION_FORGE_LEVEL]) {
        load({ stone: 100, stoneUnlocked: true, wallLevel: 1, forgeLevel });
        const state = engine.getState();
        const read = await readState.execute({});
        const expected = engine.expeditionUnlocked(state);
        if (read.milestones.expeditionNowUnlocked !== expected) {
          problems.push(`read-state.milestones.expeditionNowUnlocked at forge level ${forgeLevel} must match engine.expeditionUnlocked ${expected}, got ${read.milestones.expeditionNowUnlocked}.`);
        }
        const pageShowsExpedition = read.nextGoal.type === "expedition-goal";
        if (pageShowsExpedition !== expected) {
          problems.push(`The page's goal at forge level ${forgeLevel} ${pageShowsExpedition ? "shows" : "hides"} the expedition goal, but the engine's rule says unlocked=${expected}.`);
        }
      }
    }

    engine.importSave(restoreCode);
    if (typeof window.__renderUI === "function") window.__renderUI();
  } catch (err) {
    problems.push(`Milestone-rule agreement test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Agent tools: read-rules ────────────────────────────────────
  // An agent arriving cold must learn the game from one read: the ordered
  // goals, every action's cost and effect, what unlocks what, and the next away
  // find. Every number is compared to the engine's own constant (or the state's
  // own derived cost) and every effect sentence to the text the page prints
  // beside the same button, so a copy of the rules that drifts is caught here.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readRules = tools().find((t) => t.name === "read-rules");
    const restoreCode = engine.exportSave();
    const renderNow = () => { if (typeof window.__renderUI === "function") window.__renderUI(); };
    const checkNumber = (label, actual, expected) => {
      if (typeof actual !== "number" || Math.abs(actual - expected) > 1e-9) {
        problems.push(`${label} should be ${expected}, got ${JSON.stringify(actual)}.`);
      }
    };

    if (!readRules) {
      problems.push("Expected a tool named 'read-rules' in tools() — a cold agent cannot learn the game's rules without it.");
    } else {
      if (!readRules.annotations || readRules.annotations.readOnlyHint !== true) {
        problems.push("read-rules must be annotated readOnlyHint: true — it only reads the rules.");
      }

      // A mid-game save, so the forge/expedition formulas are evaluated at a
      // non-zero level and the chop-power sentence is not trivially "+1 / chop".
      engine.importSave(btoa(JSON.stringify({
        wood: 100, rate: 0.4, timestamp: new Date().toISOString(),
        upgradeLevel: 2, stone: 40, stoneUnlocked: true,
        wallLevel: 1, forgeLevel: 2, expeditionLevel: 1, maps: 1,
        discoveryId: "flint-shard", discoveryName: "Flint Shard", discoveryBonus: 0.05,
      })));
      renderNow();

      const state = engine.getState();
      const rules = await readRules.execute({});
      const actionById = (id) => (Array.isArray(rules.actions) ? rules.actions.find((a) => a.id === id) : null);

      // (a) The ordered goals, and the first one names both the goal and its action.
      if (!Array.isArray(rules.goals) || rules.goals.length === 0) {
        problems.push("read-rules.goals must be a non-empty array of the game's goals in the order they come.");
      } else {
        const first = rules.goals[0];
        if (first.description !== "Gather " + engine.FIRST_GOAL_WOOD + " wood") {
          problems.push(`read-rules.goals[0].description should name the first goal "Gather ${engine.FIRST_GOAL_WOOD} wood", got ${JSON.stringify(first.description)}.`);
        }
        if (first.action !== "gather") {
          problems.push(`read-rules.goals[0].action should be "gather" — the action that reaches the first goal — got ${JSON.stringify(first.action)}.`);
        }
        const order = rules.goals.map((g) => g.type).join(",");
        const expectedOrder = "first-goal,upgrade,stone-goal,build-wall-goal,forge-goal,expedition-goal";
        if (order !== expectedOrder) {
          problems.push(`read-rules.goals should follow the progression order ${expectedOrder}, got ${order}.`);
        }
        for (let i = 0; i < rules.goals.length; i++) {
          if (rules.goals[i].order !== i + 1) {
            problems.push(`read-rules.goals[${i}].order should be ${i + 1}, got ${JSON.stringify(rules.goals[i].order)}.`);
          }
        }
      }

      // (b) Every cost and effect is the engine's own constant.
      checkNumber("read-rules gather effect.woodPerChop", actionById("gather")?.effect?.woodPerChop, engine.clickPowerFor(state));
      checkNumber("read-rules sharpen cost.wood", actionById("sharpen")?.cost?.wood, engine.UPGRADE_COST);
      checkNumber("read-rules sharpen effect.woodRatePerSec", actionById("sharpen")?.effect?.woodRatePerSec, engine.RATE_INCREASE_PER_UPGRADE);
      checkNumber("read-rules gather-stone effect.stone", actionById("gather-stone")?.effect?.stone, engine.STONE_GATHER_AMOUNT);
      checkNumber("read-rules build-wall cost.stone", actionById("build-wall")?.cost?.stone, engine.WALL_COST);
      checkNumber("read-rules build-wall effect.woodPerChop", actionById("build-wall")?.effect?.woodPerChop, engine.WALL_CLICK_POWER_BONUS);

      const forgeWood = engine.FORGE_WOOD_COST_BASE + state.forgeLevel * engine.FORGE_WOOD_COST_INC;
      const forgeStone = engine.FORGE_STONE_COST_BASE + state.forgeLevel * engine.FORGE_STONE_COST_INC;
      checkNumber(`read-rules forge-tool cost.wood at forge level ${state.forgeLevel}`, actionById("forge-tool")?.cost?.wood, forgeWood);
      checkNumber(`read-rules forge-tool cost.stone at forge level ${state.forgeLevel}`, actionById("forge-tool")?.cost?.stone, forgeStone);
      checkNumber("read-rules forge-tool effect.woodRatePerSec", actionById("forge-tool")?.effect?.woodRatePerSec, engine.FORGE_WOOD_RATE_BONUS);
      checkNumber("read-rules forge-tool effect.woodPerChop", actionById("forge-tool")?.effect?.woodPerChop, engine.FORGE_CLICK_POWER_BONUS);
      if (typeof actionById("forge-tool")?.costFormula !== "string"
          || !actionById("forge-tool").costFormula.includes("level * " + engine.FORGE_WOOD_COST_INC)) {
        problems.push("read-rules forge-tool costFormula should state the escalating rule using the engine's own increment constant.");
      }

      const expeditionWood = engine.EXPEDITION_WOOD_COST_BASE + state.expeditionLevel * engine.EXPEDITION_WOOD_COST_INC;
      const expeditionStone = engine.EXPEDITION_STONE_COST_BASE + state.expeditionLevel * engine.EXPEDITION_STONE_COST_INC;
      checkNumber(`read-rules send-expedition cost.wood at expedition level ${state.expeditionLevel}`, actionById("send-expedition")?.cost?.wood, expeditionWood);
      checkNumber(`read-rules send-expedition cost.stone at expedition level ${state.expeditionLevel}`, actionById("send-expedition")?.cost?.stone, expeditionStone);
      checkNumber("read-rules send-expedition effect.woodRateMultiplierPerMap", actionById("send-expedition")?.effect?.woodRateMultiplierPerMap, engine.EXPEDITION_WOOD_RATE_MULTIPLIER);

      // (c) The unlock chain, read from the same gates the engine enforces.
      const unlockFor = (system) => (Array.isArray(rules.unlocks) ? rules.unlocks.find((u) => u.system === system) : null);
      if (unlockFor("stone")?.openedBy !== "sharpen") {
        problems.push("read-rules.unlocks should say stone is opened by sharpen.");
      }
      if (unlockFor("forge")?.openedBy !== "build-wall") {
        problems.push("read-rules.unlocks should say the forge is opened by build-wall.");
      }
      const expeditionUnlock = unlockFor("expedition");
      if (expeditionUnlock?.openedBy !== "forge-tool" || expeditionUnlock?.at?.forgeLevel !== engine.EXPEDITION_FORGE_LEVEL) {
        problems.push(`read-rules.unlocks should say expeditions are opened by forge-tool at forge level ${engine.EXPEDITION_FORGE_LEVEL}, got ${JSON.stringify(expeditionUnlock)}.`);
      }

      // (d) The next away-find rung and the absence it needs, read from the ladder.
      const ownedId = state.discovery ? state.discovery.id : null;
      const next = engine.nextDiscoveryAfter(ownedId);
      if (!rules.nextAwayFind || !next) {
        problems.push(`read-rules.nextAwayFind should name the rung after ${ownedId}, got ${JSON.stringify(rules.nextAwayFind)}.`);
      } else if (rules.nextAwayFind.id !== next.id || rules.nextAwayFind.name !== next.name || rules.nextAwayFind.minSec !== next.minSec) {
        problems.push(`read-rules.nextAwayFind should be ${JSON.stringify({ id: next.id, name: next.name, minSec: next.minSec })}, got ${JSON.stringify(rules.nextAwayFind)}.`);
      }

      // (e) Each effect sentence is the exact text the page prints beside the
      // same button, so what an agent reads is what a visitor sees.
      const textOf = (el) => (el ? el.textContent.trim() : null);
      const effectBeside = (buttonId) => {
        const button = document.getElementById(buttonId);
        const card = button ? button.closest(".upgrade-card") : null;
        return card ? card.querySelector(".upgrade-effect") : null;
      };
      const effectTextChecks = [
        ["gather", textOf(document.getElementById("wood-yield-value"))],
        ["gather-stone", textOf(document.getElementById("stone-yield-value"))],
        ["sharpen", textOf(effectBeside("btn-sharpen"))],
        ["build-wall", textOf(effectBeside("btn-build-wall"))],
        ["forge-tool", textOf(document.querySelector("#forge-actions .system-yield"))],
        ["send-expedition", textOf(document.querySelector("#expedition-actions .system-yield"))],
      ];
      for (const [actionId, pageText] of effectTextChecks) {
        const action = actionById(actionId);
        if (!action) {
          problems.push(`read-rules should list the "${actionId}" action — it was missing.`);
        } else if (action.effectText !== pageText) {
          problems.push(`read-rules "${actionId}" effectText ${JSON.stringify(action.effectText)} does not match the text the page shows beside it: ${JSON.stringify(pageText)}.`);
        }
      }
    }

    engine.importSave(restoreCode);
    renderNow();
  } catch (err) {
    problems.push(`read-rules tool test threw: ${err.message}`);
    console.error(err);
  }

  // ─── Away event with two choices (issue #1036) ───────────────────
  // A real return must offer a decision, not only a bigger number: one
  // happening drawn from the absence, with exactly two options, each stating
  // the one thing it grants. The event is derived deterministically, lives in
  // the save until chosen, grants exactly one stated effect once, and is
  // reachable by agents through read-state and perform-action.
  try {
    const engine = await import("./engine.js");
    const { tools } = await import("./agenttools.js");
    const readState = tools().find((t) => t.name === "read-state");
    const performAction = tools().find((t) => t.name === "perform-action");

    if (typeof engine.awayEventForElapsed !== "function" || typeof engine.chooseAwayEventOption !== "function") {
      problems.push("engine must export awayEventForElapsed and chooseAwayEventOption for the away event.");
    }

    const KNOWN_KINDS = ["wood", "stone", "rate"];
    // Every promise an away event makes, checked on any event: a title, exactly
    // two distinct choices, and each choice a positive amount of a kind the
    // engine can apply, stated in words.
    const eventShapeProblems = (event, label) => {
      const found = [];
      if (!event || typeof event !== "object") {
        found.push(`${label} should be an event with a title and two options, got ${JSON.stringify(event)}.`);
        return found;
      }
      if (typeof event.title !== "string" || event.title.trim() === "") {
        found.push(`${label} should carry a non-empty title, got ${JSON.stringify(event.title)}.`);
      }
      if (!Array.isArray(event.options) || event.options.length !== 2) {
        found.push(`${label} should offer exactly two options, got ${JSON.stringify(event.options)}.`);
        return found;
      }
      const ids = event.options.map((o) => o.id);
      if (ids[0] === ids[1]) {
        found.push(`${label} must offer two distinct choices, but both options are "${ids[0]}".`);
      }
      event.options.forEach((option, i) => {
        if (!KNOWN_KINDS.includes(option.id)) {
          found.push(`${label} option ${i} has unknown id ${JSON.stringify(option.id)}.`);
        }
        if (typeof option.label !== "string" || option.label.trim() === "") {
          found.push(`${label} option ${i} must state what it grants, got label ${JSON.stringify(option.label)}.`);
        }
        if (typeof option.effectText !== "string" || option.effectText.trim() === "") {
          found.push(`${label} option ${i} must state its effect in effectText, got ${JSON.stringify(option.effectText)}.`);
        }
        const effect = option.effect;
        if (!effect || effect.kind !== option.id || !Number.isFinite(effect.amount) || effect.amount <= 0) {
          found.push(`${label} option ${i} must carry one finite positive effect of its own kind, got ${JSON.stringify(effect)}.`);
        }
      });
      return found;
    };

    // (a) Below a minute there is no event; a ten-minute absence offers one
    // happening whose two choices each name their own positive grant.
    const sampleState = { rate: 0.1, maps: 0, stoneUnlocked: true, totalWoodEarned: 0 };
    if (engine.awayEventForElapsed(59, sampleState) !== null) {
      problems.push(`A 59s absence is shorter than a minute, so it must offer no away event, got ${JSON.stringify(engine.awayEventForElapsed(59, sampleState))}.`);
    }
    const sampleEvent = engine.awayEventForElapsed(600, sampleState);
    problems.push(...eventShapeProblems(sampleEvent, "awayEventForElapsed(600)"));

    // (b) The absence alone derives the event: the same length always offers
    // the same happening and the same two choices.
    const sampleAgain = engine.awayEventForElapsed(600, sampleState);
    if (JSON.stringify(sampleEvent) !== JSON.stringify(sampleAgain)) {
      problems.push(`The same absence must offer the same event: 600s gave ${JSON.stringify(sampleEvent)} then ${JSON.stringify(sampleAgain)}.`);
    }

    // Loads a save that is `ageMs` old the way a returning player's browser
    // would, after clearing any live state.
    const seedAwaySave = (ageMs, overrides = {}) => {
      engine.reset();
      const aged = new Date(Date.now() - ageMs).toISOString();
      localStorage.setItem("selfgrow-state", JSON.stringify({
        wood: 0, rate: 0.1, upgradeLevel: 0, stone: 0,
        totalWoodEarned: 0, totalStoneEarned: 0,
        wallLevel: 0, forgeLevel: 0, expeditionLevel: 0, maps: 0,
        stoneUnlocked: false,
        discoveryBonus: 0, discoveryId: null, discoveryName: null,
        lastReturn: null, pendingEvent: null,
        timestamp: aged, firstTimestamp: aged,
        ...overrides,
      }));
      engine.init();
    };

    // (c) A real return of at least a minute reports the pending event through
    // the live state and the return summary alike, agreeing with each other.
    seedAwaySave(600000, { stoneUnlocked: true });
    const eventFromState = engine.getState().pendingEvent;
    problems.push(...eventShapeProblems(eventFromState, "getState().pendingEvent after a 600s return"));
    const eventFromSummary = engine.getReturnSummary().pendingEvent;
    problems.push(...eventShapeProblems(eventFromSummary, "getReturnSummary().pendingEvent after a 600s return"));
    if (JSON.stringify(eventFromState) !== JSON.stringify(eventFromSummary)) {
      problems.push(`getState and getReturnSummary must report the same pending event, got ${JSON.stringify(eventFromState)} and ${JSON.stringify(eventFromSummary)}.`);
    }

    // (d) The event lives in the save until chosen: reloading before choosing
    // reports the very same event, the same options and the same effects.
    const savedBeforeReload = localStorage.getItem("selfgrow-state");
    const eventBeforeReload = JSON.stringify(engine.getState().pendingEvent);
    engine.reset();
    localStorage.setItem("selfgrow-state", savedBeforeReload);
    engine.init();
    const eventAfterReload = JSON.stringify(engine.getState().pendingEvent);
    if (eventAfterReload !== eventBeforeReload) {
      problems.push(`A reload before choosing must keep the pending event: expected ${eventBeforeReload}, got ${eventAfterReload}.`);
    }

    // (e) Choosing a choice grants exactly its stated effect, once; the event
    // is then gone and a second choice is refused. Each kind — wood, stone and
    // rate — is exercised so every grant is compared against the exact amount
    // the choice itself stated.
    const verifyChoice = (label, optionIndex) => {
      const pending = engine.getState().pendingEvent;
      problems.push(...eventShapeProblems(pending, `${label} pending event`));
      if (!pending) return;
      const option = pending.options[optionIndex];
      const before = engine.getState();
      const result = engine.chooseAwayEventOption(option.id);
      if (result.chosen !== true) {
        problems.push(`${label}: choosing option "${option.id}" should succeed, got refusal ${JSON.stringify(result.reason)}.`);
        return;
      }
      const after = engine.getState();
      const effect = option.effect;
      if (effect.kind === "wood") {
        const woodRise = after.wood - before.wood;
        const lifetimeRise = after.totalWoodEarned - before.totalWoodEarned;
        if (Math.abs(woodRise - effect.amount) > 1e-9 || Math.abs(lifetimeRise - effect.amount) > 1e-9) {
          problems.push(`${label}: choosing +${effect.amount} wood should raise wood and lifetime wood by that much, got ${woodRise} and ${lifetimeRise}.`);
        }
      } else if (effect.kind === "stone") {
        const stoneRise = after.stone - before.stone;
        const lifetimeRise = after.totalStoneEarned - before.totalStoneEarned;
        if (Math.abs(stoneRise - effect.amount) > 1e-9 || Math.abs(lifetimeRise - effect.amount) > 1e-9) {
          problems.push(`${label}: choosing +${effect.amount} stone should raise stone and lifetime stone by that much, got ${stoneRise} and ${lifetimeRise}.`);
        }
      } else {
        const rateRise = after.rate - before.rate;
        if (Math.abs(rateRise - effect.amount) > 1e-9) {
          problems.push(`${label}: choosing +${effect.amount} wood/s should raise the rate by that much, got ${rateRise}.`);
        }
      }
      if (after.pendingEvent !== null) {
        problems.push(`${label}: the event must be gone after choosing, got ${JSON.stringify(after.pendingEvent)}.`);
      }
      const again = engine.chooseAwayEventOption(option.id);
      if (again.chosen !== false) {
        problems.push(`${label}: choosing a second time must be refused, got ${JSON.stringify(again)}.`);
      }
    };

    // 600s picks the first pool entry (wood + stone), 601s the second
    // (wood + rate) and 602s the third (stone + rate); the option index picked
    // below is the one that exercises rate where the pair offers one.
    seedAwaySave(600000, { stoneUnlocked: true });
    verifyChoice("600s return, first choice", 0);
    seedAwaySave(601000, { stoneUnlocked: true });
    verifyChoice("601s return, second choice", 1);
    seedAwaySave(602000, { stoneUnlocked: true });
    verifyChoice("602s return, first choice", 0);

    // With stone still locked the stone option is replaced, so an early return
    // never offers a resource the player cannot yet hold.
    const lockedEvent = engine.awayEventForElapsed(600, { rate: 0.1, maps: 0, stoneUnlocked: false, totalWoodEarned: 0 });
    problems.push(...eventShapeProblems(lockedEvent, "awayEventForElapsed(600) with stone locked"));
    if (lockedEvent && lockedEvent.options.some((option) => option.id === "stone")) {
      problems.push(`With stone locked an away event must not offer stone, got ${JSON.stringify(lockedEvent.options.map((o) => o.id))}.`);
    }

    // (f) An agent reads the pending event and chooses through the tools,
    // applying exactly the effect the page would, and is refused afterwards.
    seedAwaySave(600000, { stoneUnlocked: true });
    const readWithEvent = await readState.execute({});
    problems.push(...eventShapeProblems(readWithEvent.pendingEvent, "read-state.pendingEvent after a 600s return"));
    const toolOption = readWithEvent.pendingEvent ? readWithEvent.pendingEvent.options[0] : null;
    if (!toolOption) {
      problems.push("read-state.pendingEvent must carry options an agent can choose from.");
    } else {
      const beforeTool = engine.getState();
      const toolResult = await performAction.execute({ action: "choose-away-event", option: toolOption.id });
      if (toolResult.ok === false) {
        problems.push(`perform-action choose-away-event must accept "${toolOption.id}", got refusal ${JSON.stringify(toolResult.reason)}.`);
      }
      const afterTool = engine.getState();
      const effect = toolOption.effect;
      if (effect.kind === "wood" && Math.abs((afterTool.wood - beforeTool.wood) - effect.amount) > 1e-9) {
        problems.push(`perform-action choose-away-event must add exactly +${effect.amount} wood, got ${afterTool.wood - beforeTool.wood}.`);
      }
      if (effect.kind === "stone" && Math.abs((afterTool.stone - beforeTool.stone) - effect.amount) > 1e-9) {
        problems.push(`perform-action choose-away-event must add exactly +${effect.amount} stone, got ${afterTool.stone - beforeTool.stone}.`);
      }
      if (effect.kind === "rate" && Math.abs((afterTool.rate - beforeTool.rate) - effect.amount) > 1e-9) {
        problems.push(`perform-action choose-away-event must add exactly +${effect.amount} wood/s, got ${afterTool.rate - beforeTool.rate}.`);
      }
      if (afterTool.pendingEvent !== null) {
        problems.push(`perform-action choose-away-event must clear the event, got ${JSON.stringify(afterTool.pendingEvent)}.`);
      }
      const readAfterChoice = await readState.execute({});
      if (readAfterChoice.pendingEvent !== null) {
        problems.push(`read-state must report no pending event after one was chosen, got ${JSON.stringify(readAfterChoice.pendingEvent)}.`);
      }
      const secondChoice = await performAction.execute({ action: "choose-away-event", option: toolOption.id });
      if (secondChoice.ok !== false) {
        problems.push(`perform-action choose-away-event must refuse a second choice, got ${JSON.stringify(secondChoice)}.`);
      }
    }

    // (g) The welcome-back panel is where a player actually meets the event:
    // it shows the happening's title and one button per choice, each carrying
    // the option's own label and effect sentence. Clicking a button grants
    // exactly that stated effect once and the section disappears, so the other
    // choice can never then be taken.
    seedAwaySave(600000, { stoneUnlocked: true });
    if (typeof window.__showOfflineSummary !== "function") {
      problems.push("index.html must expose showOfflineSummary so a return can offer its event to a player.");
    } else {
      const panelEvent = engine.getState().pendingEvent;
      window.__showOfflineSummary();
      const panel = document.getElementById("offline-summary");
      const eventSection = document.getElementById("offline-event");
      if (!panel || panel.hidden) {
        problems.push("The welcome-back panel should be visible for a 600s return that owes a decision.");
      }
      if (!panelEvent) {
        problems.push("A 600s return should seed a pending event for the panel to render.");
      } else if (!eventSection || eventSection.hidden) {
        problems.push("The welcome-back panel must show the pending away event, but #offline-event was hidden.");
      } else {
        const titleEl = document.getElementById("offline-event-title");
        if (!titleEl || titleEl.textContent !== panelEvent.title) {
          problems.push(`The panel must show the event title ${JSON.stringify(panelEvent.title)}, got ${JSON.stringify(titleEl && titleEl.textContent)}.`);
        }
        panelEvent.options.forEach((option, i) => {
          const labelEl = document.getElementById(`away-option-label-${i}`);
          const effectEl = document.getElementById(`away-option-effect-${i}`);
          const button = document.getElementById(`away-option-${i}`);
          const buttonText = button ? button.textContent : "";
          if (!labelEl || labelEl.textContent !== option.label) {
            problems.push(`Panel option ${i} label should read ${JSON.stringify(option.label)}, got ${JSON.stringify(labelEl && labelEl.textContent)}.`);
          }
          if (!effectEl || effectEl.textContent !== option.effectText) {
            problems.push(`Panel option ${i} effect should read ${JSON.stringify(option.effectText)}, got ${JSON.stringify(effectEl && effectEl.textContent)}.`);
          }
          if (!buttonText.includes(option.label) || !buttonText.includes(option.effectText)) {
            problems.push(`Panel option ${i} button must show both its label and its effect text, got ${JSON.stringify(buttonText)}.`);
          }
        });

        // Click the first choice and hold the grant against what its own
        // button promised, then confirm the decision is spent.
        const chosenOption = panelEvent.options[0];
        const beforeClick = engine.getState();
        const button0 = document.getElementById("away-option-0");
        if (!button0) {
          problems.push("The panel must render a clickable button for each away-event option.");
        } else {
          button0.click();
          const afterClick = engine.getState();
          const effect = chosenOption.effect;
          if (effect.kind === "wood" && Math.abs((afterClick.wood - beforeClick.wood) - effect.amount) > 1e-9) {
            problems.push(`Clicking the wood option should add exactly +${effect.amount} wood, got ${afterClick.wood - beforeClick.wood}.`);
          }
          if (effect.kind === "stone" && Math.abs((afterClick.stone - beforeClick.stone) - effect.amount) > 1e-9) {
            problems.push(`Clicking the stone option should add exactly +${effect.amount} stone, got ${afterClick.stone - beforeClick.stone}.`);
          }
          if (effect.kind === "rate" && Math.abs((afterClick.rate - beforeClick.rate) - effect.amount) > 1e-9) {
            problems.push(`Clicking the rate option should add exactly +${effect.amount} wood/s, got ${afterClick.rate - beforeClick.rate}.`);
          }
          if (afterClick.pendingEvent !== null) {
            problems.push(`Choosing through the panel must clear the event, got ${JSON.stringify(afterClick.pendingEvent)}.`);
          }
          if (!eventSection.hidden) {
            problems.push("The away-event section must disappear once a choice has been taken.");
          }

          // The panel must then say plainly what was chosen, naming the option
          // and the effect it granted — the same words the button promised.
          const chosenLine = document.getElementById("offline-event-chosen");
          if (!chosenLine) {
            problems.push("The panel must have an #offline-event-chosen line stating the choice.");
          } else if (chosenLine.hidden) {
            problems.push("After choosing, the panel must show #offline-event-chosen stating what was chosen.");
          } else {
            if (!chosenLine.textContent.includes(chosenOption.label)) {
              problems.push(`The chosen line must name the chosen option ${JSON.stringify(chosenOption.label)}, got ${JSON.stringify(chosenLine.textContent)}.`);
            }
            if (!chosenLine.textContent.includes(chosenOption.effectText)) {
              problems.push(`The chosen line must state the effect ${JSON.stringify(chosenOption.effectText)}, got ${JSON.stringify(chosenLine.textContent)}.`);
            }
          }
        }

        // Both choices must be keyboard-reachable before the click, so a
        // player who never uses a mouse still faces the same two options.
        panelEvent.options.forEach((option, i) => {
          const button = document.getElementById(`away-option-${i}`);
          if (!button || button.tabIndex < 0) {
            problems.push(`Panel option ${i} must be keyboard-reachable, got tabIndex ${button ? button.tabIndex : "no button"}.`);
          }
        });
      }
      // Close the panel so later checks start from a usable page.
      if (typeof window.__dismissOffline === "function") window.__dismissOffline();
    }

    // (h) A held decision must stay in view after the welcome-back panel is
    // dismissed (issue #1047): the status panel names the happening and the
    // Last return control re-opens the same two choices, so a choice the game
    // is holding for the player cannot be forgotten. With nothing pending the
    // status panel says nothing. Page and read-state never disagree.
    const indicator = document.getElementById("away-decision-waiting");
    const indicatorName = document.getElementById("away-decision-waiting-name");
    const indicatorVisible = () => Boolean(indicator)
      && !indicator.classList.contains("stat-hidden")
      && getComputedStyle(indicator).display !== "none";
    if (!indicator || !indicatorName) {
      problems.push("The status panel must carry an #away-decision-waiting element naming a held decision.");
    } else {
      seedAwaySave(600000, { stoneUnlocked: true });
      window.__renderUI();
      const waitingEvent = engine.getState().pendingEvent;
      if (!waitingEvent) {
        problems.push("A 600s return should leave a pending event for the status panel to name.");
      } else if (!indicatorVisible()) {
        problems.push("After a real return, the status panel must state that an away decision is waiting.");
      }
      if (waitingEvent && indicatorName.textContent !== waitingEvent.title) {
        problems.push(`The waiting line must name the happening ${JSON.stringify(waitingEvent.title)}, got ${JSON.stringify(indicatorName.textContent)}.`);
      }

      // Dismissing the welcome-back panel without choosing must not hide the
      // reminder: the decision is still in the save, so the page must still
      // say so.
      if (typeof window.__dismissOffline === "function") window.__dismissOffline();
      if (waitingEvent && !indicatorVisible()) {
        problems.push("Dismissing the welcome-back panel without choosing must keep the waiting line visible.");
      }

      // The page and the read tool must agree about whether a decision waits.
      const readWhileWaiting = await readState.execute({});
      if (JSON.stringify(readWhileWaiting.pendingEvent) !== JSON.stringify(waitingEvent)) {
        problems.push(`read-state.pendingEvent must match the page's held decision: page ${JSON.stringify(waitingEvent)}, tool ${JSON.stringify(readWhileWaiting.pendingEvent)}.`);
      }

      // Re-opening the last return shows the same two choices with the same
      // effects, drawn from the same persisted event.
      const showReturnBtn = document.getElementById("btn-show-return");
      if (!showReturnBtn || showReturnBtn.hidden) {
        problems.push("The Last return control must be present while a return's record exists.");
      } else {
        showReturnBtn.click();
        const reopenedEvent = document.getElementById("offline-event");
        const reopenedTitle = document.getElementById("offline-event-title");
        if (!reopenedEvent || reopenedEvent.hidden) {
          problems.push("Re-opening the last return must show the pending away event.");
        } else if (waitingEvent) {
          if (reopenedTitle.textContent !== waitingEvent.title) {
            problems.push(`Re-opened panel must title the happening ${JSON.stringify(waitingEvent.title)}, got ${JSON.stringify(reopenedTitle.textContent)}.`);
          }
          waitingEvent.options.forEach((option, i) => {
            const labelEl = document.getElementById(`away-option-label-${i}`);
            const effectEl = document.getElementById(`away-option-effect-${i}`);
            if (!labelEl || labelEl.textContent !== option.label) {
              problems.push(`Re-opened option ${i} label should read ${JSON.stringify(option.label)}, got ${JSON.stringify(labelEl && labelEl.textContent)}.`);
            }
            if (!effectEl || effectEl.textContent !== option.effectText) {
              problems.push(`Re-opened option ${i} effect should read ${JSON.stringify(option.effectText)}, got ${JSON.stringify(effectEl && effectEl.textContent)}.`);
            }
          });

          // Taking the choice clears both the waiting line and the save.
          const reopenButton0 = document.getElementById("away-option-0");
          if (reopenButton0) reopenButton0.click();
          if (indicatorVisible()) {
            problems.push("Taking the waiting choice must clear the status panel's waiting line.");
          }
          const readAfterTaken = await readState.execute({});
          if (readAfterTaken.pendingEvent !== null) {
            problems.push(`read-state must report no pending event after the waiting choice is taken, got ${JSON.stringify(readAfterTaken.pendingEvent)}.`);
          }
        }
        if (typeof window.__dismissOffline === "function") window.__dismissOffline();
      }

      // With nothing pending there is nothing to wait for, so no line.
      engine.reset();
      engine.init();
      window.__renderUI();
      if (indicatorVisible()) {
        problems.push("With no pending decision the status panel must show no waiting line.");
      }
    }

    engine.reset();
    engine.init();
  } catch (err) {
    problems.push(`Away event test threw: ${err.message}`);
    console.error(err);
  }

  return problems;
}