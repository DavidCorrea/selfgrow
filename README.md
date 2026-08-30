# selfgrow

A software team that runs itself.

Four agent roles, on GitHub Actions cron schedules, decide what to build, build
it, review each other, verify the result in a real browser, and merge to `main` —
with no human in the loop. Nothing here is dispatched by a person; the only
manual entry point is the reset.

**The product is a variable.** What currently lives in `docs/` is whatever the
pipeline has been growing lately. The `reset` workflow exists to throw that away
and keep the machine, so this README is about the machine. The one thing the
machine demands of any product is [a self-check contract](#the-product-contract).

## The team

Four roles, split by *whose judgement a decision needs* rather than by concern —
which is why there are four and not eleven.

| Role | Runs | Judgement it owns | Writes to |
| --- | --- | --- | --- |
| **Product Owner** | Mon 08:00 | Where the project is going | the Vision, the milestone, Lessons |
| **Product Manager** | daily 00:30 | What the product should and shouldn't be made of | issues, the board, the Story |
| **Tech Lead** | Thu 09:00 | Whether the codebase can absorb the next ticket | structural + coverage tickets |
| **Devs** | dispatched by the PM, then a 14:00 mop-up | How a ticket gets built | `main` |

Plus one tester and two pieces of infrastructure, which are jobs rather than
roles:

| | Runs | What it does |
| --- | --- | --- |
| **QA (Playtester)** | Wed 10:00 | Plays the live app and files what the experience was like |
| **Health** | daily 16:00 | Measures the pipeline itself; silent unless something is broken |
| **pi-update** | Tue 07:00, and on PRs | Dependabot for the model chain |
| **reset** | manual only | Tears the product down, keeps the machine |

### Why these four

**The Product Owner looks back in order to point forward.** Its retro reads what
shipped, what got parked, and what QA keeps saying, then writes the conclusion to
Lessons — the only record of a *trend* rather than one ticket's failure. What
that judgement changes is the milestone: what the project is trying to do next.
Priority alone can only say which ticket comes first; without a milestone the
backlog fills by adjacency, every ticket found next to whatever shipped last,
each individually sound and the whole adding up to nothing in particular.

**The Product Manager adds and subtracts in the same breath.** Deciding what the
product should stop doing is the same judgement as deciding what it should start
doing, so one role weighs both in a single pass. Splitting them meant the
subtractive half proposed removals blind to what the additive half was adding
that same week.

**The Tech Lead is the only role that reads the whole codebase.** Everything else
in engineering is scoped to one ticket — one plan, one diff, one review. It owns
structure, it owns `docs/selftest.js` (the only independent judge in the
pipeline, and until recently never read whole by anyone), and it decides what
happens to tickets the Devs gave up on, because "why did this fail" is a
technical question.

**QA is deliberately not the PM.** It plays the app and reports; the PM decides
what to do about it. The observer shouldn't be the person who acts on the
observation — the same reason the Devs don't review their own work. Its findings
are `playtest`-labelled issues that the Devs *cannot* pick up: they are
impressions, not work.

### Why the cadences

The PM runs just after OpenRouter's free-tier cap resets at 00:00 UTC, so the
day's chain starts against a full allowance. It dispatches the Devs explicitly
when grooming actually left buildable work — that used to trigger on workflow
completion, and one grooming pass creating 8 tickets produced 9 Devs runs. The
weekly roles sit on separate days so they never compete for the same day's
requests. The 14:00 Devs run is a mop-up: it claims whatever the ledger says is
genuinely left, because unspent requests expire at midnight.

Sunday and Monday are the hinge. The PM's Sunday run also curates and writes the
week's report; the PO reads that week on Monday and sets the milestone the PM
grooms against for the next six days.

## How one ticket ships

`agents/devs.mjs` drains a queue in a single job, re-reading the board before
each ticket — so a merge that unblocks a dependent one makes it available
immediately.

```
Scout ──► Builder ──► verify ──► Reviewer ──► verify ──► merge
             ▲                       │
             └───── revise, ≤3 ──────┘
```

- **Scout** picks the highest-priority buildable ticket and plans it. It does not
  judge whether the ticket should exist — the PM settled that at 00:30, and
  asking twice meant the later answer silently overrode the earlier one.
- **Builder** writes the code on a branch.
- **Verify** runs in four layers, cheapest first: `node --check`, ESLint, a real
  Chromium page load watching for console errors and uncaught exceptions, and
  finally the product's own `checks()`. The last layer only runs when the page is
  already sound — check failures on a throwing page are noise from one root
  cause. It runs again after merging `main`, so the branch is still good against
  what shipped meanwhile.
- **Reviewer** critiques the diff, drawn from a *different model* than wrote it
  where the chain allows. Review is only worth its request if it can disagree.
- **PR** is opened by `github-actions[bot]` and approved by the account's PAT.
  Two identities, on purpose: GitHub won't let an author approve their own PR.

Failure is a first-class path. A ticket that fails accrues strikes and is parked
once it has spent them, so the Scout stops re-picking it; the Tech Lead then
decides whether it comes back smaller or not at all. Merge conflicts get their
own agent. Every dead end is written up as a post-mortem on the wiki's Lessons
page, which the *next* Scout reads before planning — framed as advice, not law: a
lesson describes one failed attempt, not a verdict that the work is impossible.

## What holds it together

Most of the interesting code is not the agents. It is the constraints that let
them run unattended without setting money on fire or corrupting `main`.

**Budget.** A shared daily ledger (stored on the wiki) counts *real model
requests* against a hard cap of 1000/day, and every job reads it before it
spends. Per-run allowances sit under that ceiling, not beside it. Enforcement
happens at four points, because three of them have each been the hole: `runAgent`
refuses to start a session once the budget is spent; `MAX_SESSION_TURNS` aborts a
session that runs away *inside* one; the build→review loop refuses to start a
Builder it cannot afford to review; and retries are skipped when the remainder is
thin. The budget once counted agent *sessions* rather than requests,
understating the charge by roughly 16x — a "250" budget authorised several
thousand calls, and the account fell over while the counter read 62.

**Time.** Every limit is nested so the agent stops itself before anything else
stops it: a session has a turn and minute cap, a run has a wall-clock budget
checked *between* tickets so it finishes cleanly after a merge, and the job
timeout above both is a backstop for a hang. A run killed mid-ticket leaves a
branch and an open PR behind; a run that stops itself does not.

**Concurrency.** Everything that writes to `main` shares one `agent-main-writer`
lock. Each role has its own lock besides — two PMs would dedup against a board
neither had finished writing. And every wiki write is a retried
read-modify-write against the live remote, because the ledger pushes to that same
repo after every session: the naive version lost that race on ~100 consecutive
merges, logged a warning, and let each run report success.

**Models.** `agents/models.json` is an ordered fallback chain, held as data so
automation can rewrite it safely: a cheap paid head, then five free models from
four provider families, ordered by how reliably they hold a structured response
envelope. Any error falls through to the next entry, including an exhausted
balance. `pi-update` re-probes it weekly against the installed `pi-coding-agent`,
replacing only entries that have actually broken.

**Someone watching.** Health reads what the pipeline writes down and asks whether
the week looks like a working one: is anything shipping, is the changelog keeping
up, are tickets failing faster than they merge, is the day's allowance always
spent, did a weekly agent stop working. No model, no browser, no API key — it
has to keep working on a day the budget is spent, which is exactly a day worth
measuring. It files an issue only when something is wrong.

## The product contract

The only thing the machine requires of what it is building. Everything else —
structure, features, naming, how any of it works — is the agents' to decide.

`docs/` is a static site with an `index.html`, and it exports one function:

```js
// docs/selftest.js
export async function checks() {
  // Return plain-language failure messages; empty when everything holds.
  return [];
}
```

Every message it returns fails the build and blocks the merge. Syntax, lint and a
clean page load prove the code *runs*; only this proves it still does what it
claims — which is exactly the failure most likely to ship, because everything
else looks green. It is the one judge in the loop that can disagree with the
Builder for reasons the Builder doesn't share, which is why the Tech Lead owns
it.

## Where the memory lives

The agents are stateless. Every run starts from a fresh checkout, so all
continuity is deliberately outside the repo:

- **The Project board** is the queue — priority, blocking dependencies, and each
  card's Todo → In progress → In review → Done position.
- **Milestones** are the horizon: one open at a time, set by the PO, and every
  ticket the PM proposes is assigned to it.
- **Issues** are the tickets, with strikes recorded in the body where the next
  Scout will read them.
- **The wiki** holds the durable prose: `Vision.md` (what the product is for),
  `Changelog.md` (what shipped), `Story.md` (the narrative), `Lessons.md` (what
  failed and why, and what each week amounted to), and `Budget.md` (the ledger).

## Filing something yourself

An issue you open by hand is picked up like any other — but the pipeline knows it
came from you, and treats it differently in two places.

Provenance needs no tagging on your part: `createIssue` stamps every ticket the
agents write with an `agent` label, so a ticket **without** one came from outside.
Absence is the reliable test precisely because no human action maintains it —
there is nothing to forget.

- **The PM may sharpen your ticket, but not retire it for being vague.** Grooming
  is told to close anything it cannot describe concretely, and a request typed
  quickly is often that shape — so the one channel for getting work into this
  system used to end in a silent drop. Now, if your ticket is too thin to build,
  the PM rewrites it with acceptance criteria and keeps its number. Closing it
  requires declaring it out of scope, which is a judgement about the *request*
  rather than about the wording.
- **The weekly digest tells you what became of it** — shipped, still queued, or
  stuck — in a section of its own.

What it does *not* get: a milestone. Only tickets the PM originates are assigned
to one, so yours sits outside the current horizon.

A PR you open by hand is almost entirely ignored: nothing reads pull requests it
did not open, and nothing will approve or merge one for you. CI runs if it
touches `agents/`. Note that a manual PR touching `docs/` reaches production
without `verifyBuild` — the pipeline holds itself to a standard it cannot hold
you to. Avoid naming a branch `agent/*`: the reset sweeps that prefix.

## Being told what happened

The pipeline decides everything itself, and reports on two channels that never
ask you for anything:

- **The weekly digest**, filed by the PM each Sunday — what the garden grew,
  grouped by what the work adds up to rather than by ticket; what QA noticed;
  what's stuck; the current milestone. It @-mentions the owner so it arrives as a
  notification, then closes itself immediately: an open issue addressed to a
  human is a human on the critical path.
- **Health alerts**, only when something breaks. Silence means fine.

## Running it

Secrets:

| Name | Used for |
| --- | --- |
| `OPENROUTER_API_KEY` | every model call |
| `AGENT_PAT` | issues, the board, milestones, the wiki, and approving PRs |
| `GITHUB_TOKEN` | opening PRs as a second identity (built in) |

The PAT needs `project` scope. Set `GH_PROJECT_OWNER` and `GH_PROJECT_NUMBER` in
the workflows to point at your board.

Development: `npm test` runs the harness's own suite, `npm run lint` covers both
`agents/` and `docs/`, and CI gates both on every PR that touches the pipeline.

To start over: pause the workflows and dispatch `reset`, typing the repository
name to confirm. It cancels pending runs, closes open issues and agent PRs,
clears the board, resets the wiki's memory pages, and deletes the product from
`main` — leaving the machine, an empty `docs/`, and a full night's request
budget.
