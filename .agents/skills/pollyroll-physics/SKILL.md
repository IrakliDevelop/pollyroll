---
name: pollyroll-physics
description: Rules, mandatory test categories, and review checks for Pollyroll's deterministic dice physics and geometry (src/physics/, src/geometry/). Use when implementing, testing, or reviewing the simulation, contacts, settle detection, symmetry groups, or face remapping.
---

# Pollyroll physics and geometry

Adapted from forge-gpu `dev-physics-lesson` and `dev-physics-review` (Zlib, Rosy Game Studio); see
[../THIRD_PARTY.md](../THIRD_PARTY.md). Altered for TypeScript and Pollyroll.

The simulation only animates; the result is decided before it runs. But a wrong symmetry rotation
shows the wrong number, and nondeterminism makes two players see different tumbles. Treat this code
as correctness-critical.

## Library standards

**Correctness**

- Every function implements a named algorithm (semi-implicit Euler, sequential impulses, convex
  vertex–plane contact). Cite the source in the doc comment.
- Velocity is updated before position (semi-implicit Euler): `v += a·dt`, then `x += v·dt`.
- Degenerate input is defined and documented: zero-length vectors, coincident bodies, zero
  angular velocity, a body resting exactly on an edge or vertex.
- Static geometry (floor, walls) has `invMass = 0` and `invInertia = 0`; integration returns early
  for it. Acceleration is `force · invMass`, never `force / mass`.

**Numerical safety**

- Never divide without checking the denominator; precompute `invMass` and the inverse inertia
  tensor at construction.
- Normalize only after checking `length > EPSILON`; renormalize quaternions every step.
- Guard `Math.sqrt` against tiny negative values from rounding.
- Clamp restitution and damping to `[0, 1]`, penetration depth to `>= 0`.
- A step with extreme input must leave the world valid: clamp or early-return rather than produce
  `NaN` or `Infinity`.

**Determinism (Pollyroll-specific, from AGENTS.md)**

- Inside the step: only `+ - * /` and `Math.sqrt`. No `Math.sin/cos/exp/pow/atan2`, no
  `Math.random`, no `Date`/`performance.now`, no `Math.fround` mixing.
- `DT` is a constant (`1/120`); step count never depends on frame time. Rendering samples the
  keyframe track; interpolation never feeds back into simulation state.
- Iteration order is fixed (body index order, contact order by body then vertex index). No
  `Map`/`Set` iteration whose order depends on insertion timing, no sorting with unstable keys.
- Throw parameters come only from the `sfc32` stream seeded by `event.seed`, drawn in a fixed order.
- Trigonometry needed for setup (for example random axis-angle spins) happens outside the step and
  only through the seeded RNG plus algebraic constructions, so it is deterministic too.

**Symmetry and remap**

- Rotation groups are generated from vertex sets and verified: group order (T 12, O 24, D5 10,
  I 60) and transitivity on faces (on vertices for d4).
- Remap uses a group element `S` with `S` mapping the chosen value's face onto the settled up-face;
  rendered orientation is `q(t) · S` for the whole track.

## Mandatory test categories

Every physics or geometry function has all applicable categories. Expected values come from
independent sources (hand-computed literals, the spec), never from re-running the same formula.

1. **Basic correctness:** a body falling 1 s under gravity −30 from rest has `v.y ≈ −30` within
   tolerance; a d6 at rest flat on the floor reads its top face label.
2. **Edge cases:** static bodies never move; zero dt is a no-op; zero-length vectors; die resting on
   an edge resolves to a face; maximum dice count.
3. **Stability:** thousands of steps with no `NaN`, no `Infinity`, no coordinate above `1e6`;
   kinetic energy of a bouncing die never exceeds its initial energy by more than 10%.
4. **Determinism:** two runs from the same seed produce bit-identical tracks; a golden hash of the
   track for a fixed seed set is asserted and only changed with an explanation.
5. **Collision:** contact normals point out of the plane; penetration `>= 0`; post-contact normal
   velocity respects restitution; friction reduces tangential velocity and never reverses it.
6. **Remap:** for every die type and every value, the remapped settled up-face equals the value.

## Review checklist

- Numerical safety items above, line by line.
- Integration order and early return for static bodies.
- Determinism items above, including a grep for forbidden `Math.` calls in `src/physics/`.
- No per-step allocation in the hot loop (preallocated typed arrays or reused objects).
- Doc comments name the algorithm actually implemented.
