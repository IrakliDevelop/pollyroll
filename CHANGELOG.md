# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - Unreleased

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
- A `playRoll` that throws (invalid event) leaves the current roll animating instead of freezing it.
- `createDiceTray` validates `dieScale`; `fadeAfterMs` above the timer limit or `Infinity` no longer
  fades immediately; `dispose()` clears a user canvas.

### Performance

- Core entry 3.95 → 3.73 kB after a size bake-off (no behaviour change).

## [0.1.0] - Unreleased

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
