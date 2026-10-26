// The Builder's way to make a picture. Its models are text models, so every
// picture it made was drawn in code — CSS, hand-written SVG, a canvas — which is
// right for frames, icons and layouts and wrong for an illustration: a product
// about cards, creatures or places shipped them as styled boxes with words in
// them, because nothing could draw one.
//
// Three rules hold the pictures together as a product rather than a pile:
//   - Every image is generated with the product's own style guide, a file in
//     docs/ the first image ticket writes. The guide is the product's; this tool
//     only makes sure nothing is drawn without it, so the fortieth picture
//     belongs with the first.
//   - It writes only into docs/, as a small WebP, so what ships is reviewable,
//     committed and the same on every load — never a URL to a generator.
//   - A session may make only so many, so a looping Builder spends cents, not
//     the account.
import fs from "fs";
import { dirname, extname, join, relative, resolve, sep } from "path";
import { secret } from "./secrets.mjs";
import { repoRoot } from "./paths.mjs";

export const IMAGE_TOOL = "generate-image";

// Cheap and good at following a written style: about $0.004 a picture on
// OpenRouter, on the key the text models already use. Overridable to try another
// without a change here.
const IMAGE_MODEL = process.env.IMAGE_MODEL || "google/gemini-3.1-flash-image";

// Where the product keeps the description every picture is drawn from.
export const STYLE_GUIDE = "docs/art/style.md";

// A build that needs more than this is a set of cards, not a ticket, and a
// Builder stuck regenerating one picture should stop long before the bill does.
const IMAGES_PER_SESSION = Number(process.env.IMAGES_PER_SESSION || 12);

// Wide enough for a card or a scene on a large screen, small enough that a page
// of them still loads fast.
const MAX_WIDTH = 1024;
const WEBP_QUALITY = 0.82;

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];

const DOCS_DIR = join(repoRoot, "docs");

/**
 * The absolute file a requested path names, or a thrown reason it may not be
 * written: only a .webp inside docs/, and never the style guide itself.
 */
export function imageTarget(path, docsDir = DOCS_DIR) {
  const target = resolve(docsDir, String(path || "").replace(/^docs\//, ""));
  if (!target.startsWith(docsDir + sep)) {
    throw new Error(`"${path}" is outside docs/ — images are written only into the product.`);
  }
  if (extname(target).toLowerCase() !== ".webp") {
    throw new Error(`"${path}" must end in .webp — every image is saved as WebP.`);
  }
  return target;
}

/** What the image model is asked: the product's style, then this one picture. */
export function imagePrompt(styleGuide, description) {
  return [
    "Draw one image for a web product. Follow its art style exactly; it is shared by every image in the product.",
    "",
    "## Art style",
    styleGuide.trim(),
    "",
    "## This image",
    description.trim(),
    "",
    "No text, letters, numbers, logos or watermarks in the image unless this image's description asks for them.",
  ].join("\n");
}

/** The OpenRouter request for one picture. */
export function imageRequest(prompt, aspectRatio) {
  return {
    model: IMAGE_MODEL,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
    image_config: { aspect_ratio: aspectRatio },
  };
}

/** The picture in an OpenRouter answer, as bytes, or a thrown reason there is none. */
export function imageFromResponse(body) {
  const message = body?.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url || "";
  const match = url.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  if (!match) {
    const said = typeof message?.content === "string" && message.content.trim() ? ` It said: ${message.content.trim().slice(0, 200)}` : "";
    throw new Error(`${IMAGE_MODEL} answered without an image.${said}`);
  }
  return Buffer.from(match[1], "base64");
}

async function requestImage(prompt, aspectRatio) {
  const apiKey = secret("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set, so no image can be generated in this run.");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(imageRequest(prompt, aspectRatio)),
  });
  if (!response.ok) {
    throw new Error(`${IMAGE_MODEL} refused the request (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return imageFromResponse(await response.json());
}

/**
 * Re-encode a generated picture as a WebP no wider than `width`. Done in the
 * Chromium the pipeline already installs, because an image codec in node would
 * be a dependency for one conversion.
 */
async function toWebp(bytes, width) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const encoded = await page.evaluate(async ({ base64, width, quality }) => {
      const blob = await (await fetch(`data:application/octet-stream;base64,${base64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, width / bitmap.width);
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const webp = await canvas.convertToBlob({ type: "image/webp", quality });
      const buffer = new Uint8Array(await webp.arrayBuffer());
      let binary = "";
      for (let index = 0; index < buffer.length; index += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      }
      return { base64: btoa(binary), width: canvas.width, height: canvas.height };
    }, { base64: bytes.toString("base64"), width, quality: WEBP_QUALITY });
    return { bytes: Buffer.from(encoded.base64, "base64"), width: encoded.width, height: encoded.height };
  } finally {
    await browser.close();
  }
}

/**
 * The tool, as one Builder session gets it. The model call and the encoder are
 * injectable so the rules — where it may write, the style guide, the budget —
 * can be tested without spending anything.
 */
export function createImageTool({ docsDir = DOCS_DIR, generate = requestImage, encode = toWebp, limit = IMAGES_PER_SESSION } = {}) {
  let made = 0;
  return {
    name: IMAGE_TOOL,
    label: IMAGE_TOOL,
    description:
      "Generate a picture the product needs — an illustration, a character, a card's art, a scene — and save it in docs/ as a WebP. " +
      `Every picture is drawn in the product's art style from ${STYLE_GUIDE}; write that file first if it does not exist. ` +
      "Use it for what code draws badly; draw frames, icons, borders and layouts in CSS or SVG instead. " +
      `At most ${limit} pictures per session.`,
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "What this one picture shows. The art style comes from the style guide; do not repeat it." },
        path: { type: "string", description: "Where to save it, under docs/, ending in .webp — e.g. docs/art/cards/ember-drake.webp." },
        aspectRatio: { type: "string", enum: ASPECT_RATIOS, description: "Shape of the picture. Defaults to 1:1." },
        width: { type: "integer", minimum: 64, maximum: MAX_WIDTH, description: `Width in pixels it is saved at; at most ${MAX_WIDTH}. Pick the largest size it is shown at.` },
      },
      required: ["description", "path"],
    },
    async execute(_toolCallId, { description, path, aspectRatio = "1:1", width = 512 }) {
      const target = imageTarget(path, docsDir);
      const guidePath = join(docsDir, relative("docs", STYLE_GUIDE));
      if (!fs.existsSync(guidePath)) {
        throw new Error(`${STYLE_GUIDE} does not exist yet. Write it first — the art style every picture in this product shares, chosen to fit the Vision — then generate.`);
      }
      if (made >= limit) throw new Error(`This session has already made ${limit} pictures, the most one session may.`);
      if (!ASPECT_RATIOS.includes(aspectRatio)) throw new Error(`aspectRatio "${aspectRatio}" is not one of ${ASPECT_RATIOS.join(", ")}.`);
      made++;
      const picture = await encode(await generate(imagePrompt(fs.readFileSync(guidePath, "utf-8"), description), aspectRatio), Math.min(width, MAX_WIDTH));
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.writeFileSync(target, picture.bytes);
      const saved = relative(join(docsDir, ".."), target);
      return {
        content: [{ type: "text", text: `Saved ${saved} (${picture.width}×${picture.height}, ${Math.round(picture.bytes.length / 1024)} KB). Open it with the read tool to check it before you use it.` }],
        details: undefined,
      };
    },
  };
}
