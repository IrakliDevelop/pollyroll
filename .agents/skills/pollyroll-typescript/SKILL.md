---
name: pollyroll-typescript
description: Clean, readable TypeScript standards for Pollyroll: type design, boundaries, error handling, module shape, and code smells. Use when writing or reviewing any .ts or .tsx file in this repository.
---

# Pollyroll TypeScript standards

Rule table adapted from Cursor pstack `typescript-best-practices` (MIT, Lauren Tan); smell list
adapted from mattpocock/skills `code-review` and `codebase-design` (MIT, Matt Pocock); type-design
and silent-failure checks paraphrased from Anthropic `pr-review-toolkit`. See
[../THIRD_PARTY.md](../THIRD_PARTY.md). Pair with `pollyroll-concise-code`.

## Types

| Rule                  | Summary                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Discriminated unions  | Model variants with a literal discriminant (`kind`, `type`) so impossible states can't be represented. No optional-field bags.     |
| Branded types         | Brand primitives that share a type but differ in meaning (`Seed`, `FaceIndex`) and validate once at the boundary.                  |
| Constructive modeling | Build the shape so the illegal value can't be constructed (`[T, ...T[]]` for non-empty).                                           |
| Simplest total type   | Keep `T[]` while every operation stays total; strengthen only where the loose type forces `!`, a cast, or a "never happens" throw. |
| `unknown` over `any`  | External data is `unknown` until parsed.                                                                                           |
| No `as` casts         | Cast only after validation. `satisfies` over `as` for literals.                                                                    |
| Narrowing order       | Discriminant switch > `in` > `typeof`/`instanceof` > type guard > `as`.                                                            |
| Honest guards         | A type guard (`isX`) checks everything it claims. A lying guard is worse than a cast.                                              |
| Exhaustiveness        | `const _exhaustive: never = x;` in default arms.                                                                                   |
| Derived types         | `Pick`/`Omit`/`ReturnType`/`typeof` before declaring a parallel interface.                                                         |
| Object args           | Objects over long positional lists for public APIs. Hot paths (physics step, render loop, parser) keep positional args.            |
| Readonly at the edge  | Public inputs and returned data are `readonly`; internal hot-path buffers stay mutable typed arrays.                               |

The test for a loose type: if a comment is needed to explain which field combinations are valid,
split it into a union.

## Boundaries

- Parse untrusted data once where it enters (`parse`, `isRollEvent`, public option objects) into a
  domain type, then trust the type inside. No zod or other schema library (zero dependencies):
  hand-written parsers with tests.
- Pure core: notation, evaluation, geometry, and physics are pure functions of their inputs (RNG
  and seed injected). DOM, WebGL, time, and `requestAnimationFrame` live only in `src/render/`.
- Collapse pass-through layers. Deletion test: if deleting a module makes complexity vanish rather
  than move, it was a pass-through. One implementation of an interface is a hypothetical seam;
  inline it until a second one exists.

## Errors

- Fail loudly at boundaries with typed errors (`PollyrollSyntaxError`, `PollyrollShaderError`).
- No empty `catch`, no catch-and-continue, no returning a default value to hide a failure, no `?.`
  to silently skip work that must happen, no fallback chains without a stated reason.
- No `console.*` in shipped code.

## Smells to fix on sight

- **Data clumps:** the same fields travel together → one type.
- **Primitive obsession:** a raw number or string stands for a domain concept → brand it or give it
  a small type.
- **Repeated switches:** the same switch on the same union in several places → one lookup table
  both sites share.
- **Speculative generality:** parameters, hooks, or abstractions the plan doesn't need → delete.
- **Middle man:** a function that only forwards → call the target directly.
- **Long function:** a function that needs section comments → split at those seams, unless it is a
  hot loop where the split costs performance.
