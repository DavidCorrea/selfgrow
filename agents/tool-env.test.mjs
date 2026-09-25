// What an agent's tools can reach.
//
// The agents read text strangers wrote, and their bash and read tools run on a
// runner holding the model key and a PAT. These pin the two walls between them:
// the environment a tool subprocess inherits, and the paths the read tool opens.
import test from "node:test";
import assert from "node:assert/strict";
import { toolSubprocessEnv, isInsideRoots } from "./shared.mjs";

test("the environment a tool subprocess inherits", async (t) => {
  await t.test("drops every secret the runner holds", () => {
    const env = toolSubprocessEnv({
      PATH: "/usr/bin",
      OPENROUTER_API_KEY: "sk-or-secret",
      GH_TOKEN: "ghp_secret",
      AGENT_PAT: "ghp_secret",
      BOT_TOKEN: "ghs_secret",
      GITHUB_TOKEN: "ghs_secret",
    });
    assert.deepEqual(env, { PATH: "/usr/bin" });
  });

  await t.test("drops a variable nobody has named yet, because it is an allowlist", () => {
    assert.deepEqual(toolSubprocessEnv({ SOME_NEW_SECRET: "x", HOME: "/home/runner" }), { HOME: "/home/runner" });
  });

  await t.test("keeps what a shell, node, npm and Playwright need to run", () => {
    const needed = {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      LANG: "C.UTF-8",
      TERM: "xterm",
      CI: "true",
      TMPDIR: "/tmp",
      PLAYWRIGHT_BROWSERS_PATH: "/home/runner/.cache/ms-playwright",
    };
    assert.deepEqual(toolSubprocessEnv(needed), needed);
  });

  await t.test("keeps locale, XDG and pi's own session variables by prefix", () => {
    const kept = { LC_ALL: "C", XDG_CACHE_HOME: "/c", PI_MODEL: "m" };
    assert.deepEqual(toolSubprocessEnv(kept), kept);
  });

  await t.test("matches names exactly, so a secret cannot ride in on a lookalike", () => {
    assert.deepEqual(toolSubprocessEnv({ PATH_TOKEN: "x", HOME_PAT: "y", PIPELINE_KEY: "z" }), {});
  });
});

test("the paths the read tool opens", async (t) => {
  const roots = ["/work/selfgrow", "/tmp"];

  await t.test("reads inside the checkout", () => {
    assert.equal(isInsideRoots("/work/selfgrow/docs/index.html", roots), true);
  });

  await t.test("reads the temp dir where long bash output is spilled", () => {
    assert.equal(isInsideRoots("/tmp/pi-bash-1.log", roots), true);
  });

  await t.test("refuses the runner's own environment", () => {
    assert.equal(isInsideRoots("/proc/self/environ", roots), false);
  });

  await t.test("refuses a sibling directory that merely shares the prefix", () => {
    assert.equal(isInsideRoots("/work/selfgrow-secrets/key", roots), false);
  });
});
