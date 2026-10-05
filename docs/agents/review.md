# Code-review playbook

Review behavior and contracts before style. Read the diff, then the callers and tests outside it.

## Review order

1. **Intent and scope:** the brief's behavior, nothing more, nothing less.
2. **Correctness:** edge cases, ordering, error paths, cleanup, concurrent `playRoll` calls.
3. **Determinism:** no forbidden math or nondeterministic sources in `src/physics/`; iteration
   order fixed; seed is the only input to throw parameters; golden hash untouched or justified.
4. **Result integrity:** displayed face equals `value` for every die type; `evaluate` matches the
   notation semantics; redacted events leak no values.
5. **Contracts:** exports map, `RollEvent` v1 shape, `isRollEvent` rejects malformed and
   out-of-range input, notation limits enforced, size budgets met.
6. **Rendering and performance:** no per-frame allocation in the render loop, loop stops after
   settle, instancing intact, DPR cap, GPU resources released on `dispose`, context loss handled.
7. **Tests:** a discriminating test that fails without the change, negative cases, DTS build;
   the `pollyroll-testing` rules (named break, hand-derived expectations, no own-module mocks).
8. **Maintainability:** dependency direction from architecture.md, strict types, no incidental
   export, no runtime dependency, no asset file.
9. **Concision:** comments that restate code or run past one line, speculative options or
   abstractions, single-use helpers, dead code. Report as P2 with the lines to delete.
10. **Hygiene:** commits carry no attribution trailers or AI mentions.

## Severity and scoring

| Level          | Meaning                                                                        | Effect                          |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| P0 / Critical  | Wrong roll result shown, leaked redacted values, crash, budget broken by > 10% | Blocks; fix now                 |
| P1 / Important | Likely correctness, determinism, contract, or leak issue                       | Must fix before task acceptance |
| P2 / Minor     | Narrow-path or maintainability issue                                           | Recorded; branch review decides |
| P3             | Optional improvement                                                           | Mention only; never block       |

Task review returns `APPROVE` or `FIX`. Branch review scores every exit criterion in
[PLAN.md](../PLAN.md) § 9 as `PASS` / `FAIL` / `UNVERIFIED` with evidence (command and decisive
output line), then returns `READY` or `NOT_READY`. A branch is `READY` only with zero P0/P1 findings
and no `FAIL` criteria.

List findings first by severity as `file:line — failure scenario — why tests miss it — fix`. If there
are no findings, say so and name residual test or environment gaps. No praise.
