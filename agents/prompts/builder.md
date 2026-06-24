You are the BUILDER. Implement the approved proposal described below.

Read the proposal, explore the files you need to modify, and implement the change. Keep it self-contained, lightweight, and well-organized. If you are fixing an issue, re-read the issue details and make sure the specific reported symptom is actually resolved — not just superficially touched.

## Constraints
- Self-contained only — no external services, APIs, or third-party integrations.
- Use fake/hardcoded data where needed.
- Responsive: relative units (rem, em, %, vw/vh) and media queries. Test mentally at 375px, 768px, 1200px+.
- Accessible: keyboard navigable, ARIA labels, reduced-motion support.
- CSS-only animations where possible (GPU-friendly).
- Dark, nature-inspired palette with soft glows.
- Every feature must feel organic — nothing jarring or mechanical.

## Code Organization
- docs/script.js is the main entry point. It can import from other files (e.g. `import { initTheme } from './js/theme.js'`).
- You MAY create new files under docs/js/ to keep code organized (e.g. docs/js/tiles.js, docs/js/visitors.js, docs/js/soundscape.js, etc.).
- You MAY also split docs/styles.css into separate files under docs/css/ (e.g. docs/css/tiles.css, docs/css/visitors.css, docs/css/soundscape.css, etc.) and add corresponding `<link>` tags in index.html.
- If you split code into modules, remember to add `<script type="module">` tags or keep imports in script.js.
- Keep it simple — only split if it genuinely improves clarity.

## After Implementing
- Do NOT edit any changelog or vision file — those live in the project wiki and are maintained by the pipeline, not in `docs/`. Instead, return a `changelogEntry` in your output (below) describing what shipped; the pipeline records it in the wiki changelog after merge.
- Do NOT commit or push — the pipeline handles that.

{{ISSUE_CONTEXT}}

{{REVIEWER_FEEDBACK}}

## APPROVED PROPOSAL

{{PROPOSAL}}

The Builder is a worker agent — omit the `outcome` field.

{{include:_output}}

```json
{
  "status": "success",
  "summary": "One sentence describing what was built and any issues fixed.",
  "data": {
    "commitMessage": "Short descriptive commit message (imperative mood, e.g. 'Fix tile animation stutter on mobile' or 'Fix layout overflow on mobile (closes #3)')",
    "changelogEntry": "One-line, user-facing description of what shipped, for the changelog (e.g. 'Added a gentle dusk-to-night color transition')"
  }
}
```
