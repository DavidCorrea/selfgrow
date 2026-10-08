# Structure

How this repository is organized. Domain vocabulary lives in `DOMAIN.md`;
quality concerns noticed but not fixed live in `IMPROVEMENTS.md`.

Two bodies of code share the repo and never mix: **the machine** (`agents/`),
which is hand-maintained, and **the product** (`docs/`), which the machine grows
and `reset` deletes. Every convention below follows from that split.

## Top level

| Path | What lives there |
| --- | --- |
| `agents/` | the pipeline: role entrypoints, shared libraries, unit tests |
| `agents/prompts/` | Markdown system prompts and shared `_`-prefixed fragments |
| `agents/skills/` | harness skills, one `<name>/SKILL.md` each — know-how that holds for any product, given only to the roles that name it |
| `docs/` | the product — a static site served from GitHub Pages |
| `.github/workflows/` | one workflow per scheduled or triggered agent run |
| `.github/actions/setup/` | composite setup action reused by the workflows |
| `.github/actions/secrets/` | writes the run's secrets to a mode-600 file, so no agent process starts with them in its environment |
| `.github/ISSUE_TEMPLATE/` | `problem.yml`, `request.yml`, `config.yml` — human intake |

Root files: `package.json`, `eslint.config.mjs`, `README.md`, `DOMAIN.md`,
`STRUCTURE.md`, `IMPROVEMENTS.md` — all on the `reset` keep-list.
No build step, no bundler, no `src/`–`dist/` split.

## `agents/` — entrypoints

Each is invoked as `node agents/<name>.mjs` by the workflow named beside it.

| File | Workflow / trigger | Does |
| --- | --- | --- |
| `devs.mjs` | `devs.yml` — after the PM, + cron 14:00 | Scout → Builder → Reviewer; drains the buildable queue in one job |
| `plan-build.mjs` | `devs.yml`, first step | decides whether a Devs run has anything to do at all |
| `product-manager.mjs` | `product-manager.yml` — daily 00:30 + 12:30 | grooms the backlog; the Sunday 00:30 run also curates and writes the weekly report |
| `product-owner.mjs` | `product-owner.yml` — Mon 08:00 | weekly retro; sets Vision and milestone |
| `tech-lead.mjs` | `tech-lead.yml` — Thu 09:00 | whole-codebase shape review, selftest health, diagnoses of parked tickets |
| `playtester.mjs` | `playtester.yml` — daily 23:00 | plays the live site, runs App Review, files experiential findings and measured accessibility barriers |
| `health.mjs` | `health.yml` — daily 16:00 | measures the pipeline; silent unless something is broken |
| `review-pr.mjs` | `review-pr.yml` — `pull_request` | the Devs applied to a human PR on a same-repo branch |
| `triage-fork-pr.mjs` | `triage-fork-pr.yml` — `pull_request_target` | read-only review of a fork PR; never runs its code |
| `pi-update.mjs` | `pi-update.yml` — Tue 07:00 | bumps the pi coding agent; reverts if the model chain breaks |
| `model-check.mjs` | `pi-update.yml`, second step | asserts the model chain against pi's bundled snapshot |
| `verify-product.mjs` | `ci.yml` | runs `verifyBuild()` as a job whose exit code a ruleset can require |
| `reset.mjs` | `reset.yml` — `workflow_dispatch` | deletes the product (through a `reset/` PR), keeps the machine |

## `agents/` — libraries

Imported, never invoked by a workflow.

Each owns one concern, and an agent imports from the module that owns what it
uses. Listed from the bottom layer up:

- `paths.mjs` — `repoRoot`, `agentsDir`, `promptsDir`.
- `log.mjs` — the bottom layer: structured logging, run history, the ticket
  ledger behind the run summary. Depends only on `fs`/`env` so `wiki.mjs` can log
  without an import cycle.
- `secrets.mjs` — the other bottom layer: reads the run's secrets from the file
  `.github/actions/secrets` wrote, deletes it, and hands each secret only to the
  child that needs it (`gh`, `git`, pi). `wiki.mjs`, `git.mjs` and the agent
  runner all authenticate through it.
- `git.mjs` — `gitExec` / `ghExec`, the guard on edits to the machine
  (`changesTheMachine`, `revertMachineEdits`), and branch operations.
- `prompts.mjs` — `loadPrompt`, `fillTemplate`, and parsing an agent's JSON
  response envelope.
- `agent.mjs` — the model chain, session limits, `runAgent`, what an agent's
  tools may reach, skills (`BUILDER_SKILLS`, `REVIEWER_SKILLS`), and
  `printRunSummary`.
- `github.mjs` — issues (`fetchOpenIssues`, `closeIssue`, `commentIssue`),
  milestones, `triggerWorkflow`, and `LISTING_LIMIT` / `rejectTruncated`, which
  every listing uses to refuse a cut-short answer.
- `backlog.mjs` — labels and ticket state: `createIssue`, priority, dependencies,
  `isBuildable`, failure tracking, parking, `retireIssue`.
- `shipped.mjs` — telling a ticket that was built from one that was only closed,
  and when the current product started.
- `board.mjs` — the project board. Best-effort: it never throws.
- `board-snapshot.mjs` — the board and backlog rendered as text for the PM, PO
  and Tech Lead.
- `pull-requests.mjs` — opening, approving and merging PRs under two identities,
  and classifying the open agent PRs.
- `verify.mjs` — `verifyBuild` (the merge gate) and `reviewApp` (the layout
  measurements the Playtester reads).
- `wiki.mjs` — the wiki repo as long-term memory (Vision, Changelog, Story).
  Every write is a retried read-modify-write via `commitToWiki`.
- `discussions.mjs` — the Discussions layer: journals, lessons, decisions, ideas,
  digest, health alerts.
- `playtest-findings.mjs` — a finding's life after it is filed (untriaged →
  answered → verified or escalated), and what the PM and PO are shown of it.
- `weekly-report.mjs` — imported by the PM; gathers the week and renders the
  Story page and the human digest.
- `models.json` — the ordered model chain, with a `why` per entry.

Runnable locally but in no workflow: `app-review.mjs` (prints the `reviewApp()`
report the Playtester is handed) and `dedup-check.mjs` (free regression harness for the dedup heuristic).

## Conventions

**Tests** live beside their source as `agents/<topic>.test.mjs`, named for a
*concern* rather than a module — `backlog`, `envelope`, `quota`, `retirement`,
`manual-work`, `fork-triage`, `failed-lookups`, `machine-changes`, `skills`. They target exported pure functions. `npm test`
globs `agents/*.test.mjs`, so a test placed anywhere else never runs. **There
are no tests under `docs/`** — the product is verified by `verifyBuild`, not by
the Node runner.

**Prompts** are `agents/prompts/<role>.md`. A leading underscore marks a shared
fragment that is never loaded directly: `_profile.md`, `_output.md`,
`_coding-standards.md`, `_product-contract.md`, `_agent-tools.md`.
`loadPrompt(name)` inlines `{{include:fragment-name}}` one level deep;
`fillTemplate` then substitutes `{{SCREAMING_SNAKE}}` placeholders in a single
pass, inserting each value verbatim — a `$&` or a `{{VISION}}` inside a diff is
never reinterpreted.

**git and gh** run only through `gitExec` / `ghExec` in `git.mjs`, from an
argv array — never a shell string.

**Product modules** in `docs/` are camelCase, one concern per file, each
opening with a `/** <filename> — <purpose> */` banner. Factory exports are named
`create*` / `init*` / `start*`.

**Linting** is `eslint .` with only `no-undef: error` and `no-unused-vars: warn`
in both blocks. `docs/**` gets browser globals; `agents/**` gets node globals,
and only `verify.mjs` and `playtester.mjs` add browser ones, because their
`page.evaluate()` callback bodies really do run inside Chromium.

## Entry points

- `npm test` — `node --test agents/*.test.mjs`. The harness's own suite only.
- `npm run lint` — `eslint .`, covering both `agents/` and `docs/`.
- `ci.yml` runs lint, then the test suite, then `node agents/verify-product.mjs`.
- `check` and `verify-product` are **required checks on `main`**.

## `docs/` — the product

What the product is changes with every reset, so this file does not describe it:
`ls docs/` and the Vision do. What holds for any product is that `index.html` is
the entry point and owns the DOM state layer, and that its modules are loaded
from it by relative path, with third-party libraries pinned to a CDN URL.

Three files and one directory in `docs/` are not ordinary product modules:

- **`selftest.js`** exports `checks()` and is **not loaded by `index.html`**.
  `verifyBuild()` imports it dynamically in the browser, and skips the layer
  entirely when the file is absent.
- **`agenttools.js`** exports `tools()` — the product's capabilities as tools an
  agent can invoke. Verified the same way, by its own layer.
- **`webmcp.js`** is **harness code that happens to run in the browser**. It is
  the only place the WebMCP API is named, is on the `reset` keep-list, and is
  excluded from the Tech Lead's review. Product tickets do not touch it.
- **`skills/`** holds project skills, one `<name>/SKILL.md` each: know-how that
  is only true of this product, such as its genre. Agents read them rather than
  the page loading them, and every agent that can read files is offered all of
  them. They are product: the Devs edit them, `verifyBuild()`'s `skills` layer
  fails on one pi would not load, and a reset deletes them.

## Where new files go

- **A new agent role** is 3–4 coordinated files: `agents/<role>.mjs`, a
  `.github/workflows/<role>.yml` using `.github/actions/setup`, usually
  `agents/prompts/<role>.md`, and `agents/<topic>.test.mjs` if it exports pure
  judgement functions.
- **Shared prompt text** becomes `agents/prompts/_<name>.md`, pulled in with
  `{{include:_<name>}}`.
- **Know-how an agent loads only when its task needs it** is a skill. If it
  holds for any product, it goes in `agents/skills/<name>/` and the roles that
  should get it name it in their `runAgent` call's `skills` list
  (`BUILDER_SKILLS` and `REVIEWER_SKILLS` in `agent.mjs`). If it is only true of
  this product, it goes in `docs/skills/<name>/` and every agent that can read
  gets it. A skill needs the read or bash tool; guidance for an agent with
  neither is a prompt fragment.
- **New product code** is a camelCase ES module in `docs/`, imported from the
  `index.html` module script. Third-party dependencies load from a CDN at a
  pinned version (an importmap or a full URL), never npm. Any new behavior should gain a check in `docs/selftest.js` in the
  same change.
- **`reset` works from a keep-list** (`HARNESS_PATHS`), not a delete-list. A new
  machine-owned file under `docs/` must be added to it or the next reset deletes
  it. So must any new tracked file outside `docs/` — `reset.test.mjs` fails
  until it is.
