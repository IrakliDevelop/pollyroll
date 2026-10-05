---
name: pollyroll-size-bakeoff
description: Reduce Pollyroll's bundle size without changing behavior by running competing subagents in separate worktrees and keeping the smallest valid candidate. Use when size-limit fails or an entry is within 10% of its budget. Never raise a budget instead.
---

# Bundle size bake-off

Adapted from nuqs `bundle-size-bake-off` (MIT, François Best); see
[../THIRD_PARTY.md](../THIRD_PARTY.md).

Size budgets in `docs/PLAN.md` are hard limits. Raising a limit in the size-limit config requires the
owner's explicit approval and is never done to make CI pass.

## Measure

`pnpm build && pnpm size` prints min+gzip size per entry (`pollyroll`, `pollyroll/render`,
`pollyroll/react`) and fails when an entry is over its limit.

## Process

The thinking tier does not do this work itself. It creates N worktrees (default 3) at the baseline
commit (`git worktree add ../pollyroll-size-N -b size/N <base>`, then `pnpm install --frozen-lockfile`)
and dispatches one `pr-implementer` per worktree with these instructions:

1. Measure the baseline size first.
2. Refactor a scoped piece of code: inline or merge helpers, remove wrapper layers, shorten shader
   source (GLSL strings count toward the budget), share geometry generation.
3. Measure again. If any entry grew, revert and try something else. Otherwise commit a checkpoint
   and continue for a few rounds.
4. Try both small and large changes; back out of dead ends.
5. Squash checkpoints into one `perf(size): <what changed>` commit.

Some changes compress better than others: duplication can beat abstraction under gzip.

## Validation (any violation disqualifies a candidate)

- Logic-identical: all unit tests and the golden trajectory hash pass unchanged.
- No public API change: no renamed or removed exports.
- Readable and maintainable.
- Strictly smaller than the baseline and under every limit.

## Completion

Report a table sorted by reduction:

| Candidate | core | render | react |
| --------- | ---: | -----: | ----: |
| Baseline  |  n B |    n B |   n B |
| 1. …      | −n B |   −n B |  ±n B |

with one plain sentence per candidate on what it touched. Apply the best candidate on the main
branch, run the full verification matrix, and remove the bake-off worktrees and branches. In an
autonomous run, the thinking tier picks the winner itself and logs it in `docs/DECISIONS.md`.
