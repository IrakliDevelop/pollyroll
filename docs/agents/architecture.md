# Architecture map

## Module ownership

| Path                         | Responsibility                                                                                 | Primary verification                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/index.ts` + `src/core/` | Public core entry: RNG, notation, `createRoll`, `evaluate`, `redact`, `isRollEvent`. DOM-free. | unit tests, coverage, core size budget                              |
| `src/geometry/`              | Polyhedron generation, chamfering, face/vertex labels, rotation symmetry groups                | unit tests (group order, transitivity, remap for every die × value) |
| `src/physics/`               | Deterministic fixed-step simulation, settle detection, up-face read, keyframe tracks           | unit tests, golden trajectory hash, bench                           |
| `src/skins/`                 | `Skin` types, presets, GLSL pattern sources, `defineSkin`, `registerSkin`                      | unit tests for composition; screenshots per preset                  |
| `src/render/`                | `pollyroll/render` entry: WebGL2 tray, shaders, glyph atlas, environment, animation loop       | Playwright smoke + screenshots, render size budget                  |
| `src/react/`                 | `pollyroll/react` entry: `useDiceTray`, `<DiceTray />`                                         | React Testing Library tests, react size budget                      |
| `demo/`                      | Vite playground: notation input, skin picker, two-tray shared roll                             | demo build, manual smoke                                            |
| `e2e/`                       | Playwright: render smoke, screenshots, cross-browser determinism                               | `pnpm e2e`                                                          |

## Dependency direction

`core` ← `geometry` ← `physics` ← `render` ← `react`; `skins` is used by `render` (types also by
`core` for `SkinRef`). Nothing imports upward. `core` never imports `render`, `react`, or any DOM or
WebGL type. `physics` and `geometry` are DOM-free so they run under Node for tests and benches.

## Roll pipeline

1. `createRoll(notation)` parses, draws values with the values RNG, generates a 128-bit seed, and
   returns a `RollEvent`.
2. `DiceTray.playRoll(event)` derives throw parameters from the seed (`sfc32`), runs the headless
   simulation to completion, reads each die's settled up-face, and chooses the symmetry rotation that
   maps the face carrying `value` onto it.
3. The animation plays the keyframe tracks with orientation `q(t) · S`. Every client running the
   same event plays the same motion and shows the same values.
4. `evaluate(event)` produces the summary; `playRoll` resolves with it after settle.

## Contracts needing extra caution

- `RollEvent` shape and `isRollEvent` validation: public wire format, versioned by `v`.
- Notation grammar and limits: changing accepted input is a public behavior change.
- `src/physics/**`: determinism rule from AGENTS.md; any change must keep the golden hash or update
  it with an explanation of the intended motion change.
- Symmetry tables: a wrong rotation shows the wrong number — a correctness failure, not a visual one.
- Exports map and size budgets in `package.json` / size-limit config.
- GPU resources: every buffer, texture, program, and listener created by a tray is released by
  `dispose()`; context loss rebuilds them.
