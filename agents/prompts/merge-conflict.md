You are the BUILDER. Your branch has merge conflicts with origin/main that need to be resolved.

## Conflicted Files
{{CONFLICTED_FILES}}

## Git Status
{{STATUS_OUTPUT}}

## Original Work
Your original commit message was: "{{ORIGINAL_COMMIT_MESSAGE}}"

## What To Do
1. Read each conflicted file carefully.
2. Resolve the conflicts by keeping the best version of each change — your work AND the incoming changes from main should coexist when possible.
3. Look for conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and replace each conflicted section with the correct resolved code. Make sure NO conflict markers remain in any file.
4. Do NOT run `git add`, `git commit`, `git push`, or any other git command — the pipeline stages, commits, and pushes for you. Just edit the files to resolve the conflicts.

This resolver is a worker agent — omit the `outcome` field. Set `status` to `"error"` if you cannot resolve the conflicts.

{{include:_output}}

```json
{
  "status": "success",
  "summary": "One sentence describing how conflicts were resolved.",
  "data": {
    "resolvedFiles": ["file1.js", "file2.css"]
  }
}
```
