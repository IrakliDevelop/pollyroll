---
name: pollyroll-visual-tests
description: Playwright patterns for testing Pollyroll's WebGL canvas: screenshot baselines, render-ready signals, deterministic frames, and cross-browser determinism hashes. Use when writing or debugging anything under e2e/.
---

# Pollyroll visual and e2e tests

Anti-pattern table adapted from testdino `playwright-skill` `core/canvas-and-webgl.md` (MIT,
TestDino); see [../THIRD_PARTY.md](../THIRD_PARTY.md).

## Setup

- Fixed viewport (800×600) and `deviceScaleFactor: 1` for every visual test.
- Chromium launched with `--use-angle=swiftshader --enable-unsafe-swiftshader` so CI and local
  render through the same software rasterizer.
- The e2e page exposes `window.__pollyroll = { ready: Promise, settled: Promise, trackHash }`.
- Tests wait on `page.waitForFunction` against those signals, never `waitForTimeout`.

## Deterministic frames

- Screenshot tests play a fixed `RollEvent` (fixed seed, fixed values) and capture after `settled`.
  The settled frame is a pure function of the event and the skin, so baselines are stable.
- For mid-animation frames, expose a test hook that renders keyframe N directly instead of timing.
- Pixel reads from WebGL need `preserveDrawingBuffer: true` on the test page or a read in the same
  animation frame; otherwise the buffer is already cleared.

## Cross-browser determinism

The determinism e2e runs the headless simulation in each browser through `page.evaluate` and
compares the track hash with the hash Node computes for the same seeds. Equality is exact.

## Anti-patterns

| Don't                                                   | Problem                                   | Instead                                                  |
| ------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Assert exact RGB values                                 | GPU and anti-aliasing variance            | `toHaveScreenshot` with `maxDiffPixelRatio: 0.01`–`0.02` |
| `waitForTimeout` before capture                         | Too slow or too early                     | Wait for `settled` with `waitForFunction`                |
| `getImageData` through a 2D context on the WebGL canvas | Contexts are mutually exclusive           | Screenshot, or `readPixels` inside the page              |
| Full-page screenshots                                   | Unrelated content makes baselines brittle | Scope to the tray canvas locator                         |
| Regenerating baselines to make a failure pass           | Hides regressions                         | State the intended visual change in the commit           |

## Troubleshooting

| Symptom                                 | Fix                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| WebGL2 context is null in CI            | Check SwiftShader flags; Firefox/WebKit may need `xvfb-run` on Linux              |
| Baseline differs only in CI             | Font differences: label fonts in tests use a generic family only                  |
| Determinism hash differs in one browser | A forbidden `Math.` call or order-dependent iteration slipped into `src/physics/` |
