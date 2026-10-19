# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-10-19

### Added

- Coins: `dc` (0 tails, 1 heads, labelled `T`/`H`, as in Foundry VTT) and `d2` (1 or 2), with
  every modifier (`3dc=1` counts heads, `4dc kh2`, `d2!`). A coin is a round disc that is tossed
  (launched upward, flipping end over end), lands near where it was thrown, wobbles flat and shows
  the chosen face. `RollEvent` stays `v: 1`; receivers on 0.5.0 or older reject rolls with coins. Coins make no sound yet; dice sound as before.
- Demo: `dc`, `3dc=1` and `2d2` examples, and a coin row in the notation key.
- Docs: sound research for dice and coins, with a rebuildable listening lab
  (`docs/research/`), and the coin design (`docs/designs/coin.md`). A coin sound was built and
  measured but not shipped; the research records why and where the code is.

### Changed

- Physics buffers hold hulls of up to 32 vertices and 16-edge faces; slot tables grow with the
  bodies in a roll. Dice-only rolls move exactly as in 0.5.0.

## [0.5.0] - 2026-10-19

### Added

- `pollyroll/sounds` (opt-in entry, about 1.3 kB): `diceClacks`, seven real dice clacks cut from
  Kenney's CC0 Casino Audio, low-passed at 8 kHz and embedded as one 16 kHz MP3.
- `pollyroll/render`: `TrayOptions.clacks` plays one recorded clack per physics impact (rotating
  clacks, slight pitch variation, volume from impact strength) and falls back to the procedural
  sound if the clip cannot be decoded. An invalid clack set throws `RangeError` when the tray is
  created. The demo uses it.
- Demo: a notation key under the examples lists every modifier with a one-click example.

## [0.4.0] - 2026-10-19

### Changed

- Physics: dice no longer come to rest on top of each other. Measured over 1,000 rolls per roll
  type, 18–66% of 3+ dice rolls used to end with a die on another, which then hopped off in the
  settle tail; now none in 11,000 rolls.
  - The spawn block fills the tray width before it stacks dice in a second layer, and auto-fit
    picks a die size where every die spawns side by side. Rolls of 4 or more dice get somewhat
    smaller dice (4d6 at the default size: 1.75 instead of 2).
  - Reroll and explosion waves are thrown gently onto the free floor farthest from resting dice.
  - A roll that still ends with a die resting on another is simulated again from the same seed
    stream (up to 4 attempts; about 1 extra simulation per 100 rolls). Values are chosen before the
    simulation, so this cannot bias results.
- Physics: friction is 0.1 against walls and between dice (0.6 on the floor), so dice slide off
  walls and neighbours instead of resting cocked against them.
- The settle tail moves like a falling die: the turn speeds up, rocks once just past flat, and the
  drop falls freely, instead of turning at constant speed.
- `pollyroll/render`: rolls play 1.5× faster (dice feel heavier; the simulation is unchanged), the
  clock starts at the first drawn frame, and impact sounds follow the same clock. Impacts in the last
  0.3 s of a roll without a settle tail are no longer dropped. A roll received in a hidden tab
  settles at once instead of replaying when the tab returns.
- The same `RollEvent` animates differently than in 0.3.0 (values are identical), so clients of a
  shared roll should run the same minor version to see the same motion.

## [0.3.0] - 2026-10-19

### Added

- `pollyroll/format`: `formatRoll(event, summary)` returns a one-line plain-text result, for
  example `2d20kh1+5: [(7), 15] + 5 = 20` (dropped dice in parentheses, redacted values as `?`).
  DOM-free, about 0.3 kB.
- Roll summaries: every group carries `sign` (1 or −1) and `success` (the success comparison, or
  `null`), so apps no longer re-parse the notation to describe a roll, and `rerolled` (the dice
  replaced by a reroll, a subset of `dropped`). `RollEvent` is unchanged.
- `pollyroll/render`: the tray canvas has `role="img"` and an `aria-label` with the settled result
  ("Dice tray" while a roll animates or the tray is empty). `TrayOptions.announce` (default
  `false`) also speaks each result through a polite live region.
- A live demo on GitHub Pages, linked from the README.

### Changed

- `pollyroll/render`: a rerolled die fades to 35% as soon as its replacement is thrown, instead of
  when the whole roll settles, so a reroll no longer looks like extra dice appearing. Keep/drop
  drops still fade at settle.
- The demo results line reads success counts from the summary instead of re-parsing notation,
  and lists rerolled dice as `rerolled [..]`.

## [0.2.0] - 2026-10-19

### Added

- Notation: rerolls (`r`, `r1`, `r<3`) and reroll once (`ro`), explode thresholds (`!>=5`, `x>8`,
  `!6`), and success counting (`5d10>=7`, `4d6kh3>=5`). Rerolled dice stay on the table, are
  listed in `dropped`, and their replacements arrive in later waves; `RollEvent` stays v1.
- `pollyroll/render`: dropped and rerolled dice fade to 35% opacity once a roll settles.
- `pollyroll/render`: opt-in procedural impact sounds (`TrayOptions.sound`, `DiceTray.setSound`),
  generated from the dice tracks with WebAudio; no AudioContext is created while the volume is 0.
- `pollyroll/react`: `dieScale` and `sound` update the tray when they change; `useDiceTray` accepts
  an element as well as a ref.
- `typesVersions` so TypeScript `moduleResolution: node` resolves `pollyroll/render` and
  `pollyroll/react` types.
- Demo: notation example buttons, a sound toggle, and success counts in the results line.

### Changed

- **Breaking (AST type only):** `DiceTerm.explode` is now `Compare | null` instead of `boolean`;
  `DiceTerm` gains `reroll` and `success`. `RollEvent` is unchanged.
- Dice are thrown from a block laid out inside the walls with no two dice overlapping, instead of a
  tighter grid that started dice inside each other.
- Resting dice are pushed apart by their real footprints instead of 0.8 × their bounding spheres,
  so settled dice no longer end up inside each other in crowded mixed rolls.
- Dice collide with each other by their hull shapes (clipped face contacts) instead of bounding
  spheres: they touch instead of stopping apart, and can no longer rest on an invisible sphere.
- The settle-to-flat tail is 0.3 s (was 0.2 s) and collision-aware: dice slide and flatten without
  sinking, lift over a neighbour (at most 1.5 die units) when needed, then drop.
- Gentler throws (5–8 units/s, was 9–14), so fewer dice end against a wall.
- The d4 (circumradius 0.95, was 0.75) and d20 (0.85, was 0.8) are larger and easier to read.
- The motion of every roll changed (new golden trajectory hash); values are unaffected. Both sides
  of a shared roll need 0.2.0 to see the same motion.
- `createRoll` throws `RangeError` for a `rollerId`, `audience`, or inline skin that `isRollEvent`
  would reject, and `registerSkin` rejects names outside 1–64 characters (now `RangeError`, was
  `TypeError` for an empty name) and material values outside [0, 1].

### Fixed

- `createRoll` works on non-secure (plain http) pages, where `crypto.randomUUID` is missing.
- A user `<canvas>` without a CSS size no longer grows without bound at device pixel ratios above 1.
- An overlay tray no longer escapes an unpositioned host element.
- Skin colours in `oklch()`, `lab()`, `color()` and `color-mix()` render correctly instead of black.
- Labels pick up a web font that finishes loading after the tray was created.
- Skin colours no longer depend on canvas readback for hex and `rgb()` colours, so privacy-hardened
  browsers that block or randomize readback draw them correctly.
- A `playRoll` that throws (invalid event) leaves the current roll animating instead of freezing it.
- `createDiceTray` validates `dieScale`; `fadeAfterMs` above the timer limit or `Infinity` no longer
  fades immediately; `dispose()` clears a user canvas.

### Performance

- Core entry 3.95 → 3.73 kB after a size bake-off (no behaviour change).

## [0.1.0] - 2026-10-06

First release.

### Added

- `pollyroll` core (DOM-free): dice notation parser (`NdX`, `d%`, `dF`, keep/drop, `adv`/`dis`,
  exploding dice) with `PollyrollSyntaxError` positions; `createRoll` with unbiased crypto values and
  a 128-bit seed; `evaluate`, `redact`, and `isRollEvent` for the versioned `RollEvent` (v1) wire
  format.
- Deterministic physics: fixed-step rigid bodies using only `+ − * /` and `Math.sqrt`, with warm-started
  sequential impulses, settle detection, and explosion waves. Rotation symmetry groups (T, O, D5, I)
  remap each settled die so it shows the value that was rolled first.
- `pollyroll/render`: WebGL2 dice tray viewed from directly above, with instanced chamfered dice, a runtime glyph atlas, GGX PBR
  with clearcoat, an analytic environment, blob shadows, render-on-demand, DPR cap, reduced-motion
  and no-WebGL2 fallbacks, and context-loss recovery.
- Skins: `classic`, `obsidian`, `brass`, `oak`, `sapphire`, `ruby`; materials (plastic, metal, wood,
  stone, glass, gem); procedural patterns (gradient, speckle, marble, wood, swirl, custom GLSL);
  printed, engraved, and embossed labels; `defineSkin` and `registerSkin`.
- `MaterialParams` gains `transmission`, `tint`, and `sparkle` for custom glass and gem looks;
  `isRollEvent` accepts them in [0, 1].
- `pollyroll/render` exports `materialPresets` (frozen built-in material values).
- Skin presets `emerald`, `amethyst`, `topaz`, `aquamarine`, and `smoke`.
- Notation aliases `kN` (keep highest), `dN` (drop lowest), and `x` (explode), as in `4d6k3`,
  `4d6d1`, and `3d6x`.
- `DiceTray.setDieScale` changes the die size for later rolls; the demo has a size slider.
- `pollyroll/react`: `useDiceTray` hook and `<DiceTray />` overlay component.
- Demo playground with a two-tray shared-roll example; Playwright smoke, skin screenshots, and
  cross-browser determinism tests.
