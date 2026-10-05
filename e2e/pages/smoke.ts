import type { RollEvent, RollSummary } from 'pollyroll';
import { createDiceTray } from 'pollyroll/render';
import type { DiceTray } from 'pollyroll/render';

interface SmokeState {
  ready: boolean;
  settled: boolean;
  summary: RollSummary | null;
  supported: boolean;
  elapsedMs: number;
}

declare global {
  interface Window {
    __pollyroll: SmokeState;
    __pollyrollTray: DiceTray;
  }
}

// Fixed event: d4 3, d6 5, d8 7, d10 6, d12 11, d20 19, d100 42, dF +1 → total 94.
const event: RollEvent = {
  v: 1,
  id: 'smoke-0001',
  notation: '1d4+1d6+1d8+1d10+1d12+1d20+1d100+1dF',
  dice: [
    { type: 'd4', value: 3, group: 0, wave: 0 },
    { type: 'd6', value: 5, group: 1, wave: 0 },
    { type: 'd8', value: 7, group: 2, wave: 0 },
    { type: 'd10', value: 6, group: 3, wave: 0 },
    { type: 'd12', value: 11, group: 4, wave: 0 },
    { type: 'd20', value: 19, group: 5, wave: 0 },
    { type: 'd100', value: 42, group: 6, wave: 0 },
    { type: 'dF', value: 1, group: 7, wave: 0 },
  ],
  modifier: 0,
  seed: '0123456789abcdef0123456789abcdef',
  createdAt: 0,
};

const state: SmokeState = {
  ready: false,
  settled: false,
  summary: null,
  supported: false,
  elapsedMs: -1,
};
window.__pollyroll = state;

const canvas = document.getElementById('tray');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #tray canvas');
const params = new URLSearchParams(location.search);
const reduced = params.has('reduced');
const tray = createDiceTray(canvas, {
  labelFont: 'sans-serif',
  reducedMotion: reduced ? 'always' : 'never',
  skin: params.get('skin') ?? 'classic',
  ...(params.get('labels') === 'custom' ? { labels: { d6: ['A', 'B', 'C', 'D', 'E', 'F'] } } : {}),
});
window.__pollyrollTray = tray;
state.supported = tray.supported;
const start = performance.now();
const done = tray.playRoll(event);
state.ready = true;
void done.then((summary) => {
  state.elapsedMs = performance.now() - start;
  state.summary = summary;
  state.settled = true;
});
