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

{{include:_output}}

```json
{
  "status": "success",
  "summary": "One sentence naming the lesson, e.g. 'The stepper needs the growth engine to exist first'.",
  "data": {
    "lesson": "Three or four sentences of prose, as described above."
  }
}
```
