# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
- Notation aliases `kN` (keep highest), `dN` (drop lowest), and `x` (explode), as in `4d6k3`,
  `4d6d1`, and `3d6x`.
- `DiceTray.setDieScale` changes the die size for later rolls; the demo has a size slider.
- `pollyroll/react`: `useDiceTray` hook and `<DiceTray />` overlay component.
- Demo playground with a two-tray shared-roll example; Playwright smoke, skin screenshots, and
  cross-browser determinism tests.
