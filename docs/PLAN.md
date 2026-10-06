# Pollyroll build plan

Approved specification for the initial build. Decisions here are fixed; an agent that finds a
genuine gap records its choice in [DECISIONS.md](DECISIONS.md) and continues (see
[agents/delegation.md](agents/delegation.md) § Autonomous run).

> **Amended 2026-10-06 by the owner after the 0.1.0 build.** Sections below describe the shipped
> behavior; lines marked _(amended)_ replace the original text, and the reason for each is in
> [DECISIONS.md](DECISIONS.md). § 12 separates what is verified from what was decided and what is
> still unverified.

Goal: a lightweight, customizable 3D dice library to replace `@3d-dice/dice-box` in RollKeeper,
built for shared (multiplayer) rolls from day one. Independent of Fieldnotes and RollKeeper.

- Repo: `IrakliDevelop/pollyroll`, default branch `master` · npm: `pollyroll` (unscoped) · MIT
- Zero runtime dependencies. Zero asset files.

## 1. Fixed decisions

| Area      | Decision                                                                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering | Custom **WebGL2** renderer. No three.js, Babylon, OGL, or other engine.                                                                                                                                                                                                                                              |
| Physics   | Custom fixed-step rigid-body solver in TypeScript. No rapier, cannon, or ammo.                                                                                                                                                                                                                                       |
| Outcome   | **Result-first.** Values are chosen by RNG before simulation; physics only animates.                                                                                                                                                                                                                                 |
| Remap     | Simulate headless, read the settled up-face, then post-multiply the die's orientation for the whole trajectory by a **rotation symmetry** of its polyhedron that moves the chosen value's face to the settled up-face. Geometry is invariant, so the motion is unchanged and the real-die label layout is preserved. |
| Assets    | None. Geometry generated in code; labels from a runtime Canvas2D glyph atlas; patterns procedural in GLSL; environment lighting analytic.                                                                                                                                                                            |
| Transport | The library never touches the network. It creates and plays plain `RollEvent` objects.                                                                                                                                                                                                                               |
| Fallback  | No WebGL2, or reduced motion → `playRoll` resolves immediately with the summary, no animation.                                                                                                                                                                                                                       |
| Package   | Single package at the repo root with subpath exports: `pollyroll` (core, DOM-free), `pollyroll/render`, `pollyroll/react`.                                                                                                                                                                                           |
| Tooling   | pnpm 10, Node ≥ 20.19, TypeScript strict (`tsconfig.base.json`), tsup (ESM + CJS + DTS), Vitest, Playwright, size-limit (`@size-limit/preset-small-lib`), fast-check (property tests), ESLint + Prettier (configs at repo root), husky + lint-staged.                                                                |

### Budgets (min+gzip, hard limits in `size-limit`)

| Entry                                                                       | Limit |
| --------------------------------------------------------------------------- | ----- |
| `pollyroll` (core)                                                          | 4 KB  |
| `pollyroll/render` (renderer + physics + geometry + shaders + skin presets) | 30 KB |
| `pollyroll/react` (excluding react)                                         | 1 KB  |

Baseline being replaced: dice-box JS plus 2.1 MB of `public/assets` (ammo.js + themes).

### Performance targets

- Headless pre-simulation of 10 dice to settle: ≤ 5 ms. Measured with `vitest bench`
  (`src/physics/sim.bench.ts`); recorded in the PR, not gated in CI.
- 60 fps with 10 dice under Chrome 4× CPU throttle (manual check in the demo; record result).
- One instanced draw call per die type plus one shadow pass. Device pixel ratio capped at 2.
- Render-on-demand: the frame loop stops once every die has settled. Idle cost is zero.
- Maximum 30 animated bodies per tray; dice beyond 30 are included in the summary but not animated.

## 2. Dice set

| Type   | Faces   | Values    | Labels                                                                                             |
| ------ | ------- | --------- | -------------------------------------------------------------------------------------------------- |
| `d4`   | 4       | 1–4       | value read at the top vertex (standard d4 layout: each face shows three numbers near its vertices) |
| `d6`   | 6       | 1–6       | opposite faces sum to 7                                                                            |
| `d8`   | 8       | 1–8       | opposite faces sum to 9                                                                            |
| `d10`  | 10      | 1–10      | faces `0`–`9`; value 10 shows `0`; opposite faces sum to 9                                         |
| `d12`  | 12      | 1–12      | opposite faces sum to 13                                                                           |
| `d20`  | 20      | 1–20      | opposite faces sum to 21                                                                           |
| `d100` | 2 × d10 | 1–100     | one event entry; rendered as a tens d10 (`00`–`90`) and a ones d10 (`0`–`9`); `00` + `0` = 100     |
| `dF`   | 6       | −1, 0, +1 | d6 geometry labeled `−`, `−`, blank, blank, `+`, `+`                                               |

- `6` and `9` carry an underline on d10, d12, d20, and the d100 ones die.
- Rotation groups (transitive on faces, so every value is reachable): d4 T (12), d6 and d8 O (24),
  d10 D5 (10), d12 and d20 I (60). Groups are computed at module init from vertex sets and cached;
  tests assert group order and transitivity.
- Custom label arrays per die type are supported (same geometry, user labels, same value mapping).
  _(amended)_ `TrayOptions.labels[set][i]` follows the die's natural sequence (d4–d20 value − 1,
  d10/d100 digit, d100 tens digit, dF −/blank/+).

## 3. `RollEvent` (wire contract, v1)

```ts
type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100' | 'dF';

interface RollEvent {
  v: 1;
  id: string; // crypto.randomUUID(); receivers dedupe on it
  notation: string; // as entered, e.g. "2d20kh1+5"
  dice: Array<{
    type: DieType;
    value: number | null; // null = redacted
    group: number; // index of the notation term that produced the die
    wave: number; // 0 = initial throw; 1+ = explosion waves
  }>;
  modifier: number; // sum of constant terms
  seed: string; // 32 hex chars (128 bits); derives every throw parameter
  skin?: SkinRef; // preset name or inline Skin
  rollerId?: string;
  audience?: 'all' | 'dm' | string[];
  createdAt: number; // epoch ms
}
```

- Totals, kept, and dropped dice are derived by `evaluate(event)` and never sent.
- Throw parameters (positions, velocities, spins, wave timing) derive only from `seed`.
- `redact(event)` returns a copy with every `value` set to `null` _(amended)_ and every explosion
  die (wave ≥ 1) removed, so a hidden roll does not reveal a maximum. Playing a redacted event animates
  dice with blank labels and resolves with `total: null`.

## 4. Core API (`pollyroll`)

```ts
parse(notation: string): RollAst;                 // throws PollyrollSyntaxError { message, index }
createRoll(notation: string, opts?: {
  rng?: (maxExclusive: number) => number;         // default: crypto.getRandomValues + rejection sampling
  seed?: string; skin?: SkinRef; rollerId?: string; audience?: RollEvent['audience'];
}): RollEvent;
evaluate(event: RollEvent): RollSummary;          // { total | null, modifier, groups: [{ dice, kept, dropped, subtotal }] }
redact(event: RollEvent): RollEvent;
isRollEvent(input: unknown): input is RollEvent;  // validates untrusted input, including bounds
```

- Values RNG: unbiased integers via `crypto.getRandomValues` with rejection sampling; injectable.
- Seed RNG: `sfc32` seeded from the 128-bit seed. Identical sequences everywhere.
- Notation v1 grammar (hand-written recursive-descent parser, case-insensitive, whitespace ignored):
  `NdX` (X ∈ 4,6,8,10,12,20,100), `d%`, `dF`, implicit N = 1, `+`/`-` between terms, integer
  constants, `khN`/`klN`/`dhN`/`dlN`, `adv`/`dis` (aliases for `2d20kh1`/`2d20kl1`), `!` explode on
  max (explosion dice pre-generated into later waves, capped at 10 waves). Limits: N ≤ 100 per term,
  ≤ 20 terms, total dice ≤ 200.
- _(amended)_ Aliases: `kN` = `khN`, `dN` (as a suffix) = `dlN`, `x` = `!`; N defaults to 1. Aliases
  parse to the same AST, so `RollEvent` v1 is unchanged.
- Out of scope for v1: rerolls, compounding, success counting, crit ranges.

## 5. Physics (`src/physics/`, internal, DOM-free)

- Units: d6 edge length = 1. Gravity −30 units/s². Fixed step 1/120 s; hard stop at 720 steps.
- Bodies: convex polyhedra with mass 1 and the inertia tensor of a solid of the die's shape.
- Contacts: hull vertices against floor and four wall planes (exact); die against die via bounding
  spheres. Sequential impulses with restitution 0.35, friction 0.6, linear and angular damping.
  _(amended)_ Contacts are warm-started from the previous step's impulses.
- Settle: every body below 0.05 units/s linear and 0.1 rad/s angular speed for 24 consecutive steps.
- Determinism rule from AGENTS.md: only `+ - * /` and `Math.sqrt` in the step; quaternion
  integration with a first-order update and explicit renormalization.
- Tray: floor at y = 0; walls at the visible floor bounds (from canvas aspect and the fixed camera)
  minus a margin. Throw origin, direction, speed, and spin come from the seed RNG.
- Waves: each explosion wave is thrown after the previous wave settles; earlier dice stay as bodies.
- Output: per die, a keyframe track (position + quaternion per step) plus the settled up-face.
- _(amended)_ Settle-to-flat: after settling, any die more than 0.5° off flat gets a deterministic
  24-step tail that rolls it onto its up face and rests it on the floor (dice can come to rest
  cocked against walls, neighbours' spheres, or balanced on an edge). Before the tails, resting
  dice closer than 0.8·(Rᵢ + Rⱼ) are pushed apart (8 deterministic passes, clamped to the walls).
- _(amended)_ Auto-fit: a roll uses the largest scale ≤ `dieScale` on a 0.05 grid whose tray area
  holds 5 die-units² per animated body, so large rolls shrink instead of overlapping.

## 6. Renderer (`pollyroll/render`)

```ts
createDiceTray(target: HTMLCanvasElement | HTMLElement, opts?: TrayOptions): DiceTray;

interface TrayOptions {
  skin?: SkinRef; labelFont?: string; dieScale?: number;   // default 2, max size; auto-fit (amended)
  shadows?: boolean;                                        // default true (blob shadows)
  maxDpr?: number;                                          // default 2
  reducedMotion?: 'auto' | 'always' | 'never';              // default 'auto' (media query)
  fadeAfterMs?: number | null;                              // default null: dice stay until next roll
  labels?: Partial<Record<LabelSet, readonly string[]>>;    // (amended) custom labels, natural order
}

interface DiceTray {
  playRoll(event: RollEvent): Promise<RollSummary>;         // pre-sim → remap → animate → settle
  setSkin(skin: SkinRef): void;
  setDieScale(scale: number): void;                         // (amended) applies to the next roll
  clear(): void; resize(): void; dispose(): void;
  readonly supported: boolean;                              // false when WebGL2 is unavailable
}
```

- A new `playRoll` replaces the dice of the previous roll.
- An `HTMLElement` target gets an absolutely positioned, transparent, pointer-events-none canvas.
- Forward pass, GGX PBR (base color, metalness, roughness, clearcoat). _(amended)_ Fixed
  orthographic camera looking straight down (visible half height 5.1 world units at every aspect),
  so every die's up face is seen face-on; walls inset 0.6 die units; blob shadows offset away from
  the key light to show height. The original 50° perspective camera made results hard to read.
- Lighting: analytic sky/ground gradient environment plus one directional key light.
- Glass: back faces first, then front faces with Fresnel-weighted alpha and an environment
  refraction tint.
- Shadows: one soft projected blob per die on the floor.
- Labels: Canvas2D glyph atlas built at init from `labelFont` (default `system-ui`); styles
  `engraved` (bump from atlas alpha via screen-space derivatives), `printed`, `embossed`.
- Geometry: generated with chamfered edges (bevel 0.08), cached per die type, instanced draws.
- Shader programs: one per skin feature set, compiled lazily, cached by key. A custom GLSL pattern
  that fails to compile throws `PollyrollShaderError` with the compiler log.
- Context loss: handle `webglcontextlost`/`restored` by rebuilding GPU resources.

## 7. Skins

```ts
interface Skin {
  material: 'plastic' | 'metal' | 'wood' | 'glass' | 'stone' | 'gem' | MaterialParams;
  color: string | [string, string]; // solid or two-tone (pattern blends)
  labelColor: string;
  labelStyle?: 'engraved' | 'printed' | 'embossed'; // default 'engraved'
  pattern?: 'none' | 'gradient' | 'speckle' | 'marble' | 'wood' | 'swirl' | { glsl: string };
  font?: string;
}
type SkinRef = string | Skin; // string = registered preset name
```

- Custom pattern contract: GLSL function `vec3 pattern(vec3 p, vec3 n, vec3 a, vec3 b)` in object
  space returning base color.
- Exported presets (plain objects, tree-shakable): `classic` (white plastic, black labels),
  `obsidian` (black stone), `brass` (metal), `oak` (wood), `sapphire` (glass), `ruby` (gem).
  _(amended)_ Plus `emerald`, `aquamarine`, `smoke` (glass) and `amethyst`, `topaz` (gem).
- _(amended)_ `MaterialParams` = `{ metalness, roughness, clearcoat?, transmission?, tint?, sparkle? }`
  (all 0–1). `transmission > 0` renders see-through; `tint` sets body colour depth; `sparkle` adds
  gem glints. The `glass` and `gem` presets are named values of these (glass 0.8/0.6/0, gem
  0.4/0.9/1), reproducing the original look pixel for pixel.
- `defineSkin(base, overrides)` composes skins; `registerSkin(name, skin)` adds a named preset.
- Out of scope for v1: image textures.

## 8. Source layout

```
src/index.ts                 core entry
src/core/                    rng, notation, roll, evaluate, event (+ tests)
src/geometry/                polyhedra, symmetry, labels (+ tests)
src/physics/                 vec/quat math, body, world, sim, sim.bench.ts (+ tests)
src/skins/                   types, presets, patterns (GLSL strings)
src/render/index.ts          render entry; tray, gl, shaders, atlas, env
src/react/index.ts           react entry
demo/                        Vite playground: notation input, skin picker, two-tray shared-roll demo
e2e/                         Playwright: render smoke, screenshots, cross-browser determinism
```

## 9. Phases

Each phase is one or more task briefs (see [agents/delegation.md](agents/delegation.md)).
All phases ship on one branch and one PR (see § 10).

| #   | Scope                                                                                                                                                                                                                                                                                                                                                        | Exit criteria                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Scaffold: `package.json` (name, exports map, scripts below), tsup config for three entries, Vitest config (coverage thresholds lines 90 / branches 85 / functions 90, excluding `src/render/**`, `src/react/**`, benches), size-limit config with § 1 budgets, Playwright config, husky + lint-staged, CI workflow, `demo/` skeleton, README stub, CHANGELOG | `pnpm verify` passes                                                                                                                 |
| 1   | Core: RNG, parser, `createRoll`, `evaluate`, `redact`, `isRollEvent`                                                                                                                                                                                                                                                                                         | Parser branch coverage 100%; chi-square uniformity test for each die passes; core ≤ 4 KB                                             |
| 2   | Geometry, symmetry groups, physics, settle detection, face read, remap (headless)                                                                                                                                                                                                                                                                            | For every die and every value: remapped up-face equals the value. Golden trajectory hash test passes in Node. 10-dice bench recorded |
| 3   | Renderer: WebGL2 pipeline, instancing, glyph atlas, blob shadows, render-on-demand, fallbacks, context loss                                                                                                                                                                                                                                                  | Playwright smoke renders a roll in Chromium; screenshot baseline committed; render ≤ 30 KB                                           |
| 4   | Skins: six presets, five patterns, custom GLSL pattern, label styles                                                                                                                                                                                                                                                                                         | Screenshot per preset; invalid custom GLSL raises `PollyrollShaderError`                                                             |
| 5   | `pollyroll/react`: `useDiceTray(ref, opts)` and `<DiceTray />` overlay component                                                                                                                                                                                                                                                                             | Mount/unmount disposes exactly once (test); react entry ≤ 1 KB                                                                       |
| 6   | Cross-browser determinism e2e (Chromium, Firefox, WebKit compute the same trajectory hash as Node); demo two-tray shared roll; README usage docs                                                                                                                                                                                                             | Determinism e2e passes in CI on all three browsers                                                                                   |

Required scripts: `build`, `typecheck`, `test`, `test:coverage`, `bench`, `lint`, `lint:fix`,
`format`, `format:check`, `size`, `e2e`, `agent:check` (`node scripts/check-agent-docs.mjs`),
`dev` (demo), `verify` (agent:check, lint, format:check, build, typecheck, test:coverage, size).

CI (`.github/workflows/ci.yml`, triggers on push and PR to `master`): job `verify` on Node 20.19
and 22; job `e2e` installs Chromium, Firefox, and WebKit and runs `pnpm e2e`. WebGL in headless
Chromium uses SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`).

## 10. Delivery

- One branch, one PR to `master` titled `feat: initial pollyroll release (0.1.0)`.
- Commits per task, conventional format, no attribution trailers or AI mentions (AGENTS.md).
- `package.json` version `0.1.0`; CHANGELOG entry for 0.1.0.
- The PR body lists: phase exit criteria with PASS/FAIL and evidence, size-limit output, bench
  result, anything unverified, and the entries in DECISIONS.md.
- Publishing to npm is manual and done by the owner after merge.

## 11. Later work (not in this build)

- RollKeeper migration: replace `useDiceRoller` internals with `createDiceTray` + `createRoll`,
  keep its return shape, map `evaluate()` into RollKeeper's `RollSummary`; remove
  `@3d-dice/dice-box`, `@3d-dice/dice-ui`, `public/assets/{ammo,themes}`, `src/app/dice-test/`,
  `#dice-box` CSS. One PR, no environment feature gate.
- Shared rolls in RollKeeper over the battle-map presence channel (pattern of `pingSync.ts`):
  `sendPresence({ kind: 'dice', event })`, receivers validate with `isRollEvent`, dedupe on `id`,
  call `playRoll`; hidden rolls send `redact(event)` to players. First confirm presence frames are
  not coalesced under rapid sends.
- Notation v2, image-texture skins, real shadow maps, persistent roll log.

## 12. Status (2026-10-06)

### Verified (with evidence, on `master`)

- CI green on Node 20.19 and 22 (`pnpm verify`) and e2e in Chromium, Firefox, WebKit.
- Cross-browser determinism: Chromium, Firefox, and WebKit compute the same trajectory hash as Node.
- Every die × every value shows the rolled value on top after remap (unit tests + property tests).
- Settled dice are flat: 0 of 2,400 single-die rolls end tilted (max 0.4°), measured after the
  settle-to-flat tail; before it, 9.7% of dice rested > 5° off flat.
- Size budgets: core ≈ 3.2 kB / 4, render ≈ 18.8 kB / 30, react ≈ 0.44 kB / 1 (min+gzip).
- 10-dice pre-simulation bench ≈ 3.4–3.5 ms mean (target ≤ 5 ms).
- `redact` leaks no values (null values, explosion dice removed); `isRollEvent` rejects malformed,
  out-of-range, and inline-GLSL input.

### Decided (owner or build decisions; rationale in DECISIONS.md)

- Top-down orthographic camera (replaces 50° perspective); default `dieScale` 2 (owner eye test),
  with auto-fit for large rolls and resting separation (9 dice at scale 2 overlapped in 146/150
  rolls before; 0/150 for 4, 9, and 20 dice after).
- Settle-to-flat tail; warm-started contacts; tray insets in die units.
- Notation aliases `k`/`d`/`x`; keep/drop ranks explosion dice too; `group` indexes dice terms only.
- Custom labels in natural order; presets registered by name (11); custom GLSL local-only;
  glass/gem tunable through `MaterialParams` transmission/tint/sparkle.
- No option to switch camera views; React binding reads options once except `skin`.

### Not verified yet

The full consumer-facing list is in the README under **Known limits**.

- Use as an installed package inside RollKeeper (exports, types, `'use client'` in Next.js).
- 60 fps with 10 dice under Chrome 4× CPU throttle (manual).
- Rendering on real GPUs and mobile (baselines come from SwiftShader).
- Known small issues: d4 and d20 labels are the smallest; during the 0.2 s flatten tail a die that
  is moved or dropped can pass through a neighbour (no collision in the tail); 30-dice rolls still
  overlap in ~3–5% of rolls.
