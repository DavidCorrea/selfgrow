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

## Nothing catches a semantically duplicated ticket

**Where:** `agents/product-manager.mjs` — `groomBacklog`.

The dedup is now a single deterministic pass over title tokens at a 0.9
similarity threshold, which catches only near-identical titles. The model pass
that caught reworded duplicates is gone: it deleted all three of the Playtester's
first findings-turned-tickets in one 5.9-second call on 2026-09-01, and three
sound proposals on 2026-08-26.

So a proposal that asks for work already queued in different words will now reach
the board. That is the intended trade — a duplicate costs one grooming pass to
retire, and the PM reads the whole board every morning — but it is a real gap
rather than a solved problem.

**Why it matters:** if duplicates start accumulating faster than grooming retires
them, the board stops being a queue and the Builder spends real sessions on work
already done. The signal to watch for is retirements citing "already queued"
climbing run over run.

Worth noting what would close it properly: the same thing that would fix the
Reviewer's independence. A ticket whose acceptance criteria are executable checks
is a duplicate exactly when its checks already pass — which is a question the
pipeline can answer by running them, rather than by asking a model to compare
prose.

## Memory is scoped by a label nobody is required to set

**Where:** `agents/discussions.mjs` — `archiveProductMemory`, `SCOPE_LABELS`;
`agents/reset.mjs` — `resetDiscussionMemory`.

`reset` deletes the product and keeps the machine, and that distinction now has to
reach the pipeline's memory: a Lessons thread about the harness ("a transient
provider error read as an empty account") should outlive a reset, while one about
this garden's weather work should not. The split is made by a `product` /
`machine` label, and only `product` is archived.

Two soft spots. The label is applied when a thread is CREATED and never revisited,
so a class that turns out to be the other kind keeps the wrong scope forever. And
an unlabelled thread survives a reset by default — deliberately, because
archiving a machine lesson costs more than keeping a product one, but it means a
labelling failure silently defaults to "keep" and a stale product lesson can reach
a new product.

**Why it matters:** the failure is quiet in both directions and only visible after
a reset, which is the one moment nobody is watching closely. A `reset` that lists
what it is about to archive, and refuses to archive nothing at all when journals
exist, would catch it.

Nothing verifies the scope, either: the only real test of `archiveProductMemory`
is a reset, and running one to check it destroys the thing it is testing.

## Decisions are ranked by recency, which is the wrong axis

**Where:** `agents/discussions.mjs` — `readDecisions`, `DECISION_BODIES`.

Decisions have no natural ranking. A lesson recurs, so its comment count sorts it;
a decision happens once. So the reader shows every title and the four
most-recently-updated bodies — and on the first live read, the two truncated to
title-only were *"The model chain is two paid models from different provider
families"* and *"Spend is capped on the OpenRouter key"*: the two most foundational
decisions in the project, hidden because they were recorded first.

That is evidence the ranking is wrong rather than a hypothetical. Recency measures
when something was written down, not how load-bearing it is.

**Why it matters:** the whole category exists so a role does not re-decide a
settled question, and the ones most expensive to re-decide are the oldest. The
prompt tells a reader to say "there is a decision about this I cannot see" rather
than reason from scratch, which contains the damage but does not fix it.

Raising `DECISION_BODIES` works while there are six and stops working at sixty.
What would actually fix it: a label per area (`models`, `spend`, `process`) so a
reader gets the decisions touching what it is about to change, or a `foundational`
label that always carries its body.
