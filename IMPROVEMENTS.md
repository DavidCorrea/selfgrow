# Improvements

Quality concerns noticed while working, kept out of the change that found them.
Each entry says what was observed, where, and why it matters. An entry leaves
only when the concern is actually addressed.

## The daily cap counts requests, but the head of the chain bills tokens

**Where:** `agents/shared.mjs` — `DAILY_REQUEST_CAP`, the ledger, every
`MODEL_REQUEST_BUDGET` in `.github/workflows/`.

`DAILY_REQUEST_CAP: 1000` is OpenRouter's free-tier *request* cap, and the whole
budgeting apparatus — the shared ledger, the four enforcement points, the blind
budget, the tail reserve — is built to hold the account under it. That apparatus
is careful and well-reasoned.

The head of the chain is now `deepseek/deepseek-v4-flash`, marked `"paid": true`,
billed per token at $0.14/$0.28 per M. A request is no longer a fixed unit of
cost: 1000 of them could be a couple of dollars or several tens, depending on
context size, and a Builder session on a large diff sits at the expensive end.
So the ledger is precise about a proxy that stopped tracking the thing it was
chosen to track.

**Why it matters:** the pipeline's most carefully engineered safety property is
currently measuring something that no longer bounds the spend. Nothing is
obviously broken, which is exactly what makes it worth writing down — the failure
mode is a surprising invoice, not a red run.

Two honest resolutions, and the choice is a real one:
- **Track cost.** pi's responses carry token usage; the ledger could record
  dollars alongside requests and enforce on both. More faithful, and more code in
  the module that is already too large.
- **Narrow the claim.** Keep the request ledger as the guard for the *free*
  fallbacks, say so plainly in `shared.mjs`, and bound the paid head some other
  way — an OpenRouter spend limit on the key, which is enforced by the provider
  rather than by us.

## `shared.mjs` is six modules in one file

**Where:** `agents/shared.mjs`, ~2,900 lines.

It holds the model chain, the request budget, the daily ledger, the agent runner,
logging, prompt loading, git, GitHub issues, the project board, the wiki, PRs,
and a Playwright build verifier. Every agent imports from it, so every agent
depends on all of it.

The seams already exist as banner comments, and the split falls out along them:
`budget.mjs`, `agent.mjs`, `github.mjs`, `wiki.mjs`, `verify.mjs`.

**Why it matters:** the budget logic is the part most worth reasoning about in
isolation — it is the one thing standing between the pipeline and the account —
and it currently cannot be read without scrolling past the git helpers and the
DOM-measuring code that runs inside Chromium. The ESLint config has to grant
browser globals to the whole directory because of that last one.

Deliberately not done as part of a cleanup: it touches every import in the repo,
and it should be its own change with the test suite green on both sides.

## Nothing measures whether the pipeline is working

**Where:** the pipeline as a whole. Data exists in `recordTicket`, the ledger,
and the wiki Changelog; nothing aggregates it.

Every guard in the system is about *not overspending* and *not corrupting main*.
There is no signal for merged-per-day, cost-per-merged-ticket, or abandonment
rate. From outside, "the Builder retried three tickets to death today" and "the
Builder shipped three" look identical.

**Why it matters:** a pipeline that quietly stops producing looks exactly like
one that is producing. Post-mortems on the Lessons page record individual
failures, but nothing records a trend, so a regression in throughput has no
surface to appear on.

A weekly line appended to a wiki `Health.md` would cover it without another
agent, or a job on an existing one.

## The Reviewer shares a model chain with the Builder it reviews

**Where:** `agents/builder-team.mjs` — the build → review loop.

Builder and Reviewer are drawn from the same chain, often the same model, and
approval is the PAT rubber-stamping a PR the bot opened. `verifyBuild` — syntax,
lint, a real page load, and the product's own `checks()` — is the only genuinely
independent judge in the loop.

**Why it matters:** `MAX_BUILDER_RETRIES: 3` mostly buys re-rolls of a correlated
opinion. It is not obviously wrong — a second pass does catch real mistakes — but
it argues for investing in the `checks()` contract rather than in more review
cycles, since only the former can disagree with the Builder for independent
reasons.

Noted rather than proposed: changing it means either a second model family for
review, or accepting the correlation deliberately.
