# Domain

The vocabulary of this project, and the rules that vocabulary encodes. Where a
rule has a stated reason, the reason is here too — a rule without its reasoning
looks arbitrary and is easy to undo by accident.

Codebase layout lives in `STRUCTURE.md`.

---

## The shape of the thing

**selfgrow** is an autonomous pipeline: agent roles decide what to build, build
it, review each other, verify in a real browser, and merge to `main` with no
human in the loop.

**The product is a variable.** Whatever lives in `docs/` is what the pipeline has
been growing lately; `reset` throws it away and keeps the machine. The only thing
the machine demands of any product is the **self-check contract**.

**Roles are split by whose judgement a decision needs** — "which is why there are
four and not eleven." A **role** owns a kind of judgement (Product Owner, Product
Manager, Tech Lead, Devs). A **job** is infrastructure that runs on a schedule
and owns no judgement (QA, Health, review-pr, triage-fork-pr, pi-update).

**The Sunday/Monday hinge** — the PM's Sunday run curates and writes the week's
report; the PO reads that week on Monday and sets the milestone the PM grooms
against for the next six days.

**A failed read is never an empty one.** Open issues, board items, open PRs and
the milestone throw when `gh` fails, and every listing throws when it reaches
its limit, because `gh` stops at `--limit` without saying so. Each used to answer
`[]` or null, and every caller took that for "nothing there": an empty PR list
dropped the open-PR guard, the PM deduped against an empty board, a truncated
list released tickets whose blocker was past the cutoff. "Not found" is an
instruction to create, so a lookup that gave up early creates exactly the
duplicate it exists to prevent.

---

## Roles

**🧭 Product Owner** (Mon 08:00) — owns *where the project is going*: the Vision,
the milestone, its journal. Its retro is "the only place the pipeline learns
about itself at the level of a week" — post-mortems record why one ticket failed;
the retro records what a *run* of tickets adds up to. Vision rule: **evolve,
never rewrite**, and protect the `## Identity` section, "the project's genetic
code." A good milestone **names an experience, not a feature list**.

**A milestone is not done while the Playtester disagrees.** It may not be
declared delivered while an escalated playtest finding is open, or while the
Playtester's verdict has not changed across the sessions the milestone ran —
"its tickets closing is not the experience arriving." So the PO is shown every
open finding with its age and stage, and the Playtester's verdicts in a row: it
used to see only findings "still untriaged", a list the PM empties every
morning, so five sessions of the same verdict were invisible to the one role
that decides whether a milestone is done.

**📋 Product Manager** (daily 00:30) — owns *what the product should and
shouldn't be*. Additive and subtractive in one breath, because "what the product
should stop doing is the same judgement as what it should start doing"; split
across two roles, the subtractive half proposed removals blind to what the
additive half was adding.

- **Grooming** — create, refine, prioritize. "Everything you leave on the board
  will be built as written. The Devs plan and implement tickets; they do not
  question them."
- **Curation** (Sundays) — what should the product stop doing. Never remove for
  being simple, never remove load-bearing early work, **never remove the
  product's own checks** ("that makes the build quieter, not the product
  better"), and **at most one removal per run** — "a curator who finds something
  to cut every visit is vandalising the product slowly."
- **The weekly report** (Sundays) posts **once per week** — checked before the
  model runs, so a re-run on the same Sunday neither pays for a second session
  nor evolves the Story twice. A report that fails **fails the PM's run**, after
  the day's grooming and building are done: it used to log a warning and go
  green, and the digest stopped for two Sundays with nobody told.

**🔧 Tech Lead** (Thu 09:00) — owns *whether the code can absorb the next
ticket*, and is **the only agent that sees the whole codebase**: "the Scout plans
one, the Builder writes one, the Reviewer reads one diff. Nobody owns the shape
of the thing they are collectively producing." Three jobs, one question: the
codebase's **shape**; the **test suite** (`docs/selftest.js`, "the only
independent judge in the pipeline"); and **parked tickets**, because *"why did
this fail"* is a technical question. **It proposes; it does not act** —
everything it decides becomes an ordinary ticket, "including the removals, which
are the ones that most deserve it."

**⚒️ Devs** — own *how a ticket gets built*, and write to `main`. Internally
Scout → Builder → Reviewer.

**👀 QA / Playtester** (Wed 10:00) — "the only agent that experiences the product
instead of measuring it." Separate from the PM because "it plays and reports; the
PM decides. The observer should not be the one who acts on the observation." It
is the only role with **eyes**: everything measurable about a page is measured
deterministically and fed to the PM, so "a vision model adds only taste, and can
report a defect that isn't there." Its output is explicitly **not a ticket**, "so
a mistaken impression costs one line of triage instead of a build."

It plays the **live site**, not a local copy — "the difference between 'the code
we merged works' and 'what a visitor gets works'" — and plays through the **DOM
state layer**, never the canvas, because "the surface this agent reads is the
same one a blind visitor gets."

It also uses the product **through its agent tools**, calling each with its
declared example — the same input verify uses. Calling with nothing meant any
tool that needs input "always failed, so the Playtester could only ever judge
its error, never what it does." (The browser does not hand the example back, so
it is read from `agenttools.js`.) Tools marked consequential are described but
never called. Two minutes of watching cannot show **the return** — "you never
left" — so where the product offers a sandboxed time rehearsal, what it returned
is judged *as* the return; where the Vision asks for one and there is none, that
is a finding. And where the Vision treats agents as players, the tools are held
to that: a set of tools that reads the state but never says what any of it means
"is usable by a tester and not by a player."

**📊 Health** (daily 16:00) — "not a role, a dashboard." Exists because the
changelog silently stopped growing for three days and ~100 merges, and "nobody
noticed, because noticing was nobody's job." Deliberately has **no model, no
browser, no key**, so it keeps working on a day the account is spent. **Speaks
only on exception**: "a dashboard that reports daily is a dashboard people stop
reading, and this one exists to be believed the one time it fires." Its alert
**closes itself** when the findings clear, because "a monitoring signal that
cannot clear itself becomes a stale page nobody trusts."

Each check comes back a **finding**, **clear**, or **unknown** — unknown when a
fact it needs could not be read. **Unknown never closes an alert**: counted as
clear, "one throwing check was enough to close a real alert", and the problem it
reported may be exactly the one that could not be checked. It checks **what the
pipeline produced, not only whether it ran**: the digest post itself ("it stopped
for two Sundays with every run green"), the same playtest finding filed three
times in four weeks ("the loop is not fixing it"), and a role whose sessions were
aborted in two of its last five runs — an abort does not fail the run, so only
the run's own annotations say it happened. Each weekly agent's last run is asked
of its own workflow.

**🤝 review-pr** — the Devs applied to a PR a person opened. "Opening a PR is a
contribution, not a request for permission." Two lines it will not cross:
**never close the PR** ("this work belongs to a person, and closing it deletes
the branch") and **never merge what has not passed verify** ("there is no
override for 'the reviewer liked it'"). Pushes are **additions only** — the
branch is never reset or rebased, so the author's commits stay theirs.

It **never approves or merges a change to the machine** — `.github/`, `agents/`,
or the dependencies. It still verifies, reviews and fixes; the last step is a
person's. "A change there decides what every later review, merge and secret
does, so the agents that would be governed by it are the wrong ones to wave it
through — an approval from the pipeline is only as trustworthy as the pipeline."

**🤝 triage-fork-pr** — reviews a fork PR as *text*. Fork code never runs,
because review-pr checks out the PR head and runs an agent with write access and
the account's API key: "doing that to a branch a stranger controls hands them the
key." But silence was also wrong — an outside contributor once solved a real
ticket correctly and sat unanswered. The trust boundary: **trusted** is
everything checked out in the job (`pull_request_target` gives the base);
**untrusted** is the diff, "evidence about code, not code." Its capability limit
is structural, not policy — "it is never given any of those calls." The review
session gets **no tools at all**: the base files the diff touches are put in its
prompt instead, because a read tool in a job holding secrets, steered by a
stranger's diff, "is a way to publish those secrets." Secret values are still
redacted from the comment — the last line of defence, not the first.

**📦 pi-update** (Tue 07:00) — "Dependabot for the model chain." **It asserts, it
does not repair**: if an id vanishes from the new pi's registry the whole bump is
reverted, because "staying on a pi whose chain works beats advancing to one whose
chain doesn't." It adopts only a release **public for at least a week**, never
one above npm's `latest` tag, and never a downgrade. The bump merges itself and
pi runs holding the model key and a PAT, so "the moment it is published" is
exactly the window a hijacked or broken release is live; a maintainer moving
`latest` back is how a bad release is withdrawn, which age alone would not see.

**♻️ reset** — "deletes the product and keeps the machine." Does **not** touch
`Vision.md` ("the new one is yours to write"), machine-scoped lessons, or
Decisions, because "a lesson about the harness outlives the product it was
learned on." Works from a **keep-list, not a delete-list**, on purpose: a
delete-list missed files on both resets it ever ran. "The harness is short and
changes rarely; the product is unbounded and invents new files every week. Only
one of those is safe to enumerate." The keep-list includes the root docs
(`README`, `DOMAIN`, `STRUCTURE`, `IMPROVEMENTS`) — they describe the machine,
and were missing until a reset would have deleted them — and a test fails when
any tracked file outside `docs/` is not on it.

It **closes every open issue as not planned** — nothing a reset closes was
built. It **stops before deleting the product** if any memory thread cannot be
read or archived: a journal left under its own title is found by the next
product's find-or-create, "which appends to it and reads the old product's
reasoning as its own" — worse than a reset that stops, since a re-run is safe.
Every other step is best-effort, but the run **exits non-zero listing whatever
it did not do**, because it once ended on "Reset complete" with the previous
product's tickets still on the board. Its commit message marks **when the
current product began**, which is how shipped work is bounded to this product.

---

## The dev loop

**Scout** — picks one existing ticket and turns it into a concrete plan. It does
*not* decide whether the ticket should exist: "your job is to plan the work, not
to re-litigate whether it should exist." Plans **the smallest thing that
satisfies the ticket**, because "the Builder gets one session with a hard turn
and time limit: a plan that cannot ship inside it never ships at all." Only a
ticket it was **actually offered** is built; any other choice is treated as no
choice, because a number outside the candidates once sent the Builder after a
parked or already-closed ticket with an empty body.

**Builder** — writes the code. Does not commit or push, and does not edit the
wiki; it returns a **changelog entry** recorded after merge. May return one
optional **tech-debt** ticket, held to a high bar.

**Reviewer** — decides whether the change is safe to ship: `approve` or `revise`
with a specific issues list. Syntax, lint and runtime already passed, so it
judges correctness, behavior, and fit with the Vision. **Drawn from a different
model than wrote the code** — review is only worth its request if it can
disagree.

**Run outcomes** — `merged`; `abandoned` (engaged but couldn't ship, with a
`ticketFault` flag deciding whether it counts as a strike); `unlanded` (approved
and armed for auto-merge but not landed in time — **no fault, no strike**);
`none` (nothing could be planned). After an abandoned ticket the working tree is
**put back** — any merge aborted, the tree reset to `origin/main` — and the run
stops if it cannot be, since no later ticket could start from that tree either.

Every agent PR body ends with `Closes #N`, so the ticket closes when the PR
merges, whoever merges it, rather than on a model happening to write it in a
commit message.

**Open agent PRs are reconciled first**: a ticket whose PR is still in flight is
not buildable — "the guard is the open PR itself rather than a label somebody has
to remember to set." A stale PR is a **handover**, not a patience setting: below
12 hours the opening run may still be watching, above it nobody is, and 12 hours
is shorter than the gap between daily runs "so no stalled PR survives a second
night." A ticket **stays claimed for as long as its PR is open**, a stalled
merge is **waited on once per run** (not once per pass), and a stale PR whose
ticket is no longer open is **closed unmerged** with no strike ("the ticket was
settled, not failed") — a
recovery once built a ticket twice beside its own open PR, and merged a PR whose
ticket had been retired.

---

## Ticket lifecycle

| Term | Meaning |
| --- | --- |
| **strike / attempts** | an `attempts:N` label, bumped on each failure |
| **parked** | the `blocked` label — out of the queue until someone rules on it |
| **waiting** | prerequisites haven't shipped yet; *normal*, not a failure |
| **buildable** | not parked, not a report, and every dependency has shipped |
| **sharpen** | rewrite a vague human request into something buildable |
| **retire** | close a ticket as split, superseded or won't-do — closed as *not planned* and taken off the board |
| **shipped** | closed as *completed* since the most recent reset, and not a playtest finding |

**Retired is not shipped.** A plain close is "completed", and a retired card used
to move to Done — "the column the prompts define as already shipped — so every
report and every later run read a retirement as work that was built." The card
is removed rather than moved, because the board's own automation moves a closed
item to Done and no column means "decided against". Shipped work is bounded by
the last reset because closed issues outlive it: the old product's final days
otherwise counted as the new product's first week in the retro, Health and the
weekly report.

**Parking** adds `blocked` *and* demotes to `priority:low`, "so it sinks even if
a human later unblocks it without re-triaging." It exists because a ticket the
Builder repeatedly abandons "would otherwise be picked again every run, starving
the whole backlog."

**Dependencies** are one body line — `Blocked by: #134` — and deliberately *not*
the `blocked` label, "which means something else. A ticket waiting its turn
hasn't failed at all, and marking it blocked would invite the PM to retire work
that is perfectly good and simply not ready yet." A dependency is **met once its
issue is closed as anything but not planned, or never existed**: no state to
maintain, and a stale or nonexistent reference can never strand a ticket
forever. It is met only once a lookup **confirms** that — absent from the open
list is not the same as closed. A **retired** prerequisite keeps its dependants
waiting: it used to release them, including when the PM split it into pieces
none of which had shipped, "so the dependant was built on a foundation that did
not exist." The board names the retired prerequisite beside the waiting ticket,
so the PM can re-scope or retire it rather than leave it stranded. The `waiting`
label is **derived from bodies every time rather than tracked, so it cannot
drift**.

**A blocker is worth exactly what it unblocks.** `effectivePriorityRank` builds a
ticket at the best priority among itself and everything transitively waiting on
it — otherwise a `priority:low` ticket gating three high ones sorts behind every
trivial ticket "while the three tickets that actually matter stay unreachable."
It deliberately does **not relabel**: "the label is what a human said this work
is worth; this is only the order to do it in, and conflating the two would
quietly rewrite the roadmap on the board."

**Manual vs agent issues** — `isManualIssue` is the *absence* of the `agent`
label. "Note the direction: this is not a label anyone adds, it is one the agents
add to their own. A ticket nobody stamped came from outside." An issue with no
labels at all is treated as human-filed rather than silently retirable.

**Non-work labels** (`playtest`, `health`, `digest`) exist because "not every
issue is work, and the Devs must never pick one up and try to build it" — left
buildable, each "is a ticket the Devs engage, fail to satisfy, and eventually
park, spending two builds to discover the issue was never a request."

**A playtest finding lives until the Playtester verifies it.** It used to end
the moment the PM answered it with tickets. The last product's Playtester filed
"The visual canvas is a dark void" five times over five weeks; each answer's
tickets all shipped, and the verdict did not change once — "'the tickets closed'
had quietly become the definition of 'the experience improved', and only the
Playtester could tell the two apart." So a finding moves through three stages,
derived from labels and body lines like `waiting` is, so nothing can drift:

| Stage | Meaning |
| --- | --- |
| **untriaged** | filed, not yet answered. The PM answers it or drops it |
| **answered** | the PM filed tickets for it (`answered` label, an `Answered by:` body line; earlier answers move to `Tried before:`). Stays open; the next session must say `verified` (closed as completed) or `persisting` |
| **escalated** | persisted `ESCALATE_AFTER` (2) sessions after its whole answer landed (`persisted:N` counts them), or handed up by a PM that sees no approach unlike what failed. Stays marked until verified, so the PO sees it |

A persisting verdict counts against an answer only once **every answering ticket
is closed** — before then nothing has changed for the Playtester to see. Two
sessions rather than one, because "one 'still there' can be the Playtester's
variance, two in a row is the product." The PM cannot retire an answered
finding, and is shown every earlier answer to the same complaint, because "the
likeliest mistake after an answer fails is prescribing it again."

**A human request can be sharpened but never closed for being unclear.** Retiring
one requires declaring it out of scope: "that is a judgement about the *request*;
'I could not tell what you meant' is a judgement about the *wording*." A
retirement without that flag is refused. The reason: "the one channel into this
system used to end in a silent drop."

**Milestone** — the planning horizon. "Priority says which ticket comes first. It
cannot say what the project is trying to do this month, and without that the
backlog is filled by adjacency." **One open milestone at a time, on purpose:
"two is not a horizon, it is a backlog with headings."**

---

## The product contract and verify

**The contract**: `docs/` is a static site with an `index.html`, and
`docs/selftest.js` exports `async function checks()` returning plain-language
failure messages — empty when everything holds. "What counts as a check is the
product's business; that it can be executed is ours." It says nothing about what
the product is.

Every returned failure blocks the merge. **Write checks that could fail** —
`return []` passes and is worthless. Cover what you just built in the same
change. The suite must not hang; it is timed inside the page "so a runaway check
is reported as the product's failure to bound itself." **No model is involved, so
it costs nothing and cannot be argued with.** A project with no `selftest.js` yet
passes, so a brand-new repo isn't blocked before it has anything to check.

**The agent tool contract** is the same bargain for a different reader:
`docs/agenttools.js` exports `tools()`, returning tool descriptors an agent can
invoke through WebMCP. What the tools are is the product's business; that they
run is the machine's. They are derived mechanically from the DOM state layer —
every field it shows is a read tool, every action a visitor can take is a write
tool, and nothing else, because a tool exposing an internal the UI does not is a
second interface that will drift from the first.

**verify's five layers**, cheapest first, stopping at the first failure:

1. **syntax** — `node --check`
2. **lint** — ESLint errors
3. **runtime** — a real headless Chromium page load
4. **selftest** — the product's own `checks()`
5. **agenttools** — every declared tool called with its own example

Layers 1–3 "prove the code parses, lints, and loads without throwing. None of
them prove the product actually *does* what it claims — which is exactly the
failure a Builder is most likely to ship, because it looks green everywhere
else."

**`verify-product`** is the same function in a job whose exit code a ruleset can
require: "nothing here is new verification; it is the existing verification made
non-optional." Before required checks, "the agents graded their own work and
merged on the result."

**app review** is distinct from verify: it judges the rendered page **without a
vision model**, because "everything a screenshot critique was asked to spot —
overflow, overlap, unreadable contrast, collapsed regions — is a measurable
property of the rendered page." It "cannot invent a defect that isn't there —
which matters more than it sounds: a hallucinated defect became a ticket, and the
Builder then spent real requests 'fixing' nothing."

It measures at **a real phone** (390×844, touch) **and a wide desktop window**
(1440×900): "a layout that only reflows for a narrow mouse-driven window has not
been tested on the device a visitor holds." Beyond overflow, overlap and
contrast it flags a narrow centre column (content under 60% of the desktop
width), tap targets under 40px, and a page that **renders visually empty** —
read from pixels, because an empty page has no overflow, no overlap and no bad
contrast to report.

**The product must have a real DOM state layer.** A WebGL canvas is not the whole
app, for two reasons: screen readers ("the calm should reach someone who never
sees the animation at all"), and the app review measures the DOM and "cannot see
into a canvas."

**How the product looks is the Vision's call**, not the machine's — styled HTML,
SVG, a canvas, a WebGL library from a CDN. The harness used to say the product
"is rendered in 3D with Three.js", a choice about one product living in the
machine. What stays is the rule above: **the DOM is the product, whatever draws
the pixels**, because the app review, the Playtester and the agent tools all read
it.

---

## The model chain

**The chain** is an ordered list in `models.json` with a `why` per entry. It is
**not a cost ladder** — the free models below the head are gone, having been
"fallbacks for an exhausted free tier that no longer bounds anything." Two paid
models from **different provider families**, deliberately: the chain "is the
mechanism behind `preferDifferentModel` — the Reviewer must be able to be drawn
from a different model than wrote the code, or review cannot disagree for
independent reasons."

**`preferDifferentModel`** reorders the chain so the avoided model is tried
*last*, and **never removes it**: "a chain of one still has to produce a review.
A correlated reviewer beats no reviewer, and the alternative is shipping
unreviewed."

**Meta-routers** (`auto`, `openrouter/free`, `openrouter/fusion`) dispatch to an
arbitrary underlying model, "so a run using one is not reproducible — never
auto-discover them."

**Vision is a property of the model, not of the chain.** pi silently drops image
content for a model that doesn't declare image input, so an image-sending caller
pins the model. `firstVisionModel()` returns null rather than throwing: "an agent
that can see is an upgrade to a report, never a precondition for one."

**Daily quota exhaustion is *the* stop signal** — "the pipeline no longer
predicts its own spend from a ledger, so a provider refusing to bill is how it
learns the money is gone." Deliberately narrow after an incident where a
transient failure was read as an empty account and four tickets were abandoned
with $30 of $40 still on the key. "When in doubt, return false — a wasted retry
costs one request, and a wrong 'we are out of money' costs the ticket."

**There is no per-run or per-day request budget.** Every previous mechanism "was
an attempt to predict the account's remaining balance from inside the pipeline,
and the prediction was the fragile part." Spend is capped on the OpenRouter key:
"one stop signal, and it cannot disagree with the truth."

**Session limits** — an agent must stop *itself* before the runner stops it:
"an agent that stops itself closes its PR cleanly; an agent stopped by the runner
leaves an orphaned branch." So every limit is nested comfortably under the job's
`timeout-minutes`.

**Session caps are sized per role.** Every session defaults to 40 turns and 12
minutes, which is ample for the roles that plan and review, so for them a cap only
ever stops a loop. The **Builder** brings its own — 80 turns, 20 minutes — because
its merged sessions ran 34–36 turns, and every Devs "abort" in September turned
out to be the shared cap cutting off work a few turns from done, logged as if the
model had failed.

**Session caps are per role.** The default is 40 turns and 12 minutes, sized for
the roles that plan or review, where it only ever stops a loop — a Scout once ran
101 turns without producing a plan. The **Builder's build session** carries its
own, 80 turns and 20 minutes: merged Builder sessions ran 34–36 turns, and every
Devs "abort" in September was the shared cap cutting real work off, with the
ticket abandoned as if the model had failed. 80 is about twice a merged build,
so it still stops a loop. A role passes its own caps "rather than every role
inheriting the longest one's budget"; the Builder's conflict resolution keeps
the default.

**A silent model is a failed model, not a stopped session.** A model that sends
nothing — no token, no event — for `MAX_MODEL_SILENCE_MINUTES` (3) while no tool
is running counts as that model failing, and the chain **moves on to the next
model**. The session caps are different: they **stop the chain**. The weekly
report once sent one request and heard nothing for the full 12-minute cap two
Sundays running, where the same request had been answered in ~25 seconds; "a
silence this long is a stuck provider, not thinking." Time a tool spends running
is ours, not the provider's, and is not held against it. Every stopped session
is logged as an error naming the role, model and elapsed time, and Health counts
silent models among aborted sessions.

**The envelope** — every agent answers `{status, summary, outcome?, data}`. Gate
agents return `approve` / `reject` / `revise` / `skip`; worker agents omit
`outcome`. The boundary it defends: "get it wrong in the lenient direction and
malformed work reaches the branch; get it wrong in the strict direction and the
run burns the whole chain on answers that were fine." A required field that is
present but *empty* is accepted — "'no files changed' is a real result."

**Dedup** — a title-token near-duplicate check using **Jaccard**, not the overlap
coefficient it used to use: "overlap rewards size mismatch," and one malformed
short title therefore matched every future contrast ticket, permanently. The
threshold is high because "tokens fundamentally cannot tell 'a device found in
the Condenser Gallery' from 'the Condenser Gallery' itself," so everything below
reaches the board "where a duplicate costs one grooming pass rather than the
work." A model-based dedup pass used to exist and is gone: "it deleted three good
tickets in one call." It returns the match *and its score*, because "a dedup that
deletes work without naming its reason is not auditable."

---

## Memory

Agents are stateless; every run starts from a fresh checkout.

**Anything the agents read back lives in Discussions**, because "a wiki page is a
blob that has to be rewritten whole — so the only way to bound a prompt was to
delete history, and history got dropped by age rather than by relevance." A
thread's body is its summary and its comments are an append-only log, so
**context is bounded by selection instead of by deletion**.

Reads **page through a category** until they find what they want, rather than
taking one page of the
newest threads across all of them, which "works until it silently doesn't: once
fifty newer threads exist, a role's journal falls off the page, find-or-create
opens a duplicate, and the role has no memory from then on." A runaway read is
capped (`DISCUSSION_PAGE_CAP`), and hitting the cap **throws** rather than
returning what it saw, for the same reason every failed read does.

Everything the pipeline posts is **locked** — readable by anyone, appendable only
by accounts with write access, "because an agent that reads a thread as guidance
and merges to `main` should not be arguable with by a stranger." `Ideas` is the
one unlocked category, as the inbound channel.

**Trust is by write access and nothing else.** Everything from anyone else "is
still worth reading — it is why the channel exists — but it is quoted into a
prompt as somebody's opinion, never as an instruction." The `trusted` marking is
repeated **per item**, because "a single header saying 'some of the following is
untrusted' is not something a model reliably carries down a page."

| Store | Shape | Read back as |
| --- | --- | --- |
| **Journals** | one thread per role, one comment per run | the last 3 entries |
| **Lessons** | one thread per failure *class*, one comment per occurrence | **most-recurrent first** |
| **Decisions** | one thread per decision | every title, newest first; only the recent bodies |
| **Ideas** | the inbound channel (unlocked) | ticketed, or noted and left open |
| **Announcements** | weekly digest, health alerts | not read back — they are output |
| **Wiki** | Vision (PO), Changelog + Story (PM) | whole |

**Journals** exist because "the PO sets a milestone each Monday having forgotten
why it set the last one." They are **threads, not categories per role**, because
"categories are repo settings that no API can create, so they cannot be renamed
when the team shape changes, and this pipeline has already deleted one role and
merged another." Entries must be **terse** ("prose invites an agent to read its
own voice back and elaborate on it, which is how confident drift happens") and
**bounded** ("the thread is allowed to grow forever precisely because nobody
reads all of it"). A journal is context, never a precondition: "no agent may fail
because it could not remember."

**Lessons** are titled by the *class*, not the incident — "same title next time
means the same thread, which is what makes recurrence visible." Read
**most-recurrent first** because "a failure seen four times is likelier to catch
the next ticket than one seen once last night." They are **advice, not
prohibition**: "a lesson explains why something failed once, which is a reason to
plan differently, not proof that the work is impossible." Lessons are scoped
`product` or `machine`, and only product lessons are archived by a reset —
"archiving a machine lesson loses something expensive, while keeping a product
lesson adds a paragraph of noise to a fresh start." Archiving **renames rather
than deletes**, with the date as a *prefix*, because find-or-create matches on
`startsWith`.

**Decisions** exist because the pipeline "has reordered that model chain on three
different rationales across its history, which is the cost of having nowhere to
look." Agents are told to say "there is a decision about this I cannot see"
rather than re-decide: "silently re-deciding is how a project ends up
relitigating the same question every few weeks with a different answer each
time."

**The wiki** is a separate git repo, "which is what makes it usable here: writing
to it triggers no workflow and touches no branch the Devs are merging." **Every
write is a retried read-modify-write.** The old write path "lost that race on
every merge for three days and dropped ~100 changelog entries on the floor. It
caught the rejection, logged a *warning*, and the run reported success." Callers
never edit the clone — they hand `commitToWiki` a pure function from current
content to next content, re-run against freshly fetched content on every attempt.

The **Changelog** is trimmed by *days*, because it is read whole into the weekly
report and "untrimmed it grew without bound into a fixed context, degrading
silently." The long arc lives in **Story**, which the weekly report evolves
rather than regenerating. The report itself reads only the last **14 days** of
the Changelog — enough to see this week against the one before — because the
page it used to read whole grew from 5 KB to 17 KB over three Sundays while the
session went from answering in 25 seconds to hitting its cap on the first turn.

**The board snapshot** the PM, PO and Tech Lead read lists every column in full
except **Done**, which names only the 30 most recent tickets and counts the
rest. Done is the one column that only ever grows; whether something older was
already built is answered from `docs/`, not from a title list.

---

## Identity and safety rules

**The PAT opens PRs; `GITHUB_TOKEN` approves.** GitHub does not trigger workflows
for events created by `GITHUB_TOKEN` — a deliberate recursion guard — so a
bot-opened PR gets its checks created but parked. Once checks became universal
and required, "every agent PR stalled: #502 sat for 42 minutes, its Devs run gave
up waiting, reported zero merges, and skipped recording the change it had
actually made." The same rule governs **every push**, not just the first. On a
*human's* PR the identities flip, because the author is the PAT's owner.

**auto-merge** means "the agent asks and the required checks answer — it no
longer merges on its own say-so."

**Concurrency** is one `agent-main-writer` lock **for whatever pushes to
`main`**: the Devs and pi-update's update job. Every other agent has its own
group, and review-pr has **one per PR** — GitHub keeps only one pending run per
group and cancels the older one, so sharing the Devs' lock silently dropped a
human PR's review whenever a Devs dispatch arrived. review-pr needs no lock
anyway: it pushes only to the PR's branch and lands through GitHub's merge API.

**No model-written string is ever interpolated into a shell or a GraphQL
document.** Everything is passed as a GraphQL variable or piped over stdin:
"every string here can come from a model, so none of them may be interpolated
raw." `git` and `gh` run **only from an argv array**, never a shell string —
through a shell, "a backtick or `$(...)` in any of them is a command, and
escaping only `"` stops none of it."

**No secret is ever in an agent process's environment.** A process's start
environment is readable by any process of the same user through
`/proc/<pid>/environ`, and the agents' bash tool runs as that user. So in CI the
secrets arrive **by file**, read and deleted before any model runs, and CI
refuses to start if one arrives the old way. They reach a child only where it is
not model-controlled: `gh`, `git` (as a config header, never a credential
persisted in the checkout — only the jobs that push get the push token), and pi
in-process. The agents' tools are fenced the same way: the bash tool's children
get an **allowlisted** environment ("a denylist fails open: the next secret a
workflow adds is exposed until someone remembers to name it"), and the read tool
reads only the checkout and the temp dir, because it runs in the runner's own
process and `/proc/self/environ` is the unfiltered one.

---

## Open questions

Rules found in the code with **no stated reason**. Worth asking about rather than
inventing a rationale for:

- The specific numbers behind `MAX_NEW_TICKETS_PER_RUN`, `MAX_TICKETS`,
  `JOURNAL_TAIL`, `DECISION_BODIES`, `NEAR_DUP_THRESHOLD = 0.9`, the character
  caps, and `MAX_SCOUT_RETRIES` — the *policies* are justified, the *values*
  are not.
- The board column set. `reset` "keeps the columns — the new project needs the
  same five," but only four are named anywhere (Todo / In progress / In review /
  Done).
- The specific clock times of each scheduled run. The *ordering* is explained
  (the Sunday/Monday hinge, Devs after the PM); the hours are not.
- Why `agent` rather than a `human` label is the marker. The direction is
  explained; the choice of direction is not.
- Two playtester frames specifically, and JPEG quality 70. JPEG-over-PNG is
  justified; the numbers are not.
