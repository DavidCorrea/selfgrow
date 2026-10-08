import globals from "globals";

// Two bodies of code with different homes, linted as what they actually are.
// Intentionally minimal and high-confidence in both: catch undefined references
// and dead vars, nothing subjective.
export default [
  // The app (docs/) — browser ES modules, written by the Builder. Failures here
  // block a merge, so the rules stay strictly mechanical.
  {
    files: ["docs/**/*.js", "docs/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "warn",
    },
  },
  // The pipeline itself (agents/) — Node ES modules. Went unlinted entirely
  // until now, so a typo in the agent code was caught by a 3am cron run failing.
  {
    files: ["agents/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "warn",
    },
  },
  // The agent files whose page.evaluate() and addInitScript() callback bodies run
  // inside Chromium, not in Node, and really do have document and window. Only
  // these, so a stray `window` anywhere else in the pipeline is still caught.
  {
    files: ["agents/verify.mjs", "agents/playtester.mjs", "agents/skills/interface-performance/measure.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
