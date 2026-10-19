# Coin die design (0.6.0)

Status: draft for owner review. Sound research and measurements: [docs/research/sound.md](../research/sound.md).

## Intent

Virtual tabletop users sometimes need a coin flip (owner backlog, 2026-10-19). Pollyroll rolls
d4–d100 and dF only. This adds a coin that is thrown into the tray with the dice, flips, bounces,
wobbles flat and shows heads or tails. It plays a coin sound instead of a dice clack.

Success: a coin that looks and sounds like a coin landing on a table, with the result decided
before the throw like every other die, in a single-player tray and in a shared roll.

## Goals

- **Notation `dc`:** a coin, values 0 (tails) and 1 (heads). This is Foundry VTT's coin term;
  Dice So Nice uses the same values.
- **Notation `d2`:** a two-sided die, values 1 and 2 (Roll20, Avrae, rpg-dice-roller). It uses
  the same coin model with `1` and `2` on its faces.
- **A real coin model:** a thin disc, not a relabelled d6.
- **Coin sound:** the owner chose the Coin Flip Lab's "Blend" take on the wooden table. A synth
  sound plays on its own; recorded clinks are layered on each landing and bounce when the app
  passes them in.
- **Mixed rolls work:** `1d20+1dc`, `3dc`, and every existing modifier.

## Non-goals

- A `c` "call" modifier (Foundry `dc` + `c1`). Success counting already covers it: `3dc=1` counts
  heads.
- Image artwork on the faces. Faces show text labels from the glyph atlas, which apps can
  replace.
- A thumb-flick launch or an in-air ring. The tray throws coins like dice.
- Edge landings as an outcome. A coin that settles on its rim is tipped flat by the settle tail,
  like a cocked die.
- Per-surface sounds (felt, glass). The tray has one surface: wood.

## Anti-goals

- **Physics deciding the result.** Values are drawn before simulation; the remap flips the coin
  so the chosen face is up.
- **Visible regressions for existing dice.** Same trajectories (golden hash), same bench budget,
  same sounds.
- **Any asset file.** The coin mesh and labels are generated in code. Recorded clinks are
  base64 data in `pollyroll/sounds`, under the existing owner-approved exception.

## Constraints

- AGENTS.md invariants:
  - zero runtime dependencies;
  - a DOM-free core;
  - the determinism rule in `src/physics/`;
  - result-first;
  - RollEvent v1;
  - size budgets are hard limits.
- **Current sizes:**
  - core 3.77 / 4 kB, so about 230 B are free;
  - render 26.5 / 30 kB;
  - sounds 1.27 / 1.5 kB, so a second recording does not fit in the same import.
- **Physics hull caps** today:
  - `MAX_VERTICES` 20, `MAX_FACES` 20 and `MAX_EDGES` 30 (`src/physics/world.ts:56-60`);
  - `FACE_EDGES` 5 (`src/physics/penetration.ts`);
  - `MAX_CLIP` 32 (`world.ts:64`).
- **Geometry assumptions:**
  - a readout per face, with the atlas cell equal to the face index (`mesh.ts:128`);
  - opposite-face numbering (`labels.ts:30-54`);
  - an absolute bevel of 0.08 (`mesh.ts:6`);
  - an atlas of 20 columns × 9 rows (`shaders.ts:5`).

## Decided (owner)

- Coin sound: Blend on wood, as in the Coin Flip Lab.
- Mechanics left to the designer (below, marked as the designer's calls).

## Designer's calls

### Notation and core

- `DieType` gains `'d2'` and `'dc'`.
- `d2` parses through the existing `NdX` path once it is in `DIE_TYPES`.
- `dc` gets a parser branch next to `%` and `f`.
- `dieRange('dc')` is `[0, 1]`, and `d2` falls out of the generic `[1, 2]`.
- Every modifier applies unchanged; the existing all-faces-match rule already rejects `d2r<3`.
  - `4dc kh2`, `3dc=1` (count heads), `d2!` (explode on 2) and `dc!` (explode on heads) are
    allowed, to keep the core small and the rules uniform.
  - Foundry exempts coins from these modifiers; Pollyroll does not need to.
- RollEvent stays `v: 1`.
  - The `type` enum widens. A receiver on 0.5.0 or older rejects an event containing a coin
    in `isRollEvent`, so it fails closed instead of showing a wrong result.
  - The README notes this the way it notes earlier notation additions.
  - A DECISIONS row records why this is not a version bump. The shape is unchanged; only the
    set of accepted values grows.
- `formatRoll` stays numeric: `3dc: [1, 0, 1] = 2` means two heads, as with Foundry's sum.

### Shape

- **Physics hull:** a 16-sided prism, circumradius 0.65 die units (diameter 1.3, about a d6's
  width), thickness 0.2. That gives 32 vertices, 18 faces and 48 edges.
  - On its rim, the radius varies by 1.9%, so a rolling coin barely bobs. 12 sides would give
    3.4% and 24 sides would cost 48 vertices.
  - Mass is 1, with the solid-hull inertia tensor as for every die.
- **Render mesh:** generated separately, for a round look under the top-down camera.
  - Two caps and a rim band, with rounded 0.04 edges, in 48 segments.
  - A vertex sits at angle 0, aligned with the hull, so every rotation in the hull's symmetry
    group (D16, order 32) maps the mesh onto itself and the remap stays invisible.
  - The hull and the mesh differ by at most 1.9% of the radius.
- **Readouts:** the two cap normals only, like the d4's special case.
  - A coin resting on its rim reads the higher cap. The settle tail then tips it over 90° onto
    that cap, so the up face equals the readout.
  - `findRemap` maps cap to cap through a 180° flip in the group.
- **Physics caps** rise to fit the hull:
  - `MAX_VERTICES` 32, `MAX_EDGES` 48;
  - `FACE_EDGES` 16;
  - `MAX_CLIP` at least 32, sized by the builder from the clipping bound.
  - Existing dice must keep the golden trajectory hash. If raising the caps changes it, stop
    and report instead of updating the hash.
- **Throw:** the same throw parameters and seed stream as dice. If the demo shows coins sliding
  flat without flipping in more than 1 of 10 throws, add an upward lift and a spin about a
  horizontal axis for coins only, as Dice So Nice does, and record it in DECISIONS.
- **Wobble:** the coin should visibly wobble flat, not only sound like it.
  - Today's settle test (below 0.1 rad/s for 24 steps) and uniform damping may cut a wobble
    short. The settle tail is interpolated, and `impacts()` skips tail frames.
  - First, coins get their own settle rule and damping, keyed by shape so dice are untouched.
    The coin settles only when its tilt is under 0.5° and it has stopped moving.
  - Measure wobble length over 200 seeds of `1dc`. If the median wobble before settle is under
    300 ms, add the fallback: a scripted wobble tail for coins.
    - It is a deterministic decaying precession, built from small incremental rotations (no
      `Math.sin`/`Math.cos`, per the determinism rule).
    - It replaces the flatten tail for coins and ends on the chosen face.
    - It reports its own rim-contact times to the sound, since `impacts()` skips tail frames.
- **Spawn and auto-fit:** unchanged. A coin's bounding sphere is conservative.
  - A coin resting on another coin is more than 0.1 above the floor, so it is re-simulated
    like any stacked die.

### Labels and look

- **Label sets** `d2` and `dc` share the coin shape. Defaults:
  - `d2`: `1` and `2`;
  - `dc`: `T` and `H`, in natural (value) order: tails 0, heads 1.
  - `TrayOptions.labels.d2` and `labels.dc` replace them, so an app can pass `['🜨', '♛']`
    or words.
- **Atlas:** two rows more (`ATLAS_ROWS` 11). Only the caps carry a cell; the rim draws blank.
- **Skins:** all skins apply. `brass` reads as a coin; `classic` reads as a white token.

### Sound

The tray's sound has three layers. Dice keep their current sound.

1. **Coin synth** (render entry, plays whenever `sound > 0`), the Coin Flip Lab model on wood:
   - four ring modes at 1 : 1.73 : 2.72 : 3.57 × 4.9 kHz, each a doublet split 2.2%;
   - each mode rolled off above a 3 kHz contact frequency;
   - seven table modes at 0.6–2.4 kHz, with τ 12 ms;
   - a band-passed strike click at 1.2 kHz, −12 dB.

   It is rendered into an AudioBuffer per hit at play time. Render code is outside
   `src/physics/`, so `Math.sin` and `Math.exp` are allowed there. Parameters are fixed
   constants, not options.

2. **Recorded clinks** (`TrayOptions.coinClinks?: ClackSet`, read at tray creation like
   `clacks`):
   - Each coin landing and bounce also plays one clink at −4 dB relative to the synth hit,
     with the dice clacks' pitch variation.
   - Decoding failure or no clinks means synth only.
3. **Events from the physics:**
   - `impacts()` reports which body each hit came from, so a coin hit uses the coin sound and a
     die hit the dice sound.
   - **Landings and bounces** are a coin's impacts, at their strength.
   - **Rim contacts** are new: while a coin is tilted more than 2° with its lowest hull point
     within 0.02 of the floor, each change of its lowest hull vertex is one contact. With 16
     rim vertices, a wobble that precesses faster gives a faster rattle, which is the
     Euler's-disk sound.
   - Rim contacts play the synth only, at −12 dB and with a 0.45× ring.
   - The coin coming to rest plays one soft tap.
   - The builder calibrates the thresholds against the lab's timeline: 16 contacts per second
     rising to about 140, about 600 ms of wobble.

`pollyroll/sounds` exports `coinClinks`:

- **Source:** 6 of the 8 Kenney clinks (shipped: the two shortest dropped to keep 16 kbps; RPG Audio `handleCoins`, `handleCoins2`, CC0), at the
  offsets the lab uses.
- **Processing:**
  - each clink is trimmed to 25 ms with a 3 ms fade;
  - each is low-passed at 3 kHz, as the blend does on wood;
  - all are encoded as one MP3 at the lowest rate that keeps 3 kHz (16 kHz or lower, chosen
    by ear).
- **Budget:** a separate size-limit line, `import { coinClinks }` ≤ 0.75 kB. The existing
  line changes to `import { diceClacks }` ≤ 1.5 kB, so each export is budgeted alone.
  - Today's single line would overflow with both exports. This is a budget change and needs
    the owner's approval (see Open for the owner).

### Docs, demo, release

- **PLAN.md amendments:**
  - § 2 die table: `d2` and `dc` rows;
  - § 3 DieType;
  - § 4 grammar;
  - § 5 hull caps and the coin;
  - § 6 `coinClinks`;
  - § 1 budgets;
  - § 12 status.
- **Other docs:** DECISIONS rows; README notation table, sound section and "older receivers"
  note; CHANGELOG 0.6.0.
- **Demo:** example buttons `dc`, `3dc=1` and `2d2`; notation key rows; tray A passes
  `coinClinks`.
- **Version** 0.6.0 (new public API).

## Success criteria (the builder's checks)

- **Values and remap:**
  - for `d2` and `dc`, every value shows on the up face after remap, in unit and property
    tests;
  - `isRollEvent` accepts both types with their value ranges and rejects out-of-range values
    (`dc` 2, `d2` 0).
- **Rest pose:**
  - coins settle flat (0.5° rule) over 1,000 seeds;
  - no coin rests on a coin or a die, measured like the 0.4.0 stacking runs (`3dc`, `10dc`,
    `1d20+3dc`, `5d6+2dc`);
  - visible tails are reported (edge rests included).
- **Existing dice:** the golden trajectory hash is unchanged.
- **Bench** (recorded, as PLAN § 1 says, not gated in CI): dice-only rolls may not get more than
  10% slower than the base commit, by the median of 5 runs of the 10-dice bench.
  - Raising `FACE_EDGES` to 16 grows the per-pair warm-start slots about 17×. If that costs
    dice-only rolls, size the scratch arrays to the largest hull in the world.
  - The builder also records a 10-coin bench.
- **Sizes:** within all budgets, including the two new `pollyroll/sounds` lines.
- **Sound:**
  - A Node test renders a coin landing through the synth. At least 60% of its energy must sit
    at 1–4 kHz and under 2% above 8 kHz. This test discriminates the wooden model from the
    metallic one.
  - An e2e test checks that `coinClinks` decodes in all three browsers.
- **Owner check:** a by-ear and by-eye check in the hosted demo, before release.

## Open for the owner

1. **Budget split:** `pollyroll/sounds` measured per export, `diceClacks` ≤ 1.5 kB plus
   `coinClinks` ≤ 0.75 kB.
2. **Notation:** `dc` gives 0 or 1, and `d2` gives 1 or 2.

## Left to the builder

- Exact cap values and the `MAX_CLIP` bound.
- The coin mesh generator and the label placement on the cap.
- Rim-contact thresholds, the synth's buffer caching, and the clink MP3 rate.
- Task split and brief order, per [delegation.md](../agents/delegation.md).
