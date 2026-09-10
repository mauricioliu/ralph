# TASK

Integrate these reviewed branches at exactly the supplied commits into the current target branch:

{{BRANCHES}}

Associated issues (context only):

{{ISSUES}}

1. Verify each branch tip matches the supplied SHA. Stop if it changed.
2. Merge each branch with `git merge <branch> --no-edit`. Resolve conflicts by preserving the contracts of both sides, not by dropping tests.
3. Run `npm run typecheck` and `npm run test` after integration, even without conflicts. Respect project server/device permissions: if a required check is prohibited or cannot run, stop and report the missing evidence.
4. Commit any integration fixes and verify every supplied SHA is an ancestor of HEAD and no conflicts/uncommitted integration changes remain.

Only after ALL branches and checks pass, output <promise>COMPLETE</promise>. Otherwise name the failure and stop without that marker.

Do not close or edit issues, push, deploy, send real commercial mail or alter real customer data. The host verifies ancestry separately; issue acceptance and closure happen after that verification.
