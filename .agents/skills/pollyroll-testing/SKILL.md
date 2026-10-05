---
name: pollyroll-testing
description: Test-quality rules for Pollyroll: naming the break, hand-derived expectations, mocking only at real boundaries, property-based tests with fast-check, golden-value discipline, and flake prevention. Use when writing, changing, or reviewing any test.
---

# Pollyroll testing

Adapted from obra/superpowers `writing-good-tests` (MIT, Jesse Vincent) and Cursor pstack
`principle-test-behavior-not-implementation` (MIT, Lauren Tan); property-testing rules paraphrased
from Trail of Bits `property-based-testing` and nyxandro `property-testing-skill` (MIT). See
[../THIRD_PARTY.md](../THIRD_PARTY.md). Domain categories live in `pollyroll-physics` and
`pollyroll-visual-tests`; anti-patterns in `pollyroll-development`.

## Name the break

Before writing a test body, name the production change that should make it fail, and check that
change is a bug, not a decision.

- Cannot name one → test an observable behavior instead.
- Only intentional decisions fail it (a constant's value, exact message text) → change detector;
  test the behavior that depends on the decision.
- Would it still pass if every imported function returned `undefined`? Then it observes nothing.
- Weak assertions alone (`toBeDefined`, `toBeTruthy`, `not.toThrow`, `toBeGreaterThan(0)`) do not
  count.

## Expected values

- Derive expectations independently: literals and hand-checked fixtures. Table-driven tests with
  literal expected values are the preferred shape (`it.each`).
- Never compute the expected value with the code under test or its helpers.
- Test names state the behavior: `parse rejects "2d7" at index 2`, not `parse works`.

## Mocks and fakes

- Mock only real boundaries: WebGL2 context, `requestAnimationFrame`, `matchMedia`, crypto. Never
  mock Pollyroll's own modules.
- Inject instead of mocking: the values RNG, the seed, and time are parameters, so tests pass
  deterministic ones.
- A fake mirrors the real structure completely; a partial fake hides integration failures.
- Assert behavior, never that a mock exists or was called; when the call is the contract, assert
  its arguments.
- Renderer behavior is verified in a real browser (Playwright), not by asserting GL call sequences.
  Unit tests in `src/render/` cover only pure helpers (atlas layout, matrix math, skin resolution).
- Test-only cleanup lives in test utilities, never as production methods.

## Property-based tests (fast-check, dev dependency)

Use where an input space is large and a property is cheap to state:

- Notation: a notation string built in the test from a generated term list parses back to those
  terms; limits reject every input beyond them. (There is no production `format`; the test owns
  the string builder.)
- Rolls: every value is within its die's range; `evaluate` total equals the kept sum plus modifier
  (an independent oracle written in the test, not the production helper); `redact` leaves no value.
- Physics: no `NaN` or `Infinity` for any seed; same seed → bit-identical track; remap shows the
  chosen value for every seed.

Rules:

- Assert the strongest property available: no crash < invariant < round-trip or oracle.
- Constrain inputs in the generator (`fc.integer({ min: 1, max: 100 })`), not with filters that
  discard most cases.
- Pin known edge cases with `examples` so they run every time; never fix the seed permanently.
- One property per test, named with the property in words.

## Golden values

The trajectory hash and screenshot baselines change only with an explanation of the intended
change in the same commit. A golden value that changes in an unrelated commit is a bug.

## Flake prevention

- No real timers, `Date.now`, `Math.random`, or network in unit tests.
- No `waitForTimeout` in e2e; wait on explicit ready or settled signals.
- Tests do not depend on execution order or shared mutable state.

## Mutation check

Before finishing, mentally mutate the code; at least one test fails for each:

- wrong constant or argument
- wrong branch
- missing state change
- empty or default return
- missing validation for zero, empty, or malformed input
