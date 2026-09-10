# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Acceptance gate first**: Read issue {{TASK_ID}} and its comments using `{{VIEW_TASK_COMMAND}}` (substitute the task ID). Check every acceptance criterion, dependency, external input and required approval against the branch. Existing commits may be partial work recovered after an interrupted implementation. Missing inputs, correctness defects or unverified required tests mean BLOCKED, not approval. Do not close or edit tracker issues.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Check correctness**:
   - Does the implementation match the intent? Are edge cases handled?
   - Are new/changed behaviours covered by tests?
   - Are there unsafe casts, `any` types, or unchecked assumptions?
   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?

4. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

5. **Apply project standards**: Follow the coding standards defined in @.ralph/CODING_STANDARDS.md

6. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run tests and type checking to ensure nothing is broken
3. Commit describing the refinements

If the code is already clean and well-structured, do nothing.

Run the required tests and type checking even if no refinement was necessary, within the project's server/device permissions. If a required check cannot run, report it as blocked. Preserve functionality; report functional defects rather than disguising them as readability fixes.

Only when every acceptance criterion within this slice is satisfied, required checks pass, and no blockers remain, output <promise>REVIEW_APPROVED</promise>. Otherwise report concrete blockers and stop WITHOUT that marker. A review ending or a test subset passing is not approval.
