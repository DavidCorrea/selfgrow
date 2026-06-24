import globals from "globals";

// Lints the app code (docs/) as browser ES modules. Intentionally minimal and
// high-confidence: catch undefined references and dead vars, nothing subjective.
export default [
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
];
