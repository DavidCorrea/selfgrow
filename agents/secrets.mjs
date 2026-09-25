// The runner's credentials, held where no tool subprocess can read them.
//
// A process's START environment is readable by any process of the same user for
// as long as it lives, through /proc/<pid>/environ — and deleting a variable from
// process.env afterwards does not change it. The agents' bash tool runs as that
// same user, so a node process STARTED with the model key and the PAT in its
// environment handed both to one `cat /proc/$PPID/environ`, however carefully
// its tools' own environments were filtered.
//
// So in CI no secret is ever in the agent's environment. A preceding step
// (.github/actions/secrets) writes them to a mode-600 file, the node step gets
// only its path in AGENT_SECRETS_FILE, and this module reads the file and
// deletes it on import — before any model runs. From then on the values live
// only in this module's memory, which a child cannot read: on GitHub's runners
// kernel.yama.ptrace_scope is 1, so a process may not open its parent's memory.
// They reach a child only where one needs them and is not model-controlled: gh
// and git (as GH_TOKEN and a git config header), and pi, in-process.
//
// This is the bottom layer beside log.mjs: wiki.mjs and shared.mjs both
// authenticate with it, and wiki.mjs cannot import shared.mjs.
import fs from "fs";

// Every name this pipeline treats as a secret. Checked in CI against the
// environment, so a workflow that still passes one the old way fails loudly
// instead of quietly re-opening the hole.
export const SECRET_NAMES = ["OPENROUTER_API_KEY", "GH_TOKEN", "AGENT_PAT", "BOT_TOKEN", "GITHUB_TOKEN", "GIT_TOKEN"];

/**
 * `NAME=value` lines into { NAME: value }. Blank lines are skipped. An unknown
 * name throws — a typo in a workflow would otherwise drop a credential silently —
 * and no error ever quotes a value.
 */
export function parseSecrets(text) {
  const secrets = {};
  for (const [index, line] of text.split("\n").entries()) {
    if (!line) continue;
    const separator = line.indexOf("=");
    const name = separator > 0 ? line.slice(0, separator) : "";
    if (!SECRET_NAMES.includes(name)) {
      throw new Error(`Secrets file line ${index + 1} names no known secret (expected one of ${SECRET_NAMES.join(", ")}).`);
    }
    const value = line.slice(separator + 1);
    if (value) secrets[name] = value;
  }
  return secrets;
}

/**
 * The run's secrets, from the file AGENT_SECRETS_FILE names (deleted once read)
 * or, when it is unset, from the environment — so a script run by hand still
 * works with the variables it always took.
 *
 * In CI the environment route is refused outright: a secret found there means
 * the process started with it, and /proc already has it.
 */
export function takeSecrets(env = process.env) {
  const exposed = SECRET_NAMES.filter((name) => env[name]);
  if (env.CI === "true" && exposed.length) {
    throw new Error(
      `${exposed.join(", ")} reached this process's environment, where any tool subprocess can read it ` +
        `from /proc. In CI, pass secrets through .github/actions/secrets instead.`
    );
  }
  const path = env.AGENT_SECRETS_FILE;
  if (!path) return Object.fromEntries(exposed.map((name) => [name, env[name]]));
  const text = fs.readFileSync(path, "utf-8");
  fs.rmSync(path);
  return parseSecrets(text);
}

const secrets = takeSecrets();

/** A secret's value, or "" when this run was not given it. */
export const secret = (name) => secrets[name] || "";

/**
 * The environment additions that make git send `token` to github.com, or {} for
 * no token (git then uses whatever credentials it has — a person's own, locally).
 *
 * An environment-supplied config header rather than a token in the remote URL or
 * checkout's persisted credentials, because both of those sit on disk inside the
 * checkout or the temp dir, where the agents' read and bash tools can open them.
 * This is the same header actions/checkout writes; GIT_CONFIG_COUNT keeps it in
 * the one git process that needs it.
 */
export function gitAuthEnv(token) {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}
