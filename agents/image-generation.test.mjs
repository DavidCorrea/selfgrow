// The Builder's image tool. Its models are text models, so a product about cards
// or creatures shipped them as boxes of text; this is what lets it draw one. The
// rules here are what keep the pictures one product: written only into docs/,
// always from the product's style guide, and bounded per session.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { createImageTool, imageTarget, imagePrompt, imageFromResponse, STYLE_GUIDE } from "./image-generation.mjs";

const productDir = () => {
  const root = fs.mkdtempSync(join(os.tmpdir(), "image-tool-"));
  fs.mkdirSync(join(root, "docs"));
  return join(root, "docs");
};

const withStyleGuide = (docsDir, text = "Ink and watercolour, muted earth palette.") => {
  fs.mkdirSync(join(docsDir, "art"), { recursive: true });
  fs.writeFileSync(join(docsDir, "art", "style.md"), text);
  return docsDir;
};

const setup = (overrides = {}) => {
  const docsDir = overrides.docsDir ?? withStyleGuide(productDir());
  const prompts = [];
  const tool = createImageTool({
    docsDir,
    generate: async (prompt, aspectRatio) => {
      prompts.push({ prompt, aspectRatio });
      return Buffer.from("png");
    },
    encode: async (_bytes, width) => ({ bytes: Buffer.from("webp"), width, height: width }),
    ...overrides,
  });
  const make = (params) => tool.execute("call", { description: "A small fire drake.", path: "docs/art/drake.webp", ...params });
  return { docsDir, prompts, make };
};

test("where a picture may be saved", async (t) => {
  const docsDir = "/repo/docs";

  await t.test("anywhere under docs/, with or without the docs/ prefix", () => {
    assert.equal(imageTarget("docs/art/drake.webp", docsDir), "/repo/docs/art/drake.webp");
    assert.equal(imageTarget("art/drake.webp", docsDir), "/repo/docs/art/drake.webp");
  });

  await t.test("never outside the product", () => {
    assert.throws(() => imageTarget("docs/../agents/x.webp", docsDir), /outside docs\//);
    assert.throws(() => imageTarget("/etc/x.webp", docsDir), /outside docs\//);
  });

  await t.test("only as WebP", () => {
    assert.throws(() => imageTarget("docs/art/drake.png", docsDir), /must end in \.webp/);
  });
});

test("making a picture", async (t) => {
  await t.test("saves it where it was asked to, and says where", async () => {
    const { docsDir, make } = setup();
    const result = await make();
    assert.equal(fs.readFileSync(join(docsDir, "art", "drake.webp"), "utf-8"), "webp");
    assert.match(result.content[0].text, /Saved docs\/art\/drake\.webp/);
  });

  await t.test("draws it in the product's style", async () => {
    const { prompts, make } = setup();
    await make();
    assert.match(prompts[0].prompt, /## Art style\nInk and watercolour, muted earth palette\./);
    assert.match(prompts[0].prompt, /## This image\nA small fire drake\./);
  });

  await t.test("refuses until the product has a style guide", async () => {
    const { make, prompts } = setup({ docsDir: productDir() });
    await assert.rejects(make(), new RegExp(`${STYLE_GUIDE} does not exist yet`));
    assert.equal(prompts.length, 0);
  });

  await t.test("asks for the shape it was given, square by default", async () => {
    const { prompts, make } = setup();
    await make();
    await make({ aspectRatio: "2:3" });
    assert.deepEqual(prompts.map((request) => request.aspectRatio), ["1:1", "2:3"]);
  });

  await t.test("never saves wider than 1024 pixels", async () => {
    const { make } = setup();
    assert.match((await make({ width: 4000 })).content[0].text, /1024×1024/);
  });

  await t.test("stops at the session's limit without asking for more", async () => {
    const { make, prompts } = setup({ limit: 2 });
    await make();
    await make();
    await assert.rejects(make(), /already made 2 pictures/);
    assert.equal(prompts.length, 2);
  });
});

test("what the image model is asked", async (t) => {
  await t.test("keeps text out of the picture unless the description asks for it", () => {
    assert.match(imagePrompt("Pixel art.", "A sword."), /No text, letters, numbers/);
  });
});

test("reading the image model's answer", async (t) => {
  await t.test("takes the picture's bytes from the data URL", () => {
    const body = { choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${Buffer.from("png").toString("base64")}` } }] } }] };
    assert.equal(imageFromResponse(body).toString(), "png");
  });

  await t.test("says what the model said when it answered without a picture", () => {
    const body = { choices: [{ message: { content: "I cannot draw that." } }] };
    assert.throws(() => imageFromResponse(body), /answered without an image\. It said: I cannot draw that\./);
  });
});
