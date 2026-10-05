// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, createRef, StrictMode } from 'react';
import { afterEach, assert, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DiceTray as Tray } from 'pollyroll/render';
import type { Skin, SkinRef } from '../skins/types';
import { DiceTray, useDiceTray } from './index';
import { skinChanged } from './skin';

// jsdom has no canvas contexts; null is what a browser without WebGL2 returns.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(cleanup);

const ruby: Skin = { material: 'gem', color: '#a00', labelColor: '#fff' };
const oak: Skin = { material: 'wood', color: '#963', labelColor: '#000' };

function overlay(container: HTMLElement): HTMLDivElement {
  const div = container.firstElementChild;
  assert.instanceOf(div, HTMLDivElement);
  return div;
}

describe('DiceTray', () => {
  it('appends one tray canvas on mount and removes it on unmount', () => {
    const view = render(createElement(DiceTray));
    const div = overlay(view.container);
    expect(div.querySelectorAll('canvas')).toHaveLength(1);
    view.unmount();
    expect(div.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('keeps exactly one tray canvas under StrictMode and removes it on unmount', () => {
    const view = render(createElement(StrictMode, null, createElement(DiceTray)));
    const div = overlay(view.container);
    expect(div.querySelectorAll('canvas')).toHaveLength(1);
    view.unmount();
    expect(div.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('passes an unsupported tray to trayRef without WebGL2', () => {
    const trayRef = createRef<Tray | null>();
    render(createElement(DiceTray, { trayRef }));
    expect(trayRef.current?.supported).toBe(false);
  });

  it('sets trayRef to null after unmount', () => {
    const trayRef = createRef<Tray | null>();
    const view = render(createElement(DiceTray, { trayRef }));
    expect(trayRef.current?.supported).toBe(false);
    view.unmount();
    expect(trayRef.current).toBeNull();
  });

  it('keeps the same tray canvas across skin changes', () => {
    const view = render(createElement(DiceTray, { skin: oak }));
    const div = overlay(view.container);
    const canvas = div.querySelector('canvas');
    view.rerender(createElement(DiceTray, { skin: ruby }));
    expect(div.querySelectorAll('canvas')).toHaveLength(1);
    expect(div.querySelector('canvas')).toBe(canvas);
  });

  it('renders an absolute, pointer-events-none overlay with className and style', () => {
    const view = render(createElement(DiceTray, { className: 'dice', style: { zIndex: 5 } }));
    const el = overlay(view.container);
    expect(el.style.position).toBe('absolute');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.className).toBe('dice');
    expect(el.style.zIndex).toBe('5');
  });
});

describe('useDiceTray', () => {
  it('returns null and appends no canvas when the ref is empty', () => {
    const ref = createRef<HTMLElement | null>();
    const { result } = renderHook(() => useDiceTray(ref));
    act(() => undefined);
    expect(result.current).toBeNull();
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });
});

describe('skinChanged', () => {
  it.each<[string, boolean, SkinRef | undefined, SkinRef | undefined]>([
    ['an undefined skin', false, undefined, oak],
    ['an undefined skin with nothing applied', false, undefined, undefined],
    ['the same preset name', false, 'classic', 'classic'],
    ['another preset name', true, 'ruby', 'classic'],
    ['the same skin object', false, oak, oak],
    ['an equal inline skin object', false, { ...oak }, oak],
    ['an inline skin with another color', true, { ...oak, color: '#000' }, oak],
    ['a preset name after an inline skin', true, 'classic', oak],
    ['an inline skin after a preset name', true, oak, 'classic'],
    ['a first skin', true, 'classic', undefined],
  ])('%s → %s', (_, expected, next, last) => {
    expect(skinChanged(next, last)).toBe(expected);
  });
});
