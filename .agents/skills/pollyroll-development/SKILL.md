---
name: pollyroll-development
description: Implement, debug, test, or review changes in Pollyroll, the zero-dependency 3D dice library (dice notation and roll events, deterministic physics, polyhedral geometry and symmetry, WebGL2 renderer, skins, React binding). Use for any code, test, tooling, or review work in this repository.
---

# Pollyroll development

Read `AGENTS.md` from the repository root and `docs/PLAN.md`. Then read only the relevant handbook
page:

- `docs/agents/architecture.md` to locate ownership, dependency direction, and contracts.
- `docs/agents/workflow.md` for implementation, verification, commits, and releases.
- `docs/agents/review.md` for review, severity, and exit-criteria scoring.
- `docs/agents/delegation.md` to split briefing, coding, and review across model tiers.

Domain skills (load the one matching the task):

- `pollyroll-physics`: simulation, contacts, symmetry, remap, and their mandatory tests.
- `pollyroll-webgl`: shaders, PBR, patterns, renderer lifetime, context loss.
- `pollyroll-visual-tests`: Playwright screenshots and cross-browser determinism.
- `pollyroll-concise-code`: always, while writing code and for the final deslop pass.
- `pollyroll-size-bakeoff`: when a size budget fails or is within 10%.

## Execute

1. Inspect `git status --short`, the plan section, nearby tests, exports, and callers.
2. State the behavioral contract and the budgets at risk.
3. Add a discriminating test first. Keep the core DOM-free, physics deterministic, results
   result-first, and the bundle within budget.
4. Implement the smallest coherent diff using existing local patterns.
5. Run the focused test, `pnpm build`, `pnpm typecheck`, and the verification matrix row.
6. Review the final diff with the review playbook. Report exact verification and residual gaps.

## Test anti-patterns

Adapted from mattpocock/skills `tdd` (MIT); see [../THIRD_PARTY.md](../THIRD_PARTY.md).

- **Tautological:** the assertion recomputes the expected value the way the code does, so it passes
  by construction. Expected values come from an independent source: a hand-computed literal, a
  worked example, or `docs/PLAN.md`.
- **Implementation-coupled:** the test reaches into internals and breaks on a refactor that keeps
  behavior. Test at the public seams: the three entry points, and the internal module boundaries
  named in `docs/agents/architecture.md` (geometry, physics) where the brief says so.
- **Horizontal slicing:** writing every test first, then every implementation. Work in vertical
  slices: one failing test, the code that passes it, repeat.

Commits and PRs carry no attribution trailers and no mention of any AI agent or model. Do not edit
`dist/`, coverage, screenshot baselines, or the golden trajectory hash merely to silence a failure.
