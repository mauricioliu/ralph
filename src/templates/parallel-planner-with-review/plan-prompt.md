# ISSUES

Here are the open issues in the repo:

<issues-json>

!`{{LIST_TASKS_COMMAND}}`

</issues-json>

Labels select candidates, not permission or proof of readiness. This launch is authorized ONLY for issue IDs: {{AUTHORIZED_ISSUES}}. Select at most ONE.

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** only when its technical dependencies are resolved AND required samples, calibration and human decisions are explicitly approved. Existing implementation commits do not resolve those external blockers.

For each unblocked issue, assign a branch name using the exact format `ralph/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "ralph/issue-42"}]}
</plan>

Include at most one authorized, unblocked issue. If all candidates are blocked, output an empty issues array. Never weaken a dependency to force progress. Read only: do not change branches, files or issues.

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
