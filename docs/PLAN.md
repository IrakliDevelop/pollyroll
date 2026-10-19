# Pollyroll build plan

Approved specification for the initial build. Decisions here are fixed; an agent that finds a
genuine gap records its choice in [DECISIONS.md](DECISIONS.md) and continues (see
[agents/delegation.md](agents/delegation.md) § Autonomous run).

> **Amended 2026-10-06 by the owner after the 0.1.0 build, 2026-10-19 for 0.2.0, 2026-10-19 for 0.3.0, 2026-10-19 for 0.4.0, 2026-10-19 for 0.5.0, and 2026-10-19 for 0.6.0.** Sections below describe the shipped
> behavior; lines marked _(amended)_ replace the original text, and the reason for each is in
> [DECISIONS.md](DECISIONS.md). § 12 separates what is verified from what was decided and what is
> still unverified.

Goal: a lightweight, customizable 3D dice library to replace `@3d-dice/dice-box` in RollKeeper,
built for shared (multiplayer) rolls from day one. Independent of Fieldnotes and RollKeeper.

- Repo: `IrakliDevelop/pollyroll`, default branch `master` · npm: `pollyroll` (unscoped) · MIT
- Zero runtime dependencies. Zero asset files _(amended, 0.5.0: except the opt-in `pollyroll/sounds`
  entry, which embeds recorded CC0 clacks as base64 data in code)_.

## 1. Fixed decisions

| Area      | Decision                                                                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering | Custom **WebGL2** renderer. No three.js, Babylon, OGL, or other engine.                                                                                                                                                                                                                                              |
| Physics   | Custom fixed-step rigid-body solver in TypeScript. No rapier, cannon, or ammo.                                                                                                                                                                                                                                       |
| Outcome   | **Result-first.** Values are chosen by RNG before simulation; physics only animates.                                                                                                                                                                                                                                 |
| Remap     | Simulate headless, read the settled up-face, then post-multiply the die's orientation for the whole trajectory by a **rotation symmetry** of its polyhedron that moves the chosen value's face to the settled up-face. Geometry is invariant, so the motion is unchanged and the real-die label layout is preserved. |
| Assets    | None. Geometry generated in code; labels from a runtime Canvas2D glyph atlas; patterns procedural in GLSL; environment lighting analytic. _(amended, 0.5.0)_ `pollyroll/sounds` embeds 7 CC0 clacks (Kenney) as one base64 MP3; _(amended, 0.6.0)_ and 8 CC0 coin clinks (Kenney) as a second.                       |
| Transport | The library never touches the network. It creates and plays plain `RollEvent` objects.                                                                                                                                                                                                                               |
| Fallback  | No WebGL2, or reduced motion → `playRoll` resolves immediately with the summary, no animation.                                                                                                                                                                                                                       |
| Package   | Single package at the repo root with subpath exports: `pollyroll` (core, DOM-free), `pollyroll/render`, `pollyroll/react`; _(amended, 0.3.0)_ `pollyroll/format` (DOM-free); _(amended, 0.5.0)_ `pollyroll/sounds` (opt-in clack data).                                                                              |
| Tooling   | pnpm 10, Node ≥ 20.19, TypeScript strict (`tsconfig.base.json`), tsup (ESM + CJS + DTS), Vitest, Playwright, size-limit (`@size-limit/preset-small-lib`), fast-check (property tests), ESLint + Prettier (configs at repo root), husky + lint-staged.                                                                |

### Budgets (min+gzip, hard limits in `size-limit`)

| Entry                                                                       | Limit   |
| --------------------------------------------------------------------------- | ------- |
| `pollyroll` (core)                                                          | 4 KB    |
| `pollyroll/render` (renderer + physics + geometry + shaders + skin presets) | 30 KB   |
| `pollyroll/react` (excluding react)                                         | 1 KB    |
| `pollyroll/format` _(amended, 0.3.0)_                                       | 0.5 KB  |
| `pollyroll/sounds` `diceClacks` _(amended, 0.5.0; per export, 0.6.0)_       | 1.5 KB  |
| `pollyroll/sounds` `coinClinks` _(amended, 0.6.0)_                          | 0.75 KB |

Baseline being replaced: dice-box JS plus 2.1 MB of `public/assets` (ammo.js + themes).

### Performance targets

- Headless pre-simulation of 10 dice to settle: ≤ 5 ms. Measured with `vitest bench`
  (`src/physics/sim.bench.ts`); recorded in the PR, not gated in CI.
- 60 fps with 10 dice under Chrome 4× CPU throttle (manual check in the demo; record result).
- One instanced draw call per die type plus one shadow pass. Device pixel ratio capped at 2.
- Render-on-demand: the frame loop stops once every die has settled. Idle cost is zero.
- _(amended, 0.4.0)_ Playback: the 120 Hz track plays at 1.5× real time from the first drawn
  frame (≈ 2.25× gravity along the same paths); impact sounds use the same clock.
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
| `d2`   | 2       | 1–2       | _(amended, 0.6.0)_ coin geometry labeled `1`, `2`                                                  |
| `dc`   | 2       | 0, 1      | _(amended, 0.6.0)_ coin: 0 = tails `T`, 1 = heads `H` (Foundry VTT's `dc`)                         |

- `6` and `9` carry an underline on d10, d12, d20, and the d100 ones die.
- Rotation groups (transitive on faces, so every value is reachable): d4 T (12), d6 and d8 O (24),
  d10 D5 (10), d12 and d20 I (60). Groups are computed at module init from vertex sets and cached;
  tests assert group order and transitivity.
- Custom label arrays per die type are supported (same geometry, user labels, same value mapping).
  _(amended)_ `TrayOptions.labels[set][i]` follows the die's natural sequence (d4–d20 value − 1,
  d10/d100 digit, d100 tens digit, dF −/blank/+).

## 3. `RollEvent` (wire contract, v1)

```ts
type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100' | 'dF' | 'd2' | 'dc'; // d2, dc: amended, 0.6.0

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
  _(amended, 0.2.0: and reroll)_ die (wave ≥ 1) removed, so a hidden roll does not reveal a maximum. Playing a redacted event animates
  dice with blank labels and resolves with `total: null`.

## 4. Core API (`pollyroll`)

```ts
parse(notation: string): RollAst;                 // throws PollyrollSyntaxError { message, index }
createRoll(notation: string, opts?: {
  rng?: (maxExclusive: number) => number;         // default: crypto.getRandomValues + rejection sampling
  seed?: string; skin?: SkinRef; rollerId?: string; audience?: RollEvent['audience'];
}): RollEvent;
evaluate(event: RollEvent): RollSummary;          // { total | null, modifier, groups: [{ die, sign, dice, kept, dropped, rerolled, subtotal, success }] } (amended, 0.3.0)
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
- _(amended, 0.2.0)_ Notation v2: `r`/`ro` reroll (optional comparison, default `=` minimum; `r`
  repeats up to the wave cap, `ro` once), `!`/`x` take an optional comparison (`!>=5`, `!6`), and a
  comparison with an explicit operator counts successes among kept dice (`5d10>=7`). Rerolls reuse
  later waves; replaced dice are listed in `dropped`. `RollEvent` stays v1; the `DiceTerm` AST type
  changes (`explode: Compare | null`, new `reroll`, `success`).
- _(amended, 0.6.0)_ `d2` (X = 2) and `dc` (coin) join the die sizes; every modifier applies to them
  (`3dc=1` counts heads). `RollEvent` stays v1: the `type` enum widens, so a receiver on 0.5.0 or
  older rejects an event with a coin in `isRollEvent` (fails closed).
- Out of scope: compounding, crit ranges, failures, a coin "call" modifier.

## 5. Physics (`src/physics/`, internal, DOM-free)

- Units: d6 edge length = 1. Gravity −30 units/s². Fixed step 1/120 s; hard stop at 720 steps.
- Bodies: convex polyhedra with mass 1 and the inertia tensor of a solid of the die's shape.
- Contacts: hull vertices against floor and four wall planes (exact); _(amended, 0.2.0)_ die against
  die by hull: bounding spheres as broad phase, face-normal SAT, reference-face clipping (up to 4
  points, one normal), feature-keyed warm starts, 0.01 speculative margin; edge–edge pairs get one
  fallback contact. Sequential impulses with restitution 0.35, friction 0.6, linear and angular damping.
  _(amended, 0.4.0)_ Friction 0.6 against the floor, 0.1 against walls and between dice.
  _(amended)_ Contacts are warm-started from the previous step's impulses.
- Settle: every body below 0.05 units/s linear and 0.1 rad/s angular speed for 24 consecutive steps.
- _(amended, 0.6.0)_ Coin: physics hull a 16-sided prism, circumradius 0.65, thickness 0.2
  (vertices from half-angle square roots, no trigonometry); readouts are the two caps only; hull
  buffers hold 32 vertices, 48 edges, 16 edges per face. Coins may have their own damping and
  settle rule (keyed by shape, dice unchanged) so they visibly wobble flat; a scripted wobble tail
  is the fallback if the simulated wobble is too short. Design: [designs/coin.md](designs/coin.md).
- Determinism rule from AGENTS.md: only `+ - * /` and `Math.sqrt` in the step; quaternion
  integration with a first-order update and explicit renormalization.
- Tray: floor at y = 0; walls at the visible floor bounds (from canvas aspect and the fixed camera)
  minus a margin. Throw origin, direction, speed, and spin come from the seed RNG. _(amended, 0.2.0)_
  Dice spawn in an axis-aligned block (spacing 2·Rmax + 0.5, extra dice in higher layers) so no two
  start overlapping; throw speed 5–8 units/s. _(amended, 0.4.0)_ The block fills the tray width
  before adding a row and adds a layer only when the floor grid is full.
- Waves: each explosion wave is thrown after the previous wave settles; earlier dice stay as bodies.
  _(amended, 0.4.0)_ A later wave's block is centred on the grid point (9 × 5 over the tray)
  farthest from the resting dice and thrown at 0.4× speed, so it lands on free floor.
- _(amended, 0.4.0)_ Re-simulation: a roll whose dice settle with any lowest hull point more than
  0.1 die units above the floor is simulated again from scratch, continuing the same seed stream,
  up to 4 attempts; the last attempt is kept. Values are already chosen, so this cannot bias them.
- Output: per die, a keyframe track (position + quaternion per step) plus the settled up-face.
- _(amended)_ Settle-to-flat: after settling, any die more than 0.5° off flat gets a deterministic
  _(amended, 0.2.0)_ 36-step tail that rolls it onto its up face and rests it on the floor (dice can
  come to rest cocked against walls, neighbours, or balanced on an edge): slide and flatten without
  lowering the die's bottom, then drop; a die whose tail would pass through a neighbour lifts above
  it first (rise ≤ 1.5 die units). _(amended, 0.4.0)_ Tail timing follows gravity: a turn accelerates
  (t²) and, when the die rests on the floor and is not lifted, rocks 6% past flat once; a slide alone
  eases in and out, rises ease in and out, drops fall freely.
  Before the tails, resting dice are pushed apart by their exact
  horizontal footprints (SAT, 0.05 gap, up to 64 passes, clamped to the walls).
- _(amended)_ Auto-fit: a roll uses the largest scale ≤ `dieScale` on a 0.05 grid whose tray area
  holds 5 die-units² per animated body, so large rolls shrink instead of overlapping.
  _(amended, 0.4.0)_ The scale must also let the spawn grid hold every animated body in one layer.

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
  sound?: number;                                           // (amended, 0.2.0) clack volume 0–1, default 0
  announce?: boolean;                                       // (amended, 0.3.0) polite live region; default false
  clacks?: ClackSet;                                        // (amended, 0.5.0) recorded clacks, e.g. diceClacks from pollyroll/sounds
  coinClinks?: ClackSet;                                    // (amended, 0.6.0) recorded clinks layered on the coin synth, e.g. coinClinks
}

interface DiceTray {
  playRoll(event: RollEvent): Promise<RollSummary>;         // pre-sim → remap → animate → settle
  setSkin(skin: SkinRef): void;
  setDieScale(scale: number): void;                         // (amended) applies to the next roll
  setSound(volume: number): void;                           // (amended, 0.2.0) applies to the next roll
  clear(): void; resize(): void; dispose(): void;
  readonly supported: boolean;                              // false when WebGL2 is unavailable
}
```

- A new `playRoll` replaces the dice of the previous roll. _(amended, 0.2.0)_ Once settled, dropped
  dice draw at 35% opacity; _(amended, 0.3.0)_ a rerolled die drops to 35% when its replacement
  wave is thrown. An unpositioned host element gets `position: relative`.
- An `HTMLElement` target gets an absolutely positioned, transparent, pointer-events-none canvas.
- _(amended, 0.6.0)_ Coins sound like a coin on a wooden table, not a dice clack: a modal synth
  (ring modes rolled off by contact time, table modes at 0.6–2.4 kHz), with a short recorded clink
  layered on each landing and bounce when `coinClinks` is given, and a rattle from the rim
  contacts of a wobbling coin. Research: [research/sound.md](research/sound.md).
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
src/format/index.ts          format entry (amended, 0.3.0): formatRoll, type-only imports
src/sounds/index.ts          sounds entry (amended, 0.5.0): diceClacks (0.6.0: and coinClinks) data, type-only imports
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

## 12. Status (2026-10-19, 0.5.0 branch)

### Verified (with evidence)

- 0.1.0 on `master`: CI green on Node 20.19 and 22 and e2e in Chromium, Firefox, WebKit.
- 0.2.0 on `master` and npm (2026-10-19); 0.3.0 and 0.4.0 on `master`. 0.5.0 branch, locally: `pnpm verify`
  passes; e2e passes in Chromium and Firefox, including the cross-browser determinism hash. WebKit could not launch on the build machine (missing system
  libraries); CI runs it.
- Every die × every value shows the rolled value on top after remap (unit tests + property tests).
- Settled dice are flat (0.5° rule, tested over 1,200 single-die and 100 mixed rolls).
- No die rests on another at settle (lowest hull point > 0.1 above the floor before the tail):
  1,000 seeds × 9 roll types (2d20 to 20 mixed dice, rerolls) in fitted 608×360 trays, 0 of 9,000
  (0.3.0: 18–66% of 3+ dice rolls), about 1 extra simulation per 1,000 rolls; camera.test.ts asserts
  0 of 750. Dice needing a visible tail (> 3° or > 0.1 move): d6 rolls 1–2% (0.3.0: 18–40%), mixed
  rolls 10–17% (0.3.0: 45–55%), 2d20 at full size 17% (unchanged, d20s leaning on walls).
- No settled overlap (measured in 0.2.0): exact hull test, 60 seeds × 6 crowded roll types in fitted 608×360 trays,
  0% of rolls end with two dice interpenetrating more than 0.02 die units (0.1.0: 25–33% of mixed
  d20/d12/d8 rolls). During the roll (before the settle tail), 40 seeds × 4 crowded roll types:
  penetration never exceeds 0.3 die units and stays above 0.1 for at most one 1/120 s step.
- Size budgets: core ≈ 3.77 kB / 4, render ≈ 26.4 kB / 30, react ≈ 0.50 kB / 1, format ≈ 0.34 kB /
  0.5, sounds ≈ 1.27 kB / 1.5 (min+gzip).
- 10-dice pre-simulation bench ≈ 4.8 ms mean (seed 0; target ≤ 5 ms; noisy machine, runs up to
  6 ms on both base and branch).
- 60 fps during animation with 10, 18 and 30 dice at 1× and 4× Chrome CPU throttle on a desktop
  GPU (NVIDIA RTX 4060 Laptop, ANGLE GL; p95 ≤ 17.1 ms), measured in 0.2.0; not re-run at 1.5×
  playback (same frames drawn per second, fewer per roll).
- `redact` leaks no values (null values, explosion and reroll dice removed); `isRollEvent` rejects
  malformed, out-of-range, and inline-GLSL input, and accepts every event `createRoll` builds.
- `pollyroll/sounds` MP3 decodes in Chromium and Firefox (0.43 s); `dist/render.*` holds none of
  its data and `dist/sounds.*` no render code.
- Packed tarball: ESM and CJS import of every entry in Node; types resolve under node10
  (`typesVersions`), node16, nodenext and bundler; `'use client'` heads `dist/react.*`.

### Decided (owner or build decisions; rationale in DECISIONS.md)

- Top-down orthographic camera; default `dieScale` 2 with auto-fit; tray insets in die units.
- Hull-against-hull die contacts; footprint separation; two-phase, collision-aware settle tail.
- Overlap-free spawn block; gentler throws (5–8 units/s); d4 circumradius 0.95, d20 0.85.
- 0.4.0: one-layer spawn and auto-fit, later waves on free floor, re-simulation of stacked rolls
  (≤ 4 attempts), wall/die friction 0.1, gravity-timed settle tail, 1.5× playback.
- Notation aliases `k`/`d`/`x` and notation v2 (rerolls, explode thresholds, success counting);
  keep/drop ranks explosion dice too; `group` indexes dice terms only.
- Dropped dice fade after settle; opt-in procedural sound; reactive React `dieScale`/`sound`.
- Custom labels in natural order; presets registered by name (11); custom GLSL local-only;
  glass/gem tunable through `MaterialParams` transmission/tint/sparkle.

### Not verified yet

The full consumer-facing list is in the README under **Known limits**.

- Use as an installed package inside RollKeeper (Next.js app).
- Mobile GPUs; WebKit locally (CI covers WebKit determinism and decoding of the `pollyroll/sounds`
  MP3). Listening to the recorded clacks in Safari.
- Known small issues (counts measured in 0.2.0, not re-measured): in 1–7 of 40 crowded rolls a die
  lifting off a pile clips a neighbour for about 0.1 s during the settle tail (lifts are now rare);
  about 2 of 1,200 crowded rolls reach the 720-step cap (0 of 9,000 in the 0.4.0 runs above); the
  pre-simulation runs on the main thread before the first frame (≈ 15 ms for 30 dice on a desktop,
  times the attempts in the rare re-simulated roll).
- d20s at full size rest tilted against walls in about 17% of dice and are toppled by the tail.
