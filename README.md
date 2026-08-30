# selfgrow

A software pipeline that runs itself.

Seven agent roles, on GitHub Actions cron schedules, groom their own backlog,
plan work, write code, review each other, verify the result in a real browser,
and merge to `main` — with no human in the loop. Nothing here is dispatched by a
person; the only manual entry point is the reset.

**The product is a variable.** What currently lives in `docs/` is whatever the
pipeline has been growing lately. The `reset` workflow exists to throw that away
and keep the machine, so this README is about the machine. The one thing the
machine demands of any product is [a self-check contract](#the-product-contract).

## The loop

Each role is a workflow in `.github/workflows/` and a script in `agents/`.

| Agent | Runs | Judgement it owns | Writes to |
| --- | --- | --- | --- |
| Product Owner | Mon 08:00 | What the product should become | the Vision (wiki) |
| Product Manager | daily 00:30 | Which work is worth a ticket | issues, the board |
| Builder Team | dispatched by the PM, then a 14:00 mop-up | How a ticket gets built | `main` |
| Scribe | Thu 09:00 | How the product reads to an outsider | the wiki narrative |
| Curator | Sat 09:00 | What should be *removed* | issues |
| pi-update | Tue 07:00, and on PRs | Which models still work | `agents/models.json` |
| reset | manual only | — | tears the product down |

The cadences are deliberate. The PM runs just after OpenRouter's free-tier cap
resets at 00:00 UTC, so the day's chain starts against a full allowance. It
dispatches the Builder explicitly when grooming actually left buildable work —
it used to trigger on workflow completion, and one grooming pass that created
8 tickets produced 9 Builder runs. The weekly roles sit on separate days so they
never compete for the same day's requests. The 14:00 Builder run is a mop-up: it
claims whatever the ledger says is genuinely left, because unspent requests
expire at midnight and do not roll over.

## How one ticket ships

`agents/builder-team.mjs` drains a queue of tickets in a single job, re-reading
the board before each one — so a merge that unblocks a dependent ticket makes it
available immediately.

```
Scout → Validator → Builder → Reviewer → verify → PR → approve → merge
```

- **Scout** picks the highest-priority buildable ticket and plans it. It may
  instead judge the ticket out of scope (closed as invalid) or too big — in
  which case it splits it into ordered children and builds nothing this pass.
- **Validator** judges the *plan* against the Vision before a line is written.
  A rejection sends the Scout round again with the feedback; a verdict of
  "already built" closes the ticket as a duplicate rather than burning retries
  on work that exists.
- **Builder** writes the code on a branch.
- **Reviewer** critiques the diff, and its findings feed straight back into
  another Builder pass.
- **Verify** runs in four layers, cheapest first: `node --check` for syntax,
  ESLint, a real Chromium page load watching for console errors, uncaught
  exceptions and failed requests, and finally the product's own `checks()`. The
  last layer only runs when the page is already sound — check failures on a
  throwing page are noise from the same root cause.
- **PR** is opened by `github-actions[bot]` and approved by the account's PAT.
  Two identities, on purpose: GitHub won't let an author approve their own PR.

Failure is a first-class path. A ticket that fails accrues strikes and is
retired once it has spent enough of them, so the Scout stops re-picking it every
run. Merge conflicts get their own agent. And every dead end is written up as a
post-mortem on the wiki's Lessons page, which the *next* Scout reads before
planning — framed as advice, not law: a lesson describes one failed attempt, not
a verdict that the work is impossible.

## What holds it together

Most of the interesting code is not the agents. It is the four constraints that
let them run unattended without setting money on fire or corrupting `main`.

**Budget.** A shared daily ledger (`agents/shared.mjs`, stored on the wiki)
counts *real model requests* against a hard cap of 1000/day, and every job reads
it before it spends. Per-run allowances sit under that ceiling, not beside it.
Enforcement happens at four points, because three of them have each been the
hole: `runAgent` refuses to start a session once the budget is spent;
`MAX_SESSION_TURNS` aborts a session that runs away *inside* one; the
build→review loop refuses to start a Builder it cannot afford to review; and
retries are skipped when the remainder is thin. The budget once counted agent
*sessions* rather than requests, understating the charge by roughly 16x — a
"250" budget authorised several thousand calls, and the account fell over while
the counter read 62.

**Time.** Every limit is nested so the agent stops itself before anything else
stops it: a session has a turn and minute cap, a run has a wall-clock budget
checked *between* tickets so it finishes cleanly after a merge, and the job
timeout above both is a backstop for a hang, not the usual exit. A run killed
mid-ticket leaves a branch and an open PR behind; a run that stops itself does
not.

**Concurrency.** Everything that writes to `main` — the Builder and the
dependency bump — shares one `agent-main-writer` lock, so no two runs race on a
push. Each other role has its own lock: two Curators would propose the same
removals twice, and two PMs would dedup against a board neither had finished
writing.

**Models.** `agents/models.json` is an ordered fallback chain, held as data so
automation can rewrite it safely: a cheap paid head, then five free models from
four provider families, ordered by how reliably they hold a structured response
envelope. Any error falls through to the next entry, including an exhausted
balance. `pi-update` re-probes the chain weekly against the installed
`pi-coding-agent`, replacing only entries that have actually broken, and a free
check job asserts the chain on every PR that could invalidate it.

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

Every message it returns fails the build and blocks the merge. Syntax, lint and
a clean page load prove the code *runs*; only this proves it still does what it
claims — which is exactly the failure most likely to ship, because everything
else looks green.

## Where the memory lives

The agents are stateless. Every run starts from a fresh checkout, so all
continuity is deliberately outside the repo:

- **The Project board** is the queue — priority, blocking dependencies, and each
  card's Todo → In progress → In review → Done position.
- **Issues** are the tickets, with strikes and split lineage recorded in the body
  where the next Scout will read them.
- **The wiki** holds the durable prose: `Vision.md` (what the product is for),
  `Changelog.md` (what shipped), `Lessons.md` (what failed and why), and
  `Budget.md` (the spend ledger).

## Running it

Secrets:

| Name | Used for |
| --- | --- |
| `OPENROUTER_API_KEY` | every model call |
| `AGENT_PAT` | issues, the Project board, the wiki, and approving PRs |
| `GITHUB_TOKEN` | opening PRs as a second identity (built in) |

The PAT needs `project` scope. Set `GH_PROJECT_OWNER` and `GH_PROJECT_NUMBER` in
the workflows to point at your board.

To start over: pause the workflows and dispatch `reset`, typing the repository
name to confirm. It cancels pending
runs, closes open issues and agent PRs, clears the board, resets the wiki's
memory pages, and deletes the product from `main` — leaving the machine, an
empty `docs/`, and a full night's request budget.
