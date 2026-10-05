# Workflow and verification

## Work loop

1. Establish scope: status, branch, the plan section, nearby source, tests, exports, and callers.
2. The thinking tier writes a task brief; a coding-tier agent makes the change (see
   [delegation.md](delegation.md)).
3. Write a test that distinguishes old from desired behavior and watch it fail.
4. Make the smallest coherent change; no unrelated cleanup.
5. Run the focused test, then `pnpm build` and `pnpm typecheck`. DTS builds catch errors Vitest misses.
6. Review the diff, exports, size budgets, and docs.
7. Run the verification matrix row for the change and hand off with evidence.

Pure refactors move behavior mechanically and leave existing tests unchanged. Do not combine a
refactor and a behavior change in one task.

## Verification matrix

| Change class                      | Required minimum                                                      |
| --------------------------------- | --------------------------------------------------------------------- |
| Docs / agent tooling              | `pnpm agent:check`, `pnpm format:check`                               |
| Core (`src/core`, `src/index.ts`) | focused test, `pnpm test:coverage`, `pnpm build`, `pnpm size`         |
| Geometry / physics                | focused test, `pnpm test`, `pnpm bench` (record result), `pnpm build` |
| Skins / renderer                  | `pnpm build`, `pnpm size`, `pnpm e2e` (Chromium at least), demo smoke |
| React binding                     | react tests, `pnpm build`, `pnpm size`                                |
| Tooling / CI / release            | `pnpm verify`, then `pnpm e2e`                                        |

Before scaffolding exists (phase 0), only `node scripts/check-agent-docs.mjs` is available.

Never claim a check passed unless it ran in the current worktree. Never regenerate a screenshot
baseline or the golden trajectory hash without stating the intended change.

If a Playwright browser cannot be installed in the current environment, run what can run, state
exactly which browsers were skipped, and rely on CI for the rest.

## Commits, PRs, and releases

- Conventional commits, one or more per task. No co-author or attribution trailers. No mention of
  Claude, Claude Code, Codex, or any AI agent or model anywhere in commits, PR titles, PR bodies,
  branch names, comments, or the changelog. No "Generated with" footers.
- Every shippable PR bumps the version (0.x: minor for new public API, patch for fixes) and updates
  `CHANGELOG.md`. Instruction-only changes are exempt.
- Never hand-edit `dist/`. Publishing to npm is done manually by the owner.

## Handoff format

State the outcome, key files and decisions, checks actually run with decisive output, anything
unverified, and risks or one useful next step.
