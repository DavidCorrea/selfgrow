/**
 * Check that the product still does what it claims.
 *
 * Return an array of plain-language failure messages — empty when everything
 * holds. Each message is read by an agent deciding what to fix, so say what
 * broke and what was expected, not just "failed".
 *
 * May be async. Runs in the real browser, on the real page, so it can reach
 * the DOM and import any module the product ships.
 */
export async function checks() {
  const problems = [];

  // 1. The page must have a <html lang="en"> attribute
  const htmlEl = document.documentElement;
  if (!htmlEl || htmlEl.getAttribute("lang") !== "en") {
    problems.push(
      `<html> element is missing lang="en" attribute: got "${htmlEl?.getAttribute("lang") ?? null}"`
    );
  }

  // 2. Viewport meta tag must exist
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (!viewportMeta) {
    problems.push("Missing <meta name=\"viewport\"> tag — page will not scale correctly on mobile");
  }

  // 3. Semantic header, main, footer must exist
  for (const tag of ["header", "main", "footer"]) {
    if (!document.querySelector(tag)) {
      problems.push(`Missing semantic <${tag}> element — page structure is not accessible`);
    }
  }

  // 4. Game container (#game) must exist
  const game = document.getElementById("game");
  if (!game) {
    problems.push("Missing #game container element — game engine has no mount point");
  } else {
    // 5. Game container must have the riveted-panel class
    if (!game.classList.contains("riveted-panel")) {
      problems.push("#game container is missing the 'riveted-panel' class — steampunk styling not applied");
    }
  }

  // 6. Seed display area must exist
  const seedDisplay = document.getElementById("seed-value");
  if (!seedDisplay) {
    problems.push("Missing #seed-value element — seed display area not present");
  }

  // 7. Title must be present and contain the game name
  const title = document.querySelector("title");
  if (!title) {
    problems.push("Missing <title> element — page has no title");
  } else if (!title.textContent.toLowerCase().includes("bellowsdeep") &&
             !title.textContent.toLowerCase().includes("selfgrow")) {
    problems.push(`Page title does not mention the game name: "${title.textContent}"`);
  }

  // 8. CSS must be loaded — check that body background is dark (near-black)
  const bodyStyle = window.getComputedStyle(document.body);
  const bgColor = bodyStyle.backgroundColor;
  // Parse rgb/rgba to check it's dark
  const rgbMatch = bgColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (r > 50 || g > 50 || b > 50) {
      problems.push(`Body background is not dark enough: ${bgColor} — expected near-black for steampunk aesthetic`);
    }
  } else if (bgColor !== "rgb(0, 0, 0)" && bgColor !== "rgb(13, 13, 13)") {
    // Accept common dark values; if it's something else entirely, flag it
    if (!bgColor.startsWith("rgb(1") && !bgColor.startsWith("rgb(0")) {
      problems.push(`Unexpected body background color: ${bgColor} — expected dark scheme`);
    }
  }

  // 9. No horizontal overflow at either 375px or 1280px widths
  // We check the current viewport; the test should be run at both widths
  const docWidth = document.documentElement.scrollWidth;
  const viewportWidth = window.innerWidth;
  if (docWidth > viewportWidth + 1) {
    problems.push(
      `Horizontal overflow detected: document scrollWidth ${docWidth}px exceeds viewport ${viewportWidth}px — content is clipped at this width`
    );
  }

  // 10. Brass accent colour must be used somewhere on the page
  const allElements = document.querySelectorAll("*");
  let hasBrass = false;
  for (const el of allElements) {
    const color = window.getComputedStyle(el).color;
    // #c8a45c in rgb is rgb(200, 164, 92)
    if (color === "rgb(200, 164, 92)") {
      hasBrass = true;
      break;
    }
  }
  if (!hasBrass) {
    // Check for the brass class as a fallback
    if (!document.querySelector(".brass")) {
      problems.push("No brass accent colour (#c8a45c) found in computed styles — steampunk aesthetic missing");
    }
  }

  // 11. Monospace font must be applied to body
  const fontFamily = bodyStyle.fontFamily.toLowerCase();
  const monospaceKeywords = ["monospace", "courier", "consolas", "menlo", "monaco", "liberation mono"];
  const hasMonospace = monospaceKeywords.some(kw => fontFamily.includes(kw));
  if (!hasMonospace) {
    problems.push(`Body font-family "${bodyStyle.fontFamily}" does not appear to be monospace — steampunk typeface missing`);
  }

  return problems;
}