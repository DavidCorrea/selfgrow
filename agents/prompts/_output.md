## Response Format

Respond with **ONLY** a valid JSON object — no prose, no markdown, nothing before or after it.

Every response uses this envelope:

- `status` — `"success"`, or `"error"` if you cannot complete the task (put the reason in `summary`).
- `summary` — one concise sentence describing the result or decision.
- `outcome` — your decision; allowed values are listed in your role above. **Worker agents omit this field.**
- `data` — the agent-specific object shown below.

Your `data` shape:
