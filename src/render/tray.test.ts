// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RollEvent } from '../core/types';
import { createDiceTray } from './tray';

const event: RollEvent = {
  v: 1,
  id: 'tray-test',
  notation: '2d6+3',
  dice: [
    { type: 'd6', value: 2, group: 0, wave: 0 },
    { type: 'd6', value: 5, group: 0, wave: 0 },
  ],
  modifier: 3,
  seed: '0123456789abcdef0123456789abcdef',
  createdAt: 0,
};

function noWebGl(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('createDiceTray without WebGL2', () => {
  it('is unsupported and resolves playRoll immediately with the summary', async () => {
    noWebGl();
    const tray = createDiceTray(document.createElement('canvas'));
    expect(tray.supported).toBe(false);
    const summary = await tray.playRoll(event);
    expect(summary.total).toBe(10);
  });

  it('adds an overlay canvas to an element target and removes it on dispose', () => {
    noWebGl();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const tray = createDiceTray(host);
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.style.position).toBe('absolute');
    expect(canvas?.style.pointerEvents).toBe('none');
    tray.dispose();
    tray.dispose();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('never removes a canvas target and resolves rolls after dispose', async () => {
    noWebGl();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const tray = createDiceTray(canvas);
    tray.dispose();
    expect(canvas.isConnected).toBe(true);
    expect((await tray.playRoll(event)).total).toBe(10);
  });

  it('rejects a non-finite or non-positive die scale', () => {
    noWebGl();
    const tray = createDiceTray(document.createElement('canvas'));
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => tray.setDieScale(bad)).toThrow(RangeError);
    }
    expect(() => tray.setDieScale(2)).not.toThrow();
  });
});
