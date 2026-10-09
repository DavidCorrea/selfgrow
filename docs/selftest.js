/**
 * Check that the garden still looks and behaves the way it promises.
 *
 * Return an array of plain-language failure messages — empty when everything
 * holds. Each message names what broke and what was expected, so an agent
 * deciding what to fix knows where to look.
 */

const PIXEL_FONT = "Press Start 2P";

/** A colour as {r,g,b,a}, or null for anything that is not one. */
function parseColor(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (text === "transparent" || text === "none") return null;

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) {
      digits = digits.split("").map((c) => c + c).join("");
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgb = text.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/
  );
  if (!rgb) return null;
  let alpha = 1;
  if (rgb[4] !== undefined) {
    alpha = rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
  }
  return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alpha };
}

const colorKey = (color) =>
  `${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)}`;

/** Every colour token declared in a `:root` block, by resolved rgb. */
function paletteTokens() {
  const tokens = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet we cannot read; none of ours are.
    }
    for (const rule of rules) {
      if (!rule.selectorText || !rule.selectorText.includes(":root")) continue;
      const declarations = /--([a-z0-9-]+)\s*:\s*([^;}]+)/gi;
      let match;
      while ((match = declarations.exec(rule.cssText || ""))) {
        const color = parseColor(match[2].trim());
        if (color && color.a > 0) tokens.set(match[1], colorKey(color));
      }
    }
  }
  return tokens;
}

function describe(el, what) {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList && el.classList.length ? `.${el.classList[0]}` : "";
  return `${what} on ${el.tagName.toLowerCase()}${id}${cls}`;
}

function checkPixelFont(problems) {
  const family = getComputedStyle(document.body).fontFamily.toLowerCase();
  if (!family.includes(PIXEL_FONT.toLowerCase())) {
    problems.push(
      `the page is not set in the pixel font: body font-family is "${family}", expected it to include "${PIXEL_FONT}".`
    );
  }

  const sources = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.style && rule.style.getPropertyValue("src")) {
        sources.push(rule.style.getPropertyValue("src"));
      }
    }
  }
  if (!sources.length) {
    problems.push("no @font-face is declared, so no pixel font ships with the page.");
  }
  for (const src of sources) {
    const urls = [...src.matchAll(/url\(([^)]*)\)/g)].map((m) =>
      m[1].replace(/["']/g, "").trim()
    );
    if (!urls.length || urls.some((url) => !url.startsWith("data:"))) {
      problems.push(
        `the pixel font is loaded from a network location (${src}) — it must ship as an embedded data: URI.`
      );
    }
  }
}

function checkPalette(problems) {
  const palette = paletteTokens();
  if (palette.size < 5) {
    problems.push(
      `could not read a palette from :root in garden.css (found ${palette.size} colour tokens) — expected the whole fixed palette declared in one place.`
    );
    return;
  }
  const allowed = new Set(palette.values());
  const offenders = [];

  const checkValue = (value, where) => {
    const color = parseColor(value);
    if (!color || color.a === 0) return;
    if (!allowed.has(colorKey(color))) offenders.push(`${where} is ${value}`);
  };

  const elements = [document.documentElement, document.body, ...document.querySelectorAll("body *")];
  for (const el of elements) {
    const style = getComputedStyle(el);
    checkValue(style.color, describe(el, "text"));
    checkValue(style.backgroundColor, describe(el, "background"));
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (style[`border${side}Style`] && style[`border${side}Style`] !== "none" &&
          parseFloat(style[`border${side}Width`]) > 0) {
        checkValue(style[`border${side}Color`], describe(el, "border"));
      }
    }
    if (style.outlineStyle && style.outlineStyle !== "none") {
      checkValue(style.outlineColor, describe(el, "outline"));
    }
    if (el.tagName.toLowerCase() === "rect") {
      checkValue(style.fill, describe(el, "sprite fill"));
    }
  }

  if (offenders.length) {
    problems.push(
      `${offenders.length} colour(s) on the page are not in the :root palette: ${offenders
        .slice(0, 6)
        .join("; ")}.`
    );
  }
}

function checkPixelEdges(problems) {
  const look = [
    ["panel", document.querySelector(".panel")],
    ["button", document.querySelector(".btn")],
  ];
  for (const [label, el] of look) {
    if (!el) {
      problems.push(`the page has no sample ${label} to show the shared pixel style.`);
      continue;
    }
    const style = getComputedStyle(el);
    if (style.borderRadius !== "0px") {
      problems.push(`the ${label} has rounded corners (${style.borderRadius}); pixel edges must be square.`);
    }
    if (parseFloat(style.borderTopWidth) < 2) {
      problems.push(`the ${label} has no visible border (top width ${style.borderTopWidth}); it must share the pixel edge.`);
    }
  }
}

async function checkPlanting(problems) {
  const countEl = document.getElementById("seed-count");
  const button = document.getElementById("plant-seed");
  if (!countEl || !button) {
    problems.push("the page is missing its seed counter (#seed-count) or its Plant a seed button (#plant-seed).");
    return;
  }

  const before = Number(countEl.textContent);
  button.click();
  const after = Number(countEl.textContent);
  if (!Number.isFinite(after) || after !== before + 1) {
    problems.push(
      `pressing Plant a seed changed the count from ${before} to "${countEl.textContent}", expected ${before + 1}.`
    );
  }
}

async function checkAgentTools(problems) {
  let tools;
  try {
    ({ tools } = await import("./agenttools.js"));
  } catch (e) {
    problems.push(`docs/agenttools.js could not be imported — ${e.message}`);
    return;
  }

  const list = tools();
  const readTool = list.find((tool) => tool.name === "get-state");
  const plantTool = list.find((tool) => tool.name === "plant-seed");
  if (!readTool || !plantTool) {
    problems.push("agenttools.js must expose both get-state and plant-seed.");
    return;
  }

  const countEl = document.getElementById("seed-count");
  if (!countEl) return;

  const shown = Number(countEl.textContent);
  const state = await readTool.execute({});
  if (state.seeds !== shown) {
    problems.push(
      `the get-state tool reported ${state.seeds} seeds but the page shows ${shown}.`
    );
  }

  const before = shown;
  await plantTool.execute({});
  const after = Number(countEl.textContent);
  if (after !== before + 1) {
    problems.push(
      `the plant-seed tool changed the page count from ${before} to ${after}, expected ${before + 1}.`
    );
  }

  // The plot is bounded: however many seeds are planted, it never shows more
  // sprouts than it holds, and the count keeps rising past that.
  let grown = state;
  for (let i = 0; i < state.plotCapacity + 3; i += 1) {
    grown = await plantTool.execute({});
  }
  if (grown.sprouts !== grown.plotCapacity) {
    problems.push(
      `after planting more seeds than the plot holds, it reports ${grown.sprouts} sprouts; expected exactly the capacity of ${grown.plotCapacity}.`
    );
  }
  if (grown.seeds <= grown.plotCapacity) {
    problems.push(
      `the seed count stopped at ${grown.seeds}, expected it to grow past the plot capacity of ${grown.plotCapacity}.`
    );
  }
}

/**
 * Check that the product still does what it claims.
 *
 * @returns {Promise<string[]>} plain-language failures; empty when all holds.
 */
export async function checks() {
  const problems = [];

  await document.fonts.ready;
  if (!document.fonts.check(`16px "${PIXEL_FONT}"`)) {
    problems.push(
      `the "${PIXEL_FONT}" pixel font did not load, so text cannot render in it.`
    );
  }

  checkPixelFont(problems);
  checkPalette(problems);
  checkPixelEdges(problems);
  await checkPlanting(problems);
  await checkAgentTools(problems);

  return problems;
}