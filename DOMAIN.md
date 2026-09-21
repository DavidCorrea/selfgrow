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

---

## Roles

**🧭 Product Owner** (Mon 08:00) — owns *where the project is going*: the Vision,
the milestone, its journal. Its retro is "the only place the pipeline learns
about itself at the level of a week" — post-mortems record why one ticket failed;
the retro records what a *run* of tickets adds up to. Vision rule: **evolve,
never rewrite**, and protect the `## Identity` section, "the project's genetic
code." A good milestone **names an experience, not a feature list**.

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

**📊 Health** (daily 16:00) — "not a role, a dashboard." Exists because the
changelog silently stopped growing for three days and ~100 merges, and "nobody
noticed, because noticing was nobody's job." Deliberately has **no model, no
browser, no key**, so it keeps working on a day the account is spent. **Speaks
only on exception**: "a dashboard that reports daily is a dashboard people stop
reading, and this one exists to be believed the one time it fires." Its alert
**closes itself** when the findings clear, because "a monitoring signal that
cannot clear itself becomes a stale page nobody trusts."

**🤝 review-pr** — the Devs applied to a PR a person opened. "Opening a PR is a
contribution, not a request for permission." Two lines it will not cross:
**never close the PR** ("this work belongs to a person, and closing it deletes
the branch") and **never merge what has not passed verify** ("there is no
override for 'the reviewer liked it'"). Pushes are **additions only** — the
branch is never reset or rebased, so the author's commits stay theirs.

**🤝 triage-fork-pr** — reviews a fork PR as *text*. Fork code never runs,
because review-pr checks out the PR head and runs an agent with write access and
the account's API key: "doing that to a branch a stranger controls hands them the
key." But silence was also wrong — an outside contributor once solved a real
ticket correctly and sat unanswered. The trust boundary: **trusted** is
everything checked out in the job (`pull_request_target` gives the base);
**untrusted** is the diff, "evidence about code, not code." Its capability limit
is structural, not policy — "it is never given any of those calls."

**📦 pi-update** (Tue 07:00) — "Dependabot for the model chain." **It asserts, it
does not repair**: if an id vanishes from the new pi's registry the whole bump is
reverted, because "staying on a pi whose chain works beats advancing to one whose
chain doesn't."

**♻️ reset** — "deletes the product and keeps the machine." Does **not** touch
`Vision.md` ("the new one is yours to write"), machine-scoped lessons, or
Decisions, because "a lesson about the harness outlives the product it was
learned on." Works from a **keep-list, not a delete-list**, on purpose: a
delete-list missed files on both resets it ever ran. "The harness is short and
changes rarely; the product is unbounded and invents new files every week. Only
one of those is safe to enumerate."

---

## The dev loop

**Scout** — picks one existing ticket and turns it into a concrete plan. It does
*not* decide whether the ticket should exist: "your job is to plan the work, not
to re-litigate whether it should exist." Plans **the smallest thing that
satisfies the ticket**, because "the Builder gets one session with a hard turn
and time limit: a plan that cannot ship inside it never ships at all."

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
`none` (nothing could be planned).

**Open agent PRs are reconciled first**: a ticket whose PR is still in flight is
not buildable — "the guard is the open PR itself rather than a label somebody has
to remember to set." A stale PR is a **handover**, not a patience setting: below
12 hours the opening run may still be watching, above it nobody is, and 12 hours
is shorter than the gap between daily runs "so no stalled PR survives a second
night."

---

## Ticket lifecycle

| Term | Meaning |
| --- | --- |
| **strike / attempts** | an `attempts:N` label, bumped on each failure |
| **parked** | the `blocked` label — out of the queue until someone rules on it |
| **waiting** | prerequisites haven't shipped yet; *normal*, not a failure |
| **buildable** | not parked, not a report, and every dependency has shipped |
| **sharpen** | rewrite a vague human request into something buildable |
| **retire** | close a ticket as split, superseded or won't-do |

**Parking** adds `blocked` *and* demotes to `priority:low`, "so it sinks even if
a human later unblocks it without re-triaging." It exists because a ticket the
Builder repeatedly abandons "would otherwise be picked again every run, starving
the whole backlog."

**Dependencies** are one body line — `Blocked by: #134` — and deliberately *not*
the `blocked` label, "which means something else. A ticket waiting its turn
hasn't failed at all, and marking it blocked would invite the PM to retire work
that is perfectly good and simply not ready yet." A dependency is **met once its
issue is closed**: no state to maintain, and a stale or nonexistent reference can
never strand a ticket forever. The `waiting` label is **derived from bodies every
time rather than tracked, so it cannot drift**.

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

**The product must have a real DOM state layer.** A WebGL canvas is not the whole
app, for two reasons: screen readers ("the calm should reach someone who never
sees the animation at all"), and the app review measures the DOM and "cannot see
into a canvas."

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
rather than regenerating.

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

**Concurrency** is one `agent-main-writer` lock.

**No model-written string is ever interpolated into a shell or a GraphQL
document.** Everything is passed as a GraphQL variable or piped over stdin:
"every string here can come from a model, so none of them may be interpolated
raw."

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
