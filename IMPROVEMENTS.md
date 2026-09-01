# Improvements

Quality concerns noticed while working, kept out of the change that found them.
Each entry says what was observed, where, and why it matters. An entry leaves
only when the concern is actually addressed.

## `shared.mjs` is five modules in one file

**Where:** `agents/shared.mjs`, ~2,500 lines.

It holds the model chain, the agent runner, prompt loading, git, GitHub issues,
the project board, PRs, and a Playwright build verifier. Every agent imports from
it, so every agent depends on all of it.

The seams already exist as banner comments, and the split falls out along them:
`agent.mjs`, `github.mjs`, `verify.mjs`.

**Why it matters:** every agent can reach every capability, so the Playtester
*can* push to `main` — least privilege is enforced by two GitHub identities at the
token level and by nothing at all in code. The ESLint config also has to grant
browser globals to the whole directory, because the DOM-measuring code that runs
inside Chromium lives in the same file as the git helpers.

Deliberately not done as part of a cleanup: it touches every import in the repo,
and it should be its own change with the test suite green on both sides.

## Nothing measures whether the pipeline is working

**Where:** the pipeline as a whole. Data exists in `recordTicket` and the wiki
Changelog; nothing aggregates it.

Every guard in the system is about *not corrupting main*. There is no signal for
merged-per-day, cost-per-merged-ticket, or abandonment rate. From outside, "the Builder retried three tickets to death today" and "the
Builder shipped three" look identical.

**Why it matters:** a pipeline that quietly stops producing looks exactly like
one that is producing. Post-mortems on the Lessons page record individual
failures, but nothing records a trend, so a regression in throughput has no
surface to appear on.

A weekly line appended to a wiki `Health.md` would cover it without another
agent, or a job on an existing one.

## The Reviewer shares a model chain with the Builder it reviews

**Where:** `agents/devs.mjs` — `runBuildReviewLoop` → `reviewOpenPR`.

Builder and Reviewer are drawn from the same chain, and approval is the PAT
rubber-stamping a PR the bot opened. `verifyBuild` — syntax, lint, a real page
load, and the product's own `checks()` — is the only genuinely independent judge
in the loop.

Partly addressed: the chain is now two models from different provider families,
and `preferDifferentModel` puts the one that did NOT write the code first, so a
review is usually a genuinely different model rather than usually the same one.

**Why it matters:** `MAX_BUILDER_RETRIES: 3` still mostly buys re-rolls of a
correlated opinion — two models are more independent than one, not independent.
It argues for investing in the `checks()` contract rather than in more review
cycles, since only the former can disagree with the Builder for reasons that have
nothing to do with how a language model reads a diff.

The strongest version of that: have the Product Manager write each ticket's
acceptance criteria AS checks appended to `docs/selftest.js`, red, before the
Builder starts — `agents/prompts/product-manager.md` already promises criteria
that are "concrete, checkable", and nothing checks them.

## Nothing measures the cost of the pipeline any more

**Where:** `agents/shared.mjs` — `printRunSummary`; `agents/health.mjs`.

Spend enforcement moved to a cap on the OpenRouter key, which is the right place
for it. What went with the ledger was the only place the pipeline could SEE its
own spend: the daily total on the wiki, the digest's "requests spent" line, and
health's budget-headroom check are all gone. `printRunSummary` still reports
requests per run in the job log, and OpenRouter's dashboard has the account view.

**Why it matters:** cost-per-merged-ticket is the number that would show a
regression in how efficiently the pipeline works, and it now exists only as
scattered per-run lines in job logs nobody reads. This is the same gap as the
entry above about throughput, in a different unit — and both would be answered by
one structured line per run appended somewhere durable.
