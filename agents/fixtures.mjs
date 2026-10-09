// Test fixtures shared by the suites. Not a test file itself: `npm test` runs
// only `agents/*.test.mjs`.

/** An open issue as `gh issue list --json` returns it, labels as `{ name }` objects. */
export const issue = (number, { body = "", labels = [], title = `Ticket ${number}` } = {}) =>
  ({ number, title, body, labels: labels.map((name) => ({ name })) });
