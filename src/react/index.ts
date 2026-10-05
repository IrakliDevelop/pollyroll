import { createElement, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, Ref, RefObject } from 'react';
import { createDiceTray } from 'pollyroll/render';
import type { DiceTray as Tray, TrayOptions } from 'pollyroll/render';

/**
 * Creates a tray on ref.current after mount, disposes it on unmount. Returns the tray once created.
 * Options are read once when the tray is created; only `skin` is reactive and is applied with
 * `setSkin` when it changes by value (strings by ===, objects by JSON.stringify). A `skin` that
 * becomes undefined keeps the tray's current skin and the last applied skin is still remembered.
 */
export function useDiceTray(ref: RefObject<HTMLElement | null>, opts?: TrayOptions): Tray | null {
  const [tray, setTray] = useState<Tray | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const skinRef = useRef(opts?.skin);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const created = createDiceTray(el, optsRef.current);
    skinRef.current = optsRef.current?.skin;
    setTray(created);
    return () => {
      created.dispose();
      setTray(null);
    };
  }, [ref]);

  const skin = opts?.skin;
  useEffect(() => {
    const last = skinRef.current;
    if (!tray || skin === undefined || skin === last) return;
    if (typeof skin === 'object' && typeof last === 'object') {
      if (JSON.stringify(skin) === JSON.stringify(last)) return;
    }
    skinRef.current = skin;
    tray.setSkin(skin);
  }, [tray, skin]);

  return tray;
}

export interface DiceTrayProps extends TrayOptions {
  /** Receives the tray once created, and null after unmount. */
  trayRef?: Ref<Tray | null>;
  className?: string;
  /** Merged after the overlay defaults. */
  style?: CSSProperties;
}

/**
 * Overlay: a div styled position:absolute; inset:0; pointer-events:none, hosting the tray canvas.
 * Tray options are read once on mount; only `skin` is reactive (applied when it changes by value).
 */
export function DiceTray(props: DiceTrayProps): ReactElement {
  const { trayRef, className, style, ...opts } = props;
  const ref = useRef<HTMLDivElement>(null);
  const tray = useDiceTray(ref, opts);
  useImperativeHandle<Tray | null, Tray | null>(trayRef, () => tray, [tray]);
  return createElement('div', {
    ref,
    className,
    style: { position: 'absolute', inset: 0, pointerEvents: 'none', ...style },
  });
}
