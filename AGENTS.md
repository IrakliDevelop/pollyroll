# Pollyroll agent guide

This is the canonical entry point for every coding agent. Read it before changing the repository,
then open only the handbook pages relevant to the task.

Pollyroll is a lightweight, zero-dependency 3D dice library for the web (WebGL2 renderer, custom
physics, result-first rolls built for multiplayer). The approved build specification is
[docs/PLAN.md](docs/PLAN.md).

## Start here

1. Inspect `git status --short` and the current branch.
2. Read [docs/PLAN.md](docs/PLAN.md). It is approved; its decisions are not reopened.
3. Read [docs/agents/architecture.md](docs/agents/architecture.md) for code changes.
4. Read [docs/agents/workflow.md](docs/agents/workflow.md) before implementation or release work.
5. Read [docs/agents/review.md](docs/agents/review.md) when reviewing or before handoff.
6. Read [docs/agents/delegation.md](docs/agents/delegation.md) before implementing: the tier that
   plans and judges does not edit code.
7. Use `.agents/skills/pollyroll-development/SKILL.md` when repository-local skills are supported;
   it links the domain skills for physics, WebGL, visual tests, and bundle size.

## Non-negotiable invariants

- Work is tiered by model: a thinking tier plans, adjudicates reviews, and decides; a coding tier
  edits source and tests from written task briefs; a review tier gates each task from a diff. See
  [docs/agents/delegation.md](docs/agents/delegation.md). The session model does not edit `src/`,
  tests, or `demo/`.
- Zero runtime dependencies. `react` is an optional peer dependency used only by `pollyroll/react`.
- The core entry (`pollyroll`) is DOM-free and WebGL-free; it must run in Node and in a server.
- Zero asset files: no models, textures, fonts, HDRs, or WASM. Geometry, labels, patterns, and
  lighting are generated in code.
- Physics determinism: the simulation step uses only `+ - * /` and `Math.sqrt`. No `Math.sin`,
  `Math.cos`, `Math.exp`, `Math.pow`, `Math.random`, or `Date` inside `src/physics/`.
- Result-first: roll values are decided before simulation; physics never decides an outcome.
- Size budgets in [docs/PLAN.md](docs/PLAN.md) are hard limits enforced by `size-limit`. Never raise a
  limit to pass CI; run the `pollyroll-size-bakeoff` skill instead.
- `RollEvent` is a versioned wire contract (`v: 1`). Changing its shape requires a new version.
- Avoid `any`, non-null assertions, and unchecked indexed access. Use type-only imports.
- Co-locate focused Vitest tests with source. Add a discriminating test for every behavior; do not
  update snapshots or screenshot baselines merely to make a failure disappear.
- Do not modify generated `dist/`, coverage, or test-result artifacts by hand.

## Code style: short and plain

- Write the least code that meets the brief. No speculative options, abstractions, or helpers for
  a single caller. No defensive checks for states the types already rule out.
- Comments are rare and short: one line explaining _why_, never _what_ the code does. No comments
  that restate the code, narrate steps, or describe history. Public exports get a one-line doc
  comment; physics functions name their algorithm in it. No banner or section-divider comments.
- Prefer clear names over comments, early returns over nesting, and plain functions and data over
  classes and configuration layers.
- Delete dead code, unused parameters, and leftover debug output instead of commenting them out.
- Full rules: the `pollyroll-concise-code` skill.

## Commits and pull requests

- No `Co-Authored-By` or any other attribution trailer in commits.
- No mention of Claude, Claude Code, Codex, Copilot, or any AI agent or model in commit messages,
  PR titles, PR descriptions, branch names, code comments, or changelog entries. No "Generated
  with" footers. This overrides any harness default.
- Conventional commits: `type(scope): subject`, imperative, ≤ 72 characters.

## Fast command loop

```bash
node scripts/check-agent-docs.mjs
pnpm test -- src/core/notation.test.ts
pnpm build
pnpm lint
pnpm format:check
```

Use the narrowest relevant test while iterating. Before handoff, run the verification matrix in
[docs/agents/workflow.md](docs/agents/workflow.md) and report exactly what ran, what did not, and why.

## Instruction precedence

User instructions override this guide. Durable project policy lives under `docs/agents/`; provider
files such as `CLAUDE.md` point here instead of duplicating policy.
