---
name: pollyroll-concise-code
description: Rules for short, plain code and sparse comments in Pollyroll, plus a deslop pass over a branch diff. Use while writing any code, when reviewing a diff for verbosity or over-engineering, and as the final cleanup pass before branch review.
---

# Concise code

Draws on Anthropic's overengineering guidance, the Karpathy coding guidelines, and Cursor's
`deslop` skill (MIT, Cursor); see [../THIRD_PARTY.md](../THIRD_PARTY.md).

Bundle budgets make every line cost bytes. Write code a senior engineer would not call
overcomplicated. If 200 lines could be 50, rewrite it.

## Scope

- Implement what the brief asks and nothing more. No features, options, or configurability that
  nobody requested.
- Every changed line traces to the brief. Do not "improve" adjacent code, comments, or formatting.
- Remove imports, variables, and functions your change made unused. Leave pre-existing dead code to
  its own task unless the brief says otherwise.

## Structure

- No helpers, utilities, or abstractions for a single caller. Inline first; extract on the second
  real use.
- No interfaces, classes, factories, or option objects where a plain function and plain data do.
- Early returns over nested conditionals. Flat over deep.
- Readability still wins over cleverness: no nested ternaries or dense one-liners to save a line.

## Defensive code

- No validation, fallbacks, or `try/catch` for states the types or internal callers rule out.
- Validate only at system boundaries: `isRollEvent`, `parse`, public option objects, WebGL calls
  that can fail (shader compile, context loss).
- No casts to `any` or `as` chains to silence the type checker; fix the types.

## Comments

- Default is no comment. Names and types carry the meaning.
- A comment explains _why_: an invariant, a non-obvious constraint, a workaround, a tradeoff. One
  line, rarely two.
- Never: restating the code, narrating steps (`// loop over dice`), describing history or the task
  (`// added for phase 2`), commented-out code, banner or divider comments, `TODO` without an owner.
- Required: a one-line doc comment on each public export; physics and geometry functions name the
  algorithm they implement (for example `/** Semi-implicit Euler step. */`). These are not noise.
- Tests: the test name states the behavior; no comments repeating it.

## Deslop pass

Run on `git diff <base>..HEAD` before branch review, as a separate task after the TDD work (never
inside the red–green loop):

- Remove extra comments that are unnecessary or inconsistent with local style.
- Remove defensive checks or `try/catch` blocks that are abnormal for trusted code paths.
- Remove casts to `any` used only to bypass type issues.
- Flatten deeply nested code with early returns.
- Fix other patterns inconsistent with the surrounding code.

Guardrails: behavior unchanged (all tests and the golden trajectory hash still pass), minimal
focused edits over broad rewrites, never delete tests, and the size-limit numbers must not grow.
