# pollyroll

Lightweight 3D dice for the web with zero runtime dependencies. It has a WebGL2 renderer and a
deterministic physics engine, and rolls are result-first, so it works for multiplayer.

- **Result-first.** Values are drawn before any physics runs. The simulation only animates the dice,
  and a symmetry remap turns each settled die so its top face shows the value already chosen.
- **Shared rolls.** A roll is a plain JSON `RollEvent`. Every client that plays the same event shows
  the same values. Clients whose trays have the same shape also see the same motion.
- **Small.** About 3 kB for the DOM-free core, about 18.4 kB for the renderer, physics, geometry, and
  shaders, and under 1 kB for the React binding (min+gzip). It ships no asset files: geometry,
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
absolutely positioned and ignores pointer events, so give the element `position: relative` (or any
positioning). You can also pass an existing `<canvas>`.

## Core (`pollyroll`)

```ts
parse(notation: string): RollAst;            // throws PollyrollSyntaxError { message, index }
createRoll(notation, opts?): RollEvent;      // opts: { rng?, seed?, skin?, rollerId?, audience? }
evaluate(event: RollEvent): RollSummary;     // { total | null, modifier, groups: [{ die, dice, kept, dropped, subtotal }] }
redact(event: RollEvent): RollEvent;         // copy with every value set to null
isRollEvent(input: unknown): input is RollEvent; // validates untrusted input, including bounds
```

### Notation

Notation is case-insensitive and ignores whitespace.

| Syntax                  | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `NdX`                   | N dice (1–100) of X ∈ 4, 6, 8, 10, 12, 20, 100; N defaults to 1 |
| `d%`, `dF`              | d100; Fudge die (−1, 0, +1)                                     |
| `+`, `-`, integers      | Add or subtract terms and constants                             |
| `khN` `klN` `dhN` `dlN` | Keep or drop the highest or lowest N (N defaults to 1)          |
| `!`                     | Explode on the maximum, up to 10 extra waves                    |
| `adv`, `dis`            | `2d20kh1`, `2d20kl1`                                            |

Limits are at most 20 terms, at most 200 dice before explosions, and inputs of at most 256
characters. Examples: `2d20kh1+5`, `4d6dl1`, `3d6!`, `adv+3`, `1d%`, `4dF`.

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
for explosions.

## Renderer (`pollyroll/render`)

```ts
const tray = createDiceTray(target, {
  skin: 'classic', // preset name or a Skin object
  labelFont: 'system-ui',
  dieScale: 1,
  shadows: true,
  maxDpr: 2,
  reducedMotion: 'auto', // 'auto' follows prefers-reduced-motion; 'always' | 'never'
  fadeAfterMs: null, // number: fade the dice out after they settle
  labels: { d6: ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] }, // optional custom labels per die
});

tray.playRoll(event); // Promise<RollSummary>; a new roll replaces the previous dice
tray.setSkin('obsidian');
tray.setDieScale(1.5); // size for the next roll; dice on screen keep theirs
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
- **Die size:** `dieScale` sets the walls as well as the drawing, so both sides of a shared roll
  need the same `dieScale` (and tray aspect) to see identical motion.
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
  defineSkin,
  registerSkin,
} from 'pollyroll/render';

registerSkin('table-red', defineSkin('ruby', { labelColor: '#fff' }));
tray.setSkin('table-red');

tray.setSkin({
  material: 'plastic', // 'plastic' | 'metal' | 'wood' | 'glass' | 'stone' | 'gem' | { metalness, roughness, clearcoat? }
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

`useDiceTray(ref, opts)` creates a tray on `ref.current` after mount and disposes it exactly once on
unmount, including under StrictMode. Options are read when the tray is created. Only `skin` updates
afterwards, and object skins are compared by value.

## Multiplayer

The library never touches the network. Send the event over whatever channel you already have:

```ts
// roller
const event = createRoll('1d20+4', { rollerId: me.id });
// redact() nulls every value and drops explosion dice, so a hidden roll reveals nothing
tray.playRoll(event);
channel.send({ kind: 'dice', event: hidden ? redact(event) : event });

// receivers
channel.on('dice', ({ event }) => {
  if (!isRollEvent(event) || seen.has(event.id)) return;
  seen.add(event.id);
  tray.playRoll(event); // redacted: blank labels, total null, explosion dice removed
});
```

The throw is derived from `seed`, so receivers replay the same tumble. The values come from the
event, so every receiver shows the same result. Motion matches exactly when both trays have the
same quantized aspect ratio and `dieScale`.

## Determinism

The physics step uses only `+ − * /` and `Math.sqrt`, with a fixed 1/120 s step and fixed iteration
order. The geometry and the tray bounds use algebraic constants instead of trigonometry. CI checks
that Chromium, Firefox, and WebKit compute the same trajectory hash as Node.

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
