// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, createRef, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DiceTray as Tray } from 'pollyroll/render';
import type { Skin, SkinRef } from '../skins/types';
import { DiceTray, useDiceTray } from './index';

interface FakeTray extends Tray {
  dispose: Mock<() => void>;
  setSkin: Mock<(skin: SkinRef) => void>;
}

const created: FakeTray[] = [];

vi.mock('pollyroll/render', () => ({
  createDiceTray: (): FakeTray => {
    const tray: FakeTray = {
      playRoll: vi.fn(),
      setSkin: vi.fn<(skin: SkinRef) => void>(),
      clear: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn<() => void>(),
      supported: true,
    };
    created.push(tray);
    return tray;
  },
}));

afterEach(() => {
  cleanup();
  created.length = 0;
});

const ruby: Skin = { material: 'gem', color: '#a00', labelColor: '#fff' };
const oak: Skin = { material: 'wood', color: '#963', labelColor: '#000' };

describe('DiceTray', () => {
  it('creates one tray on mount and disposes it exactly once on unmount', () => {
    const view = render(createElement(DiceTray));
    expect(created).toHaveLength(1);
    expect(created[0]?.dispose).not.toHaveBeenCalled();
    view.unmount();
    expect(created).toHaveLength(1);
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes every tray exactly once under StrictMode', () => {
    const view = render(createElement(StrictMode, null, createElement(DiceTray)));
    expect(created).toHaveLength(2);
    view.unmount();
    expect(created).toHaveLength(2);
    for (const tray of created) expect(tray.dispose).toHaveBeenCalledTimes(1);
  });

  it('passes the created tray to trayRef', () => {
    const trayRef = createRef<Tray | null>();
    render(createElement(DiceTray, { trayRef }));
    expect(created).toHaveLength(1);
    expect(trayRef.current).toBe(created[0]);
  });

  it('sets trayRef to null after unmount', () => {
    const trayRef = createRef<Tray | null>();
    const view = render(createElement(DiceTray, { trayRef }));
    expect(trayRef.current).toBe(created[0]);
    view.unmount();
    expect(trayRef.current).toBeNull();
  });

  it('applies a new skin once and ignores the same skin', () => {
    const view = render(createElement(DiceTray, { skin: oak }));
    const tray = created[0];
    expect(tray?.setSkin).not.toHaveBeenCalled();
    view.rerender(createElement(DiceTray, { skin: ruby }));
    expect(tray?.setSkin).toHaveBeenCalledTimes(1);
    expect(tray?.setSkin).toHaveBeenCalledWith(ruby);
    view.rerender(createElement(DiceTray, { skin: ruby }));
    expect(tray?.setSkin).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it('compares inline skin objects by value', () => {
    const view = render(createElement(DiceTray, { skin: { ...oak } }));
    const tray = created[0];
    view.rerender(createElement(DiceTray, { skin: { ...oak } }));
    expect(tray?.setSkin).not.toHaveBeenCalled();
    view.rerender(createElement(DiceTray, { skin: { ...oak, color: '#000' } }));
    expect(tray?.setSkin).toHaveBeenCalledTimes(1);
    expect(tray?.setSkin).toHaveBeenCalledWith({ ...oak, color: '#000' });
    view.rerender(createElement(DiceTray, { skin: { ...oak, color: '#000' } }));
    expect(tray?.setSkin).toHaveBeenCalledTimes(1);
  });

  it('keeps the tray skin and the remembered skin when skin becomes undefined', () => {
    const view = render(createElement(DiceTray, { skin: oak }));
    const tray = created[0];
    view.rerender(createElement(DiceTray));
    expect(tray?.setSkin).not.toHaveBeenCalled();
    view.rerender(createElement(DiceTray, { skin: oak }));
    expect(tray?.setSkin).not.toHaveBeenCalled();
    view.rerender(createElement(DiceTray, { skin: 'classic' }));
    expect(tray?.setSkin).toHaveBeenCalledTimes(1);
    expect(tray?.setSkin).toHaveBeenCalledWith('classic');
  });

  it('renders an absolute, pointer-events-none overlay with className and style', () => {
    const view = render(createElement(DiceTray, { className: 'dice', style: { zIndex: 5 } }));
    const div = view.container.firstElementChild;
    expect(div).toBeInstanceOf(HTMLDivElement);
    const el = div as HTMLDivElement;
    expect(el.style.position).toBe('absolute');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.className).toBe('dice');
    expect(el.style.zIndex).toBe('5');
  });
});

describe('useDiceTray', () => {
  it('returns null and creates nothing when the ref is empty', () => {
    const ref = createRef<HTMLElement | null>();
    const { result } = renderHook(() => useDiceTray(ref));
    act(() => undefined);
    expect(result.current).toBeNull();
    expect(created).toHaveLength(0);
  });
});
