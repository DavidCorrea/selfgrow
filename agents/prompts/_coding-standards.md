## Coding Standards

These standards apply to all code you write or review. They are vendored from
the project's shared rule set (DavidCorrea/ai-rules) — keep this file in sync if
those rules change.

### Code Clarity

Code is read far more than it is written. Optimize for the reader.

- Names reveal intent — a reader should understand what something does without reading its implementation. Functions describe actions (`calculateTotal`), variables describe what they hold (`remainingAttempts`), booleans read as questions (`isValid`). Avoid abbreviations unless universally understood. Short-lived variables are still variables — `contract` beats `c`.
- A function should do one thing, and its name should say what. Keep functions short (~20 lines is a smell). Prefer early returns over deep nesting.
- Code reads top-to-bottom like a story — setup, action, result. The happy path is the main flow; edge cases and errors are handled early and out of the way.
- Code should be intention-revealing. If a reader needs a comment to understand *what* it does, rewrite it. Comments earn their place by explaining *why* — non-obvious rules, tradeoffs, constraints.
- Match the codebase's existing conventions before introducing your own. New code should look like it belongs — a reader shouldn't be able to tell where one author stopped and another started. To deviate from an established pattern, flag it and explain why.
- Errors: model expected failures explicitly; let unexpected ones surface loudly rather than swallowing them behind a default. Error messages should carry enough context to be actionable.

### Simplicity

Write the least code needed to solve the problem in front of you. Nothing more.

- Solve what's in front of you, not what might come later.
- Do not abstract until the same pattern has repeated at least three times — prefer duplication over the wrong abstraction. A helper used only once is a premature abstraction.
- Remove dead code — unreachable paths, unused variables, redundant checks, dead imports, orphaned files. When a change makes something obsolete, delete it in the same change.
- Don't do work you don't need to — avoid an unnecessary call, query, or iteration; don't fetch more than you need; don't do in a loop what you can do in a batch.
- Every dependency is a tradeoff. If it's a few lines, write it yourself; reach for a proven library only for real complexity (crypto, parsing, protocols). Fewer dependencies is better, all else equal.
- Correct first, fast later. Never sacrifice clarity for performance without evidence; surface a suspected performance concern rather than silently optimizing.

### Testing

Every public interface must be tested — anything accessible from outside its
module (exported functions/classes, API endpoints, public methods). Private
helpers are covered indirectly through the public interface that uses them.

- Tests are a living spec: a developer should understand the system by reading the suite. Name tests by behavior ("rejects expired tokens"), not by method ("test validate"). Group by behavior or scenario. Cover happy path, edge cases, and failure modes.
- Each test is independent — no shared mutable state, no reliance on run order. Keep test data minimal. Mock what you don't own (HTTP, third-party APIs); don't mock your own code.
- Tests verify behavior, not implementation — a test that breaks on a behavior-preserving refactor is too coupled.
- The suite must always be green; never commit with failing tests. When you change a public interface's behavior, update its tests in the same change. When you fix a bug, first add a test that reproduces it.
- If no test infrastructure exists yet, ask before setting one up — choosing a test framework is a technology decision.
