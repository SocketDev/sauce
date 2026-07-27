# Verify Build & Test

Standard workflow for verifying that changes don't break the project. Use after dependency removal, updates, or patches.

## Steps

1. **Build the project** using its standard build command (e.g., `npm run build`, `cargo build`, `go build ./...`)
2. **Run the full test suite** (e.g., `npm test`, `cargo test`, `go test ./...`, `pytest`)
3. **If the build or tests fail:**
   - Identify which change caused the failure from the error messages
   - Revert the failing change using `git checkout -- .` or the package manager's install/add command
   - Move the reverted item to a "needs manual review" category
   - Report the failure to the user with the error details
4. **If everything passes:** proceed to the next step or commit the changes

## Key Principles

- **Never leave the project in a broken state.** If a change breaks the build or tests, revert it before continuing.
- **Test after every individual change**, not in batches. This makes it easy to isolate which change caused a failure.
- **Commit on success** so progress is preserved and failures can be cleanly reverted.
