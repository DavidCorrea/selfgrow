// Where the runner's secrets live.
//
// A process's START environment stays readable through /proc/<pid>/environ by
// every process of the same user — the agents' bash tool included — so in CI no
// secret may be in the agent's environment at all. They arrive in a file that is
// read and deleted on import. These pin that route, the fallback that keeps
// scripts runnable by hand, and the guard that refuses the old route in CI.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import { join } from "path";
import { parseSecrets, takeSecrets, gitAuthEnv } from "./secrets.mjs";
import { ghExec } from "./shared.mjs";

const tempDir = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-secrets-"));
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

let fileCount = 0;
const tempFile = (contents) => {
  const path = join(tempDir, `agent-secrets-${++fileCount}`);
  fs.writeFileSync(path, contents, { mode: 0o600 });
  return path;
};

test("the secrets file", async (t) => {
  await t.test("reads one NAME=value per line, keeping any = inside the value", () => {
    assert.deepEqual(parseSecrets("GH_TOKEN=ghp_a=b\nOPENROUTER_API_KEY=sk-or\n"), {
      GH_TOKEN: "ghp_a=b",
      OPENROUTER_API_KEY: "sk-or",
    });
  });

  await t.test("skips blank lines and empty values", () => {
    assert.deepEqual(parseSecrets("\nBOT_TOKEN=\nGIT_TOKEN=ghp\n\n"), { GIT_TOKEN: "ghp" });
  });

  await t.test("refuses a name it does not know, without quoting the line", () => {
    assert.throws(
      () => parseSecrets("GH_TOKNE=ghp_canary"),
      (error) => /line 1 names no known secret/.test(error.message) && !error.message.includes("ghp_canary")
    );
  });

  await t.test("is deleted once read", () => {
    const path = tempFile("GH_TOKEN=ghp_file\n");

    assert.deepEqual(takeSecrets({ CI: "true", AGENT_SECRETS_FILE: path }), { GH_TOKEN: "ghp_file" });
    assert.equal(fs.existsSync(path), false);
  });
});

test("where secrets come from without a file", async (t) => {
  await t.test("a script run by hand takes them from its environment", () => {
    assert.deepEqual(takeSecrets({ GH_TOKEN: "ghp_local", PATH: "/usr/bin" }), { GH_TOKEN: "ghp_local" });
  });

  await t.test("CI refuses a secret in the environment, naming it but not its value", () => {
    assert.throws(
      () => takeSecrets({ CI: "true", OPENROUTER_API_KEY: "sk-or-canary" }),
      (error) => /OPENROUTER_API_KEY reached this process's environment/.test(error.message) && !error.message.includes("canary")
    );
  });

  await t.test("CI refuses it even when a file is given too", () => {
    const path = tempFile("GH_TOKEN=ghp_file\n");
    assert.throws(() => takeSecrets({ CI: "true", AGENT_SECRETS_FILE: path, GH_TOKEN: "ghp_env" }), /GH_TOKEN/);
  });

  await t.test("CI with no secrets at all has none, rather than failing — the test and verify jobs", () => {
    assert.deepEqual(takeSecrets({ CI: "true", PATH: "/usr/bin" }), {});
  });
});

test("how git is given a token", async (t) => {
  await t.test("as the same basic-auth header actions/checkout writes, in the environment", () => {
    const env = gitAuthEnv("ghp_push");
    assert.equal(env.GIT_CONFIG_COUNT, "1");
    assert.equal(env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
    const [, basic] = env.GIT_CONFIG_VALUE_0.match(/^AUTHORIZATION: basic (.+)$/);
    assert.equal(Buffer.from(basic, "base64").toString(), "x-access-token:ghp_push");
  });

  await t.test("not at all without one, so a person's own credentials still apply", () => {
    assert.deepEqual(gitAuthEnv(""), {});
  });
});

test("gh is handed its token in its own environment", () => {
  const fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-fake-gh-"));
  fs.writeFileSync(join(fakeBin, "gh"), '#!/bin/sh\nprintf %s "$GH_TOKEN"\n', { mode: 0o755 });
  const realPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${realPath}`;
  try {
    assert.equal(ghExec(["auth", "status"], { token: "ghs_bot" }), "ghs_bot");
  } finally {
    process.env.PATH = realPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});

// End to end, in a real child started the way CI starts an agent: only the
// file's path in its environment. It then does what an injected tool would and
// what gitExec does, and reports what each could see.
test("an agent loaded from the secrets file", () => {
  const canary = "ghp_canary_" + process.pid;
  const path = tempFile(`GH_TOKEN=${canary}\nGIT_TOKEN=${canary}\nOPENROUTER_API_KEY=sk-${canary}\n`);
  const probe = `
    import { execFileSync } from "child_process";
    import { secret } from "./secrets.mjs";
    import { toolSubprocessEnv, gitExec } from "./shared.mjs";
    const parentEnviron = process.platform === "linux"
      ? execFileSync("sh", ["-c", "cat /proc/$PPID/environ"]).toString()
      : null;
    console.log(JSON.stringify({
      loaded: secret("GH_TOKEN"),
      toolEnv: JSON.stringify(toolSubprocessEnv(process.env)),
      parentEnviron,
      gitHeader: gitExec(["config", "--get", "http.https://github.com/.extraheader"]),
    }));
  `;
  const seen = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: import.meta.dirname,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "true", AGENT_SECRETS_FILE: path },
    }).toString()
  );

  assert.equal(seen.loaded, canary, "the agent did not get its secret");
  assert.equal(fs.existsSync(path), false, "the secrets file outlived the import");
  assert.ok(!seen.toolEnv.includes(canary), "a tool subprocess would inherit the secret");
  if (seen.parentEnviron !== null) {
    assert.ok(!seen.parentEnviron.includes(canary), "a child can read the secret in /proc/$PPID/environ");
  }
  assert.match(seen.gitHeader, /^AUTHORIZATION: basic /, "gitExec did not carry the push token");
});
