# Improvements

Quality concerns noticed while working, kept out of the change that found them.
Each entry says what was observed, where, and why it matters. An entry leaves
only when the concern is actually addressed.

## `shared.mjs` is five modules in one file

**Where:** `agents/shared.mjs`, ~3,550 lines (and growing — it was ~2,500 when
this was written).

It holds the model chain, the agent runner, prompt loading, git, GitHub issues,
the project board, PRs, and a Playwright build verifier. Every agent imports from
it, so every agent depends on all of it.

The seams already exist as banner comments, and the split falls out along them:
`agent.mjs`, `github.mjs`, `verify.mjs`.

**Why it matters:** every agent can reach every capability, so the Playtester
*can* call anything its GitHub token allows — least privilege is enforced at the
token level and by nothing at all in code. (Partly narrowed: the git push token
now reaches only the jobs that push, so the Playtester can no longer `git push`;
it still holds a token that writes through the API.) The ESLint config also has to grant
browser globals to the whole directory, because the DOM-measuring code that runs
inside Chromium lives in the same file as the git helpers.

Deliberately not done as part of a cleanup: it touches every import in the repo,
and it should be its own change with the test suite green on both sides.

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
scattered per-run lines in job logs nobody reads. Throughput has the same gap in a
different unit: Health (`agents/health.mjs`) now alarms on quiet days, a high
abandon rate, a missing digest, a repeated finding and aborting sessions, but it
speaks only on exception, so nothing records merged-per-day as a trend. Both would
be answered by one structured line per run appended somewhere durable.

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

**Status (2026-09-25): partly addressed.** `archiveProductMemory` now logs every
thread it will archive and keep, pages through both categories, and throws —
stopping the reset before the product is deleted — when the threads cannot be
read or any rename fails; `agents/archive-memory.test.mjs` covers that against a
fake `gh`. Still open: the label is set once at creation and never revisited, an
unlabelled lesson still defaults to "keep", and nothing refuses a reset that
archives nothing while journals exist.

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

## A recovered merge writes a weaker changelog entry than a normal one

**Where:** `agents/devs.mjs` — `reconcilePullRequest`, the `passing` branch.

When a run re-arms the merge on a PR an earlier run left behind, the ticket ships
without ever passing through `landAndRecord`. The issue still closes — the PR body
says `closes #N` and GitHub does the rest — but `builderChangelogEntry` died with
the run that produced it, so the changelog line is reconstructed from the branch
name: de-slugified words and a run id stripped off the end.

**Why it matters:** the Changelog is read whole into the weekly report, so a
recovered ticket appears in the digest as a worse sentence than one that merged
normally. It is not wrong, just visibly machine-made, and the digest is the one
artefact a person actually reads.

The fix is to persist the Builder's own summary where the next run can find it —
the PR body is the obvious place, since it already survives the run that wrote it.

**Status (2026-09-25):** the PR body now always ends with `Closes #N`, so the
ticket closing no longer depends on the model writing it. The changelog line is
still reconstructed from the branch name; persisting the summary is still open.

## The product contract has time-dependent checks, and they fail at random

**Where:** `docs/selftest.js` — the plant growth-scale assertion (~line 671, "below
minimum visible scale", issue #661) and the firefly convergence assertion
(~line 7082, "deviates ... rad from the pair average", issue #639). Likely others:
anything that reads a value off a running animation.

The plant check reads `plant.group.scale.x` live and fails below 0.349. On a slow
runner the growth animation has advanced less by the time the check runs, so the
scale is lower — CI reported 0.3373 against a 0.349 threshold, a miss of 3%.

**Observed on 2026-09-16:** PR #713 failed `verify-product` on that assertion. The
same commit, re-run with no changes at all, passed. Locally it passed four times
out of four. Nothing about the diff decided the outcome; the runner's speed did.

**Why it matters:** `checks()` is the only independent judge in the pipeline —
the one gate that is not a language model grading work a language model did.
Every message it returns blocks a merge, and the Builder is told the failure is
its fault. A flaky assertion there means the pipeline strikes tickets for
failures that are not real, retries them against the same coin flip, and
eventually parks perfectly good work with a post-mortem explaining a defect that
never existed.

Issue #687 is the worked example: three attempts, three separate PRs, each
failing a DIFFERENT assertion of this kind. That read as a cursed ticket colliding
repeatedly with the contract. It was not — the third attempt merged unchanged the
moment its checks were re-run. Two sound implementations were thrown away for it.

The fix is not a wider threshold, which only makes the flake rarer. It is to stop
asserting on a live animation: drive the simulation a fixed number of steps and
assert on the result, so the check measures the code rather than the runner. The
checks that already do this — the firefly ones step explicitly — are the model to
follow.

**Why it matters more than it looks:** this is the same root as the entry above
about the Reviewer's independence, seen from the other side. That entry argues for
investing in `checks()` rather than more review cycles, because only `checks()`
can disagree with the Builder for reasons that have nothing to do with how a model
reads a diff. That argument holds only while `checks()` is right.

## An agent's tools can still reach the runner's secrets through root

**Where:** `agents/secrets.mjs`, `agents/shared.mjs` — `confinedTools`,
`gitExec`, `ghExec`; the GitHub-hosted runner itself.

Secrets no longer sit in any agent's start environment, the bash tool's children
get an allowlisted environment, and the read tool is confined to the checkout.
The whole design rests on one kernel setting: `ptrace_scope` 1 stops a process
reading its parent's memory. Three gaps remain around it:

- GitHub's runners give the runner user **passwordless `sudo`**, and root is not
  bound by `ptrace_scope`. A bash tool call can read the agent process's memory,
  where every secret now lives.
- `gh` and `git` children are started *with* `GH_TOKEN` / the push header in
  their environment. A background process the bash tool left running is the
  same user, and can read `/proc/<pid>/environ` of each later `gh` or `git`
  child while it runs.
- Only `read` and `bash` are confined. pi's `edit` and `write` tools are not, so
  an agent can write outside the checkout.

**Why it matters:** the agents read text strangers wrote (Ideas, issues, a
contributor's PR), and an injected instruction that reaches a tool call can
exfiltrate the OpenRouter key or the PAT. The PAT is the expensive one. Cheapest
mitigation: make `AGENT_PAT` a fine-grained token scoped to this one repository,
so a leak is bounded to it. The structural fix is running the tools as a
separate user, or in a container, with no `sudo`.

## Closed-issue listings are truncated without anyone noticing

**Where:** `agents/shared.mjs` — `fetchShippedIssues` (`--limit 200`);
`agents/playtest-findings.mjs` — `fetchAnswerHistory` (200 findings, 500
tickets).

Open-issue, board and PR listings now throw when a result reaches its limit.
The closed-issue listings do not: they quietly take the newest N. Today that is
harmless — they are used as recent windows (a week of shipped work, the recent
answer history), and `fetchAnswerHistory` says so in its comment.

**Why it matters:** the same "a truncated list passes for the whole" bug that
released blocked work could return if a caller starts reading one of these as
complete — a Health check counting all shipped work since the reset, say.

## Shipped work depends on GitHub's commit search index

**Where:** `agents/shared.mjs` — `fetchProductStart`, used by
`fetchShippedIssues`.

When the current product began is found by searching commits for the reset's
message, because the agents check `main` out one commit deep. Search is indexed
asynchronously, so for a while right after a reset it may not find the reset
commit, and then "no reset" means every closed ticket counts as this product's.

**Why it matters:** the window is short and a reset is rare, but the first Health
run, retro or report after a reset is exactly the one most likely to fall in it,
and it would credit the new product with the old one's work. Recording the start
somewhere the agents read directly (a wiki page the reset writes) would remove
the dependency.

## An answered finding whose ticket is parked never moves again

**Where:** `agents/playtest-findings.mjs` — `planFollowUp`.

A persisting verdict counts against an answer only once every answering ticket
is closed. A parked ticket stays open, so a finding answered by one stays
`answered` indefinitely: the Playtester's "still there" never counts, it never
escalates, and the PM does not see it again because it is no longer waiting on
an answer.

**Why it matters:** this is the dark-void failure again by a different route — a
complaint that looks handled because tickets exist for it. The Tech Lead may
eventually rule on the parked ticket, but nothing ties that ruling back to the
finding. Treating a parked answering ticket as landed, or surfacing such findings
to the PM, would close it.

## Findings closed before answers were tracked have no answer history

**Where:** `agents/playtest-findings.mjs` — `priorAnswers`,
`renderPriorAnswers`.

The `Answered by:` line only exists on findings answered since the lifecycle
landed. An earlier finding under the same title shows up in the PM's history as
"tickets not recorded (answered before answers were tracked)".

**Why it matters:** the history exists so the PM does not prescribe a failed
answer again, and the longest-running complaints are exactly the ones whose
answers predate it. It fades on its own as old findings age out, and a reset
clears it; noted so an empty history on an old complaint is not read as "nothing
was tried".
