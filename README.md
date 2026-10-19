# pollyroll

Lightweight 3D dice for the web with zero runtime dependencies. It has a WebGL2 renderer and a
deterministic physics engine, and rolls are result-first, so it works for multiplayer.

**[Live demo](https://iraklidevelop.github.io/pollyroll/)**: notation input, skin editor, and a two-tray shared roll.

- **Result-first.** Values are drawn before any physics runs. The simulation only animates the dice,
  and a symmetry remap turns each settled die so its top face shows the value already chosen.
- **Shared rolls.** A roll is a plain JSON `RollEvent`. Every client that plays the same event shows
  the same values. Clients whose trays have the same shape also see the same motion.
- **Small.** About 3.7 kB for the DOM-free core, about 25 kB for the renderer, physics, geometry,
  and shaders, and about 0.5 kB for the React binding (min+gzip). It ships no asset files: geometry,
  labels, patterns, and lighting are all generated in code.

## Install

```sh
npm install pollyroll
```

`react` (≥ 18) is an optional peer dependency, needed only for `pollyroll/react`.

## Entry points

| Import             | Contents                                                           | Runs in        |
| ------------------ | ------------------------------------------------------------------ | -------------- |
| `pollyroll`        | Notation parser, `createRoll`, `evaluate`, `redact`, `isRollEvent` | Node, browsers |
| `pollyroll/render` | `createDiceTray`, skins and presets                                | Browsers       |
| `pollyroll/react`  | `useDiceTray` hook and `<DiceTray />` overlay                      | React          |
| `pollyroll/format` | `formatRoll(event, summary)`: one-line plain-text result           | Node, browsers |

## Quick start

```ts
import { createRoll } from 'pollyroll';
import { createDiceTray } from 'pollyroll/render';

const tray = createDiceTray(document.getElementById('table')!); // overlay canvas inside the element
const event = createRoll('2d20kh1+5');
const summary = await tray.playRoll(event); // resolves once every die has settled
console.log(summary.total);
```

If the target is an `HTMLElement`, the tray adds a transparent canvas inside it. The canvas is
absolutely positioned and ignores pointer events; an element with `position: static` gets
`position: relative` so the canvas stays inside it. You can also pass an existing `<canvas>`.

## Core (`pollyroll`)

```ts
parse(notation: string): RollAst;            // throws PollyrollSyntaxError { message, index }
createRoll(notation, opts?): RollEvent;      // opts: { rng?, seed?, skin?, rollerId?, audience? }
evaluate(event: RollEvent): RollSummary;     // { total | null, modifier, groups: [{ die, sign, dice, kept, dropped, rerolled, subtotal, success }] }
redact(event: RollEvent): RollEvent;         // copy with every value null and wave ≥ 1 dice removed
isRollEvent(input: unknown): input is RollEvent; // validates untrusted input, including bounds
```

### Notation

Notation is case-insensitive and ignores whitespace.

| Syntax                  | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `NdX`                   | N dice (1–100) of X ∈ 4, 6, 8, 10, 12, 20, 100; N defaults to 1       |
| `d%`, `dF`              | d100; Fudge die (−1, 0, +1)                                           |
| `+`, `-`, integers      | Add or subtract terms and constants                                   |
| `khN` `klN` `dhN` `dlN` | Keep or drop the highest or lowest N (N defaults to 1)                |
| `kN`, `dN`              | `khN`, `dlN` (N defaults to 1)                                        |
| `!`, `x`                | Explode on the maximum, up to 10 extra waves                          |
| `!>=5`, `!6`, `x>8`     | Explode on a comparison (`=`, `<`, `<=`, `>`, `>=`, or a bare number) |
| `r`, `r1`, `r<3`        | Reroll matching dice until they stop matching (default: the minimum)  |
| `ro`, `ro1`, `ro<3`     | Reroll matching dice once                                             |
| `>=7`, `>4`, `<3`, `=6` | Count successes: the term adds the number of kept dice that match     |
| `adv`, `dis`            | `2d20kh1`, `2d20kl1`                                                  |

Limits are at most 20 terms, at most 200 dice before explosions and rerolls, and inputs of at most
256 characters. Examples: `2d20kh1+5`, `4d6dl1`, `4d6r1`, `2d20ro1`, `3d6!`, `d6!>=5`, `5d10>=7+1`,
`4d6kh3>=5`, `adv+3`, `1d%`, `4dF`.

- **Rerolls** keep the replaced die on the table: it is listed in `dropped` and `rerolled`, its
  replacement comes in the next wave, and keep/drop ranks only the dice that were not rerolled.
- **Success counting** applies after keep/drop. A comparison written right after a bare `!` or `r`
  belongs to that modifier (`d6!>=5` explodes on 5+); put the success comparison first
  (`4d6>=5r`) or after an explicit number (`4d6r1>=5`).
- A term cannot both explode and reroll. Compounding (`!!`), crit ranges, and failures (`f`) are not
  supported.

### `RollEvent` (wire format, `v: 1`)

```ts
interface RollEvent {
  v: 1;
  id: string; // crypto.randomUUID(); receivers dedupe on it
  notation: string; // as entered
  dice: Array<{ type: DieType; value: number | null; group: number; wave: number }>;
  modifier: number; // sum of constant terms
  seed: string; // 32 hex chars; derives every throw parameter
  skin?: SkinRef;
  rollerId?: string;
  audience?: 'all' | 'dm' | string[];
  createdAt: number;
}
```

In each summary group, `dice` lists the group's values in event order, and `kept` and `dropped` are
**indexes** into that `dice` array. For example, `2d20kh1` with `[7, 15]` gives
`{ dice: [7, 15], kept: [1], dropped: [0], subtotal: 15 }`. Keep/drop ranks every die of the group,
explosion dice included, and ties go to the lower index.

The event never carries totals or kept/dropped dice; `evaluate(event)` derives them. `group` is the
index of the dice term (constants are not counted). `wave` is 0 for the initial throw and 1 or more
for explosions and rerolls.

## Format (`pollyroll/format`)

```ts
formatRoll(event: RollEvent, summary: RollSummary): string;
```

```ts
import { evaluate } from 'pollyroll';
import { formatRoll } from 'pollyroll/format';

formatRoll(event, evaluate(event));
// 2d20kh1+5 rolling [7, 15]:     '2d20kh1+5: [(7), 15] + 5 = 20'
// 1d20-1d4+2 rolling [12], [4]:  '1d20-1d4+2: [12] - [4] + 2 = 10'
```

Dropped dice are in parentheses and redacted values are `?`. The result is plain text: set it with
`textContent`, not as HTML, since `notation` may come from another client.

## Renderer (`pollyroll/render`)

```ts
const tray = createDiceTray(target, {
  skin: 'classic', // preset name or a Skin object
  labelFont: 'system-ui',
  dieScale: 2, // maximum die size; large rolls shrink to fit
  shadows: true,
  maxDpr: 2,
  reducedMotion: 'auto', // 'auto' follows prefers-reduced-motion; 'always' | 'never'
  fadeAfterMs: null, // number: fade the dice out after they settle
  labels: { d6: ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] }, // optional custom labels per die
  sound: 0, // 0–1: volume of procedural impact clacks; 0 (default) never creates an AudioContext
  announce: false, // true: speak each settled result through a polite aria-live region
});

tray.playRoll(event); // Promise<RollSummary>; a new roll replaces the previous dice
tray.setSkin('obsidian');
tray.setDieScale(1.5); // size for the next roll; dice on screen keep theirs
tray.setSound(0.8); // volume for the next roll; 0 mutes
tray.clear();
tray.resize(); // also called automatically through ResizeObserver
tray.dispose(); // releases every GPU resource and listener
tray.supported; // false when WebGL2 is unavailable
```

Custom labels (`labels`) replace the stock text but keep the value mapping. Each array follows the
die's natural order:

- `d4` to `d20`: `'1'…'N'`.
- `d10`, `d100ones`: digits `'0'…'9'`.
- `d100tens`: `'00'…'90'`.
- `dF`: three entries for −1, blank, and +1.

The label font is the skin's `font` if it has one, otherwise `labelFont`. If the browser can't parse that font, the label falls back to `labelFont`, then `system-ui`.

- **No WebGL2:** `playRoll` resolves immediately with the summary and draws nothing.
- **Reduced motion:** the tray draws the settled dice without animating them and resolves
  immediately.
- **Die size:** `dieScale` (default 2) is the largest size a die is drawn at. A roll with many dice
  shrinks in 0.05 steps until its dice fit the tray and spawn side by side, so a single d20 shows at
  full size while 20d6 stays readable without overlapping. The size sets the walls as well as the drawing, so both sides
  of a shared roll need the same `dieScale` and tray aspect to see identical motion.
- **Dropped dice fade:** dice that `evaluate` lists as dropped are drawn at 35% opacity with their
  shadows, so the kept dice stand out. A rerolled die fades as soon as its replacement is thrown;
  keep/drop drops fade once the roll settles, since later waves can change the ranking.
- **Sound:** with `sound` above 0 the tray plays a short procedural clack for each hard impact,
  derived from the dice tracks (no audio files). Browsers start audio only after a user gesture, so a
  roll that does not start from a click may stay silent.
- **Accessibility:** the canvas has `role="img"` and, once a roll settles, an `aria-label` with the
  result from `formatRoll` ("Dice tray" while a roll animates or the tray is empty). On a canvas
  you pass in, these replace its own `role` and `aria-label`, and `announce` inserts the live
  region right after it.
- **Superseded rolls:** if a roll is replaced, cleared, or disposed, its promise still resolves with
  that roll's own summary. It never rejects in these cases.
- **Dice limit:** at most 30 dice are animated per tray (a d100 counts as two). Dice beyond that
  still count in the summary.
- **Device pixel ratio:** capped at `maxDpr`. The frame loop stops once the dice settle, so an idle
  tray costs nothing.

### Skins

```ts
import {
  classic,
  obsidian,
  brass,
  oak,
  sapphire,
  ruby,
  emerald,
  amethyst,
  topaz,
  aquamarine,
  smoke,
  defineSkin,
  registerSkin,
} from 'pollyroll/render';

registerSkin('table-red', defineSkin('ruby', { labelColor: '#fff' }));
tray.setSkin('table-red');

tray.setSkin({
  material: 'plastic', // 'plastic' | 'metal' | 'wood' | 'glass' | 'stone' | 'gem' | MaterialParams
  color: ['#204080', '#a0c0ff'], // solid or two-tone
  labelColor: '#ffffff',
  labelStyle: 'engraved', // 'engraved' | 'printed' | 'embossed'
  pattern: 'marble', // 'none' | 'gradient' | 'speckle' | 'marble' | 'wood' | 'swirl' | { glsl }
});
```

A custom pattern is a GLSL ES 3.00 function, `vec3 pattern(vec3 p, vec3 n, vec3 a, vec3 b)`, that
works in object space and returns the base color. If it fails to compile, `setSkin` throws
`PollyrollShaderError`, and its `log` holds the compiler output. For safety, `isRollEvent` rejects
events whose inline skin carries custom GLSL. Register custom-pattern skins locally and send only
their names.

Presets: `classic`, `obsidian`, `brass`, `oak`, `sapphire` (glass), `ruby` (gem), `emerald`
(glass), `amethyst` (gem), `topaz` (gem), `aquamarine` (clear glass), and `smoke` (smoky glass).

`MaterialParams` takes `metalness`, `roughness`, and optional `clearcoat`, `transmission`, `tint`,
and `sparkle`, all in [0, 1]. `transmission` above 0 makes the die see-through (higher is clearer),
`tint` sets how deep the body colour gets along the view path, and `sparkle` adds gem glints.
`'glass'` is `transmission: 0.8, tint: 0.6`; `'gem'` is `transmission: 0.4, tint: 0.9, sparkle: 1`.
`materialPresets` (from `pollyroll/render`) gives the full params of every named material, a
starting point for custom ones: `{ ...materialPresets.glass, tint: 0.3 }`.

```ts
tray.setSkin({
  material: {
    metalness: 0,
    roughness: 0.06,
    clearcoat: 1,
    transmission: 0.7,
    tint: 0.8,
    sparkle: 0.5,
  },
  color: ['#0b5d3b', '#18a86b'],
  labelColor: '#ffffff',
  labelStyle: 'printed',
});
```

## React (`pollyroll/react`)

```tsx
import { useRef } from 'react';
import { createRoll } from 'pollyroll';
import { DiceTray } from 'pollyroll/react';
import type { DiceTray as Tray } from 'pollyroll/render';

function Table() {
  const tray = useRef<Tray | null>(null);
  return (
    <div style={{ position: 'relative', height: 480 }}>
      <DiceTray trayRef={tray} skin="oak" />
      <button onClick={() => tray.current?.playRoll(createRoll('1d20'))}>Roll</button>
    </div>
  );
}
```

`useDiceTray(target, opts)` creates a tray on the target element after mount and disposes it exactly
once on unmount, including under StrictMode. `target` is a ref or an element; pass the element
itself (for example from a callback ref kept in state) when it mounts later than the component.
Options are read when the tray is created, except `skin` (compared by value), `dieScale`, and
`sound`, which update the tray when they change.

## Multiplayer

The library never touches the network. Send the event over whatever channel you already have:

```ts
// roller
const event = createRoll('1d20+4', { rollerId: me.id });
// redact() nulls every value and drops explosion and reroll dice, so a hidden roll reveals nothing
tray.playRoll(event);
channel.send({ kind: 'dice', event: hidden ? redact(event) : event });

// receivers
channel.on('dice', ({ event }) => {
  if (!isRollEvent(event) || seen.has(event.id)) return;
  seen.add(event.id);
  tray.playRoll(event); // redacted: blank labels, total null, wave ≥ 1 dice removed
});
```

The throw is derived from `seed`, so receivers replay the same tumble. The values come from the
event, so every receiver shows the same result. Motion matches exactly when both trays have the
same quantized aspect ratio and `dieScale`.

## Determinism

The physics step uses only `+ − * /` and `Math.sqrt`, with a fixed 1/120 s step and fixed iteration
order. The geometry and the tray bounds use algebraic constants instead of trigonometry. CI checks
that Chromium, Firefox, and WebKit compute the same trajectory hash as Node.

## Known limits

These describe 0.4.0. Each one is a deliberate trade-off or a measured edge case, not a
hidden bug.

**Physics and layout**

- **Dice collide by their hulls, with face contacts only.** Die-to-die contacts use the real shapes
  (face-normal separating axis test with clipped face contacts). Edge-to-edge hits get a single
  approximate contact, so a die can glance off at a slightly wrong angle, and an impact can overlap
  a neighbour for one 1/120 s step (usually under 0.1 die units, at most about 0.3).
- **The final settle is animated, not simulated.** For the last 0.3 s, dice still tilted against a
  wall or a neighbour topple flat and dice that ended too close slide apart. Dice no longer end on
  top of each other (a roll that does is simulated again), so the lift over a neighbour is rare;
  when it happens a die can still clip that neighbour for about 0.1 s (1 to 7 of 40 crowded rolls
  in 0.2.0).
- **Large rolls get smaller dice.** Auto-fit shrinks a roll until its dice fit the tray (5 square
  die-units per die) and every die spawns side by side, so rolls of 4 or more dice are drawn
  smaller than `dieScale`. With many dice in a small canvas the dice get small, down to a floor of
  0.5 × `dieScale`. Dice beyond 30 animated bodies are counted in the summary but not shown; a d100
  counts as two bodies.
- **Crowded rolls can take longer.** About 2 in 1,200 crowded rolls (20–30 dice) jitter in a pile
  until the 6 s step cap before the settle tail flattens them.
- **Motion matches only between same-shape trays.** Two clients see identical motion when their
  trays have the same aspect ratio and the same `dieScale`. The values always match, because the
  remap runs on each client.
- **Explosion and reroll waves add time.** Each wave is thrown after the previous one settles, so
  long chains (up to 10 waves) take several seconds.
- **The simulation runs before the first frame.** `playRoll` simulates the whole roll on the main
  thread first: about 5 ms for 10 dice and 15 ms for 30 dice on a desktop CPU, several times that on
  slow phones.

**Rendering**

- **Camera:** the camera looks straight down (orthographic). There is no option for an angled view,
  and dice in the air do not grow as they approach; the shadow offset carries the height cue.
- **Small labels:** d4 corner labels are still the smallest text. Raise `dieScale` if they are hard
  to read.
- **No images:** there are no image textures, and lighting is analytic.
- **Shadows:** these are soft blobs, not shadow maps.
- **What has been tested:** screenshot baselines come from SwiftShader in headless Chromium. 60 fps
  was measured on a desktop GPU (also under 4× CPU throttling); mobile GPUs have not been measured.
- **WebGL2 is required:** without it, `playRoll` resolves with the summary and draws nothing.

**Notation and wire format**

- **Not supported:** compounding explosions (`!!`), crit ranges, failures (`f`), parentheses, `*`
  and `/`, and dice other than d4, d6, d8, d10, d12, d20, d100 and dF.
- **Older receivers:** aliases (`kN`, `dN`, `x`, added in 0.1.0) and the 0.2.0 notation (rerolls,
  explode thresholds, success counting) are rejected by `isRollEvent` in builds that predate them.
  Upgrade every client before sending them.
- **Custom GLSL stays local:** `isRollEvent` rejects inline custom GLSL, so share custom-pattern
  skins by registered name.

## Development

```sh
pnpm install
pnpm dev        # demo playground
pnpm verify     # lint, format, build, typecheck, tests with coverage, size budgets
pnpm e2e        # Playwright (Chromium, Firefox, WebKit)
pnpm bench      # physics benchmark
```

The build specification is in [docs/PLAN.md](docs/PLAN.md) and the decision log in
[docs/DECISIONS.md](docs/DECISIONS.md).

## License

MIT
