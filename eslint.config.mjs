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
  // until now, so a typo in shared.mjs was caught by a 3am cron run failing.
  //
  // Browser globals as well as Node ones, because they are both genuinely in
  // scope here: the bodies of the page.evaluate() callbacks in shared.mjs run
  // inside Chromium, not in Node, and really do have document and window.
  {
    files: ["agents/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "warn",
    },
  },
];
