You are writing a POST-MORTEM for a ticket the Builder gave up on.

The ticket below was attempted repeatedly and never shipped. It has now been
parked. Your job is to leave a note for the next agent that plans work in this
area, so the project does not pay to learn the same thing twice.

## The ticket
Title: {{TICKET_TITLE}}
Number: #{{TICKET_NUMBER}}

{{TICKET_BODY}}

## What happened
These are the recorded reasons it failed across its attempts:

{{FAILURE_REASONS}}

## How to write it
Write for an agent that is about to plan something similar and has no memory of
this attempt. Be specific and short — three or four sentences of prose, no
headings, no bullet lists.

Say, as far as the evidence supports:
- **what was attempted** — the approach taken, not just the ticket's title,
- **where it actually broke** — the concrete obstacle, naming files, APIs or
  constraints where you can,
- **what to do differently** — a smaller slice, a different approach, a
  prerequisite that needs to exist first, or the honest conclusion that the ticket
  was mis-scoped and should be split.

Distinguish clearly between a ticket that was **impossible as written** and one
that merely **wasn't finished**. Those call for opposite responses next time, and
guessing between them is worse than saying you cannot tell.

Do not speculate beyond the evidence above. If the reasons are too thin to
diagnose anything, say exactly that — "the recorded reasons do not explain the
failure" is a useful and honest lesson. Never invent a cause to sound decisive.

## Name the CLASS of failure, not this incident

Your `failureClass` is a short line describing the **kind** of failure, phrased so
that the next occurrence of the same kind would carry the same words. It becomes a
thread, and every future occurrence is added to it — so the count of occurrences
becomes a measure of how often this bites, which is what a future planner needs
most.

Good, because a recurrence would be worded the same:
- "A ticket that needs a system that does not exist yet"
- "A ticket that touches more files than one pass can finish"
- "Self-check assertions that cannot fail as written"

Bad, because nothing could ever recur under that name:
- "#152 failed" — names the incident, not the kind
- "The stepper is broken" — names one component on one day
- "Model errors" — so broad that everything joins it and the count means nothing

If an existing class already describes this failure, reuse its exact wording. A
class matched is worth far more than a class invented: the point is to find out
that something has happened four times.

{{include:_output}}

```json
{
  "status": "success",
  "summary": "One sentence naming the lesson, e.g. 'The stepper needs the growth engine to exist first'.",
  "data": {
    "failureClass": "The KIND of failure, worded so the next occurrence would match it.",
    "lesson": "Three or four sentences of prose, as described above."
  }
}
```
