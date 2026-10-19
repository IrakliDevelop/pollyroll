// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RollEvent } from '../core/types';
import { diceClacks } from '../sounds';
import type { ClackSet } from './sound';
import { createDiceTray, materialPresets } from './tray';

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

  it('positions a static element target so the overlay stays inside it', () => {
    noWebGl();
    const host = document.createElement('div');
    host.style.position = 'static';
    const placed = document.createElement('div');
    placed.style.position = 'absolute';
    document.body.append(host, placed);
    createDiceTray(host);
    createDiceTray(placed);
    expect(host.style.position).toBe('relative');
    expect(placed.style.position).toBe('absolute');
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

  it('rejects an invalid dieScale option before adding an overlay', () => {
    noWebGl();
    const host = document.createElement('div');
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => createDiceTray(host, { dieScale: bad })).toThrow(RangeError);
    }
    expect(host.querySelector('canvas')).toBeNull();
  });

  it.each<[string, ClackSet['clacks']]>([
    ['no clacks', []],
    [
      'a NaN length',
      [
        [10, 40],
        [0, NaN],
      ],
    ],
    [
      'a negative length',
      [
        [10, 40],
        [0, -5],
      ],
    ],
    [
      'a zero length',
      [
        [10, 40],
        [0, 0],
      ],
    ],
    [
      'an infinite length',
      [
        [10, 40],
        [0, Infinity],
      ],
    ],
    [
      'a NaN start',
      [
        [10, 40],
        [NaN, 40],
      ],
    ],
    [
      'an infinite start',
      [
        [10, 40],
        [-Infinity, 40],
      ],
    ],
  ])('rejects a clack set with %s before adding an overlay', (_, clacks) => {
    noWebGl();
    const host = document.createElement('div');
    expect(() => createDiceTray(host, { clacks: { audio: diceClacks.audio, clacks } })).toThrow(
      RangeError,
    );
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('accepts the recorded diceClacks', () => {
    noWebGl();
    expect(createDiceTray(document.createElement('canvas'), { clacks: diceClacks }).supported).toBe(
      false,
    );
  });

  it('labels the canvas and updates the label with the result', async () => {
    noWebGl();
    const canvas = document.createElement('canvas');
    const tray = createDiceTray(canvas);
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('Dice tray');
    await tray.playRoll(event);
    expect(canvas.getAttribute('aria-label')).toBe('2d6+3: [2, 5] + 3 = 10');
  });

  it('announces results in a live region only when asked', async () => {
    noWebGl();
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    const quiet = createDiceTray(plain);
    await quiet.playRoll(event);
    expect(plain.querySelector('[aria-live]')).toBeNull();
    quiet.dispose();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const tray = createDiceTray(host, { announce: true });
    const regions = host.querySelectorAll('[role=status][aria-live=polite]');
    expect(regions).toHaveLength(1);
    await tray.playRoll(event);
    expect(regions[0]?.textContent).toBe('2d6+3: [2, 5] + 3 = 10');
    tray.clear();
    expect(regions[0]?.textContent).toBe('');
    expect(host.querySelector('canvas')?.getAttribute('aria-label')).toBe('Dice tray');
    tray.dispose();
    expect(host.querySelector('[aria-live]')).toBeNull();
  });

  it('removes its attributes from a user canvas on dispose', async () => {
    noWebGl();
    const box = document.createElement('div');
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    const tray = createDiceTray(canvas, { announce: true });
    expect(canvas.nextElementSibling?.getAttribute('role')).toBe('status');
    await tray.playRoll(event);
    tray.dispose();
    tray.clear();
    expect(canvas.hasAttribute('role')).toBe(false);
    expect(canvas.hasAttribute('aria-label')).toBe(false);
    expect(box.children).toHaveLength(1);
  });
});

describe('materialPresets', () => {
  it('is frozen, outer table and every entry', () => {
    expect(Object.isFrozen(materialPresets)).toBe(true);
    for (const m of Object.values(materialPresets)) expect(Object.isFrozen(m)).toBe(true);
  });

  it('lists every shader parameter of every preset', () => {
    const opaque = { transmission: 0, tint: 0, sparkle: 0 };
    expect(materialPresets).toEqual({
      plastic: { metalness: 0, roughness: 0.35, clearcoat: 0.3, ...opaque },
      metal: { metalness: 1, roughness: 0.3, clearcoat: 0, ...opaque },
      wood: { metalness: 0, roughness: 0.7, clearcoat: 0.1, ...opaque },
      stone: { metalness: 0, roughness: 0.45, clearcoat: 0.6, ...opaque },
      glass: {
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1,
        transmission: 0.8,
        tint: 0.6,
        sparkle: 0,
      },
      gem: {
        metalness: 0,
        roughness: 0.08,
        clearcoat: 1,
        transmission: 0.4,
        tint: 0.9,
        sparkle: 1,
      },
    });
  });
});
