import { createElement, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, Ref, RefObject } from 'react';
import { createDiceTray } from 'pollyroll/render';
import type { DiceTray as Tray, TrayOptions } from 'pollyroll/render';
import { skinChanged } from './skin';

/** Creates a tray on the target (a RefObject is read once after mount) and disposes it on unmount.
 *  Options are read once except `skin`, `dieScale`, and `sound`, applied when they change. */
export function useDiceTray(
  target: RefObject<HTMLElement | null> | HTMLElement | null,
  opts?: TrayOptions,
): Tray | null {
  const [tray, setTray] = useState<Tray | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const skinRef = useRef(opts?.skin);

  useEffect(() => {
    const el = target && 'current' in target ? target.current : target;
    if (!el) return;
    const created = createDiceTray(el, optsRef.current);
    skinRef.current = optsRef.current?.skin;
    setTray(created);
    return () => {
      created.dispose();
      setTray(null);
    };
  }, [target]);

  const skin = opts?.skin;
  useEffect(() => {
    if (!tray || skin === undefined || !skinChanged(skin, skinRef.current)) return;
    skinRef.current = skin;
    tray.setSkin(skin);
  }, [tray, skin]);

  const dieScale = opts?.dieScale;
  useEffect(() => {
    if (tray && dieScale !== undefined) tray.setDieScale(dieScale);
  }, [tray, dieScale]);

  const sound = opts?.sound;
  useEffect(() => {
    if (tray && sound !== undefined) tray.setSound(sound);
  }, [tray, sound]);

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
 * Tray options are read once on mount except `skin`, `dieScale`, and `sound` (applied on change).
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
