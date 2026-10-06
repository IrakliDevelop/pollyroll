import { evaluate } from '../core/evaluate';
import type { RollEvent, RollSummary } from '../core/types';
import { shapeOf } from '../geometry/labels';
import type { LabelSet } from '../geometry/labels';
import { getDieMesh, MESH_STRIDE } from '../geometry/mesh';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { MAX_BODIES, planRoll, slots } from '../physics/plan';
import type { PlannedBody, RollPlan } from '../physics/plan';
import { DT } from '../physics/world';
import { PATTERNS } from '../skins/patterns';
import { resolveSkin } from '../skins/presets';
import type { MaterialPreset, Skin, SkinRef } from '../skins/types';
import { ATLAS_MAX_LEVEL, buildAtlas, LABEL_SETS } from './atlas';
import { cameraPosition, fitScale, trayBounds, viewProjection } from './camera';
import { attrib, createBuffer, createProgram } from './gl';
import { DIE_VERTEX, dieFragment, LIGHT_DIR, SHADOW_FRAGMENT, SHADOW_VERTEX } from './shaders';
import type { DieKind } from './shaders';

export interface TrayOptions {
  skin?: SkinRef;
  labelFont?: string; // default 'system-ui'
  dieScale?: number; // default 2
  shadows?: boolean; // default true (blob shadows)
  maxDpr?: number; // default 2
  reducedMotion?: 'auto' | 'always' | 'never'; // default 'auto' (media query)
  fadeAfterMs?: number | null; // default null: dice stay until the next roll
  /**
   * Custom labels per label set; labels[set][i] replaces the i-th label of the set's natural
   * sequence: d4 '1'..'4', d6 '1'..'6', d8 '1'..'8', d12 '1'..'12', d20 '1'..'20' (i = value − 1);
   * d10 and d100ones '0'..'9' and d100tens '00'..'90' (i = digit); dF 0 = the −1 faces, 1 = the
   * blank faces, 2 = the +1 faces. Missing entries use the default text.
   */
  labels?: Partial<Record<LabelSet, readonly string[]>>;
}

export interface DiceTray {
  /** Pre-simulates, remaps, animates, and resolves with the summary once every die has settled. */
  playRoll(event: RollEvent): Promise<RollSummary>;
  setSkin(skin: SkinRef): void;
  /** Sets the die size for subsequent rolls; the dice already on screen keep their size. */
  setDieScale(scale: number): void;
  clear(): void;
  resize(): void;
  dispose(): void;
  readonly supported: boolean; // false when WebGL2 is unavailable
}

const FADE_MS = 300;
const INST = 8; // floats per die instance: x, y, z, atlas row (−1 = blank), qx, qy, qz, qw
const FRAME = 7; // floats per keyframe: x, y, z, qx, qy, qz, qw
// Floor shift per unit height away from the key light: −L.xz / L.y.
const SHADOW_X = -LIGHT_DIR[0] / LIGHT_DIR[1];
const SHADOW_Z = -LIGHT_DIR[2] / LIGHT_DIR[1];
/** Material preset → metalness, roughness, clearcoat. */
const MATERIALS: Record<MaterialPreset, readonly number[]> = {
  plastic: [0, 0.35, 0.3],
  metal: [1, 0.3, 0],
  wood: [0, 0.7, 0.1],
  stone: [0, 0.45, 0.6],
  glass: [0, 0.05, 1],
  gem: [0, 0.08, 1],
};
const DIE_UNIFORMS = [
  'uVP',
  'uScale',
  'uCam',
  'uBase',
  'uBase2',
  'uLabel',
  'uMat',
  'uAlpha',
  'uAtlas',
];
const MAX_ANISOTROPY = 4;

interface Group {
  set: LabelSet;
  row: number;
  bodies: PlannedBody[];
  radius: number;
  data: Float32Array; // MAX_BODIES instances
  count: number;
}

interface Roll {
  plan: RollPlan;
  groups: Group[];
  eventSkin: SkinRef | undefined;
  skin: SkinGpu;
  scale: number;
  t0: number;
  step: number;
  done: boolean;
}

/**
 * A resolved skin: program key and fragment source for its feature set, uniform values, and the
 * label font (undefined = the tray's labelFont).
 */
interface SkinGpu {
  key: string;
  fragment: string;
  transparent: boolean;
  font: string | undefined;
  u: Float32Array; // color a rgb, color b rgb, label rgb (linear), metalness, roughness, clearcoat
}

interface Program {
  program: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

let colorCtx: CanvasRenderingContext2D | null | undefined;
const colors = new Map<string, readonly number[]>();

/** Linear RGB of a CSS color, resolved through a shared 2D context and cached per string. */
function linearColor(css: string): readonly number[] {
  let c = colors.get(css);
  if (c === undefined) {
    colorCtx ??= document.createElement('canvas').getContext('2d');
    let text = '#000000';
    if (colorCtx !== null) {
      colorCtx.fillStyle = '#000';
      colorCtx.fillStyle = css;
      text = String(colorCtx.fillStyle);
    }
    const srgb = text.startsWith('#')
      ? [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16))
      : (text.match(/[\d.]+/g) ?? []).map(Number);
    c = [0, 1, 2].map((i) => Math.pow((srgb[i] ?? 0) / 255, 2.2));
    colors.set(css, c);
  }
  return c;
}

/** Program feature set and uniform values of a skin; a single color is used for both a and b. */
function skinGpu(skin: Skin): SkinGpu {
  const m = skin.material;
  const mat = typeof m === 'object' ? [m.metalness, m.roughness, m.clearcoat ?? 0] : MATERIALS[m];
  const kind: DieKind = m === 'glass' || m === 'gem' ? m : 'opaque';
  const [a, b] = typeof skin.color === 'string' ? [skin.color, skin.color] : skin.color;
  const p = skin.pattern ?? 'none';
  const pattern = typeof p === 'object' ? p.glsl : PATTERNS[p];
  const label = skin.labelStyle ?? 'engraved';
  return {
    key: `${label}|${kind}|${pattern}`,
    fragment: dieFragment(label, kind, pattern),
    transparent: kind !== 'opaque',
    font: skin.font,
    u: new Float32Array([
      ...linearColor(a),
      ...linearColor(b),
      ...linearColor(skin.labelColor),
      ...mat,
    ]),
  };
}

function at(f: Float32Array, i: number): number {
  return f[i] ?? 0;
}

/** Writes body b's interpolated instance at global step s: lerped position, nlerped q(t) ⊗ remap. */
function writePose(b: PlannedBody, s: number, row: number, out: Float32Array, o: number): void {
  const f = b.frames;
  const last = f.length / FRAME - 1;
  const fl = Math.floor(s);
  let i0 = fl - b.startStep;
  let t = s - fl;
  if (i0 >= last) {
    i0 = last;
    t = 0;
  }
  const a = i0 * FRAME;
  const c = (i0 < last ? i0 + 1 : i0) * FRAME;
  for (let k = 0; k < 3; k++) out[o + k] = at(f, a + k) + (at(f, c + k) - at(f, a + k)) * t;
  out[o + 3] = row;
  const sign =
    at(f, a + 3) * at(f, c + 3) +
      at(f, a + 4) * at(f, c + 4) +
      at(f, a + 5) * at(f, c + 5) +
      at(f, a + 6) * at(f, c + 6) <
    0
      ? -t
      : t;
  const u = 1 - t;
  let x = at(f, a + 3) * u + at(f, c + 3) * sign;
  let y = at(f, a + 4) * u + at(f, c + 4) * sign;
  let z = at(f, a + 5) * u + at(f, c + 5) * sign;
  let w = at(f, a + 6) * u + at(f, c + 6) * sign;
  const len = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  const r = b.remap;
  out[o + 4] = w * r[0] + x * r[3] + y * r[2] - z * r[1];
  out[o + 5] = w * r[1] - x * r[2] + y * r[3] + z * r[0];
  out[o + 6] = w * r[2] + x * r[1] - y * r[0] + z * r[3];
  out[o + 7] = w * r[3] - x * r[0] - y * r[1] - z * r[2];
}

/**
 * Creates a WebGL2 dice tray on a canvas, or on an absolutely positioned overlay canvas appended to
 * an element. Without WebGL2 `supported` is false and `playRoll` resolves immediately.
 */
export function createDiceTray(
  target: HTMLCanvasElement | HTMLElement,
  opts: TrayOptions = {},
): DiceTray {
  const own = !(target instanceof HTMLCanvasElement);
  const canvas = own ? document.createElement('canvas') : target;
  if (own) {
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    target.appendChild(canvas);
  }
  let dieScale = opts.dieScale ?? 2;
  const shadows = opts.shadows ?? true;
  const maxDpr = opts.maxDpr ?? 2;
  const fadeAfterMs = opts.fadeAfterMs ?? null;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
  });
  const labelFont = opts.labelFont ?? 'system-ui';
  /** Font of the atlas canvas; the atlas is rebuilt when the drawn skin resolves another font. */
  let atlasFont = resolveSkin(opts.skin).font ?? labelFont;
  let atlas = gl === null ? null : buildAtlas(atlasFont, opts.labels, labelFont);

  let traySkin = opts.skin;
  /** Skin requested by setSkin while the context was lost, already resolved; compiled on restore. */
  let lostSkin: { ref: SkinRef; gpu: SkinGpu } | null = null;
  let roll: Roll | null = null;
  let pending: { resolve: (s: RollSummary) => void; summary: RollSummary } | null = null;
  let disposed = false;
  let lost = false;
  let frame = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeStart = -1;
  let alpha = 1;
  let aspect = 1;
  const vp = new Float32Array(16);
  const shadowData = new Float32Array(MAX_BODIES * 4);
  const instances = new Map<LabelSet, Float32Array>(); // reused across rolls, one per label set

  // GPU resources, rebuilt lazily from CPU-side data (meshes, atlas canvas, shader sources).
  const programs = new Map<string, Program>();
  const meshes = new Map<ShapeType, WebGLBuffer>();
  const sets = new Map<LabelSet, { vao: WebGLVertexArrayObject; buf: WebGLBuffer }>();
  let shadowGpu: { vao: WebGLVertexArrayObject; quad: WebGLBuffer; buf: WebGLBuffer } | null = null;
  let atlasTex: WebGLTexture | null = null;

  /** Cached program for `key`; `fragment` is compiled with the die vertex shader on first use. */
  function program(g: WebGL2RenderingContext, key: string, fragment: string): Program {
    let p = programs.get(key);
    if (p === undefined) {
      const shadow = key === 'shadow';
      const prog = shadow
        ? createProgram(g, SHADOW_VERTEX, SHADOW_FRAGMENT)
        : createProgram(g, DIE_VERTEX, fragment);
      const u = new Map<string, WebGLUniformLocation | null>();
      for (const name of shadow ? ['uVP', 'uAlpha'] : DIE_UNIFORMS) {
        u.set(name, g.getUniformLocation(prog, name));
      }
      p = { program: prog, u };
      programs.set(key, p);
    }
    return p;
  }

  function setGpu(
    g: WebGL2RenderingContext,
    set: LabelSet,
  ): { vao: WebGLVertexArrayObject; buf: WebGLBuffer } {
    let s = sets.get(set);
    if (s === undefined) {
      const shape = shapeOf(set);
      let mesh = meshes.get(shape);
      if (mesh === undefined) {
        mesh = createBuffer(g, getDieMesh(shape).data);
        meshes.set(shape, mesh);
      }
      const vao = g.createVertexArray();
      g.bindVertexArray(vao);
      g.bindBuffer(g.ARRAY_BUFFER, mesh);
      attrib(g, 0, 3, MESH_STRIDE, 0, 0);
      attrib(g, 1, 3, MESH_STRIDE, 3, 0);
      attrib(g, 2, 3, MESH_STRIDE, 6, 0);
      const buf = createBuffer(g, MAX_BODIES * INST * 4);
      attrib(g, 3, 4, INST, 0, 1);
      attrib(g, 4, 4, INST, 4, 1);
      g.bindVertexArray(null);
      s = { vao, buf };
      sets.set(set, s);
    }
    return s;
  }

  function shadowRes(g: WebGL2RenderingContext): { vao: WebGLVertexArrayObject; buf: WebGLBuffer } {
    if (shadowGpu === null) {
      const vao = g.createVertexArray();
      g.bindVertexArray(vao);
      const quad = createBuffer(g, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
      attrib(g, 0, 2, 2, 0, 0);
      const buf = createBuffer(g, MAX_BODIES * 4 * 4);
      attrib(g, 1, 4, 4, 0, 1);
      g.bindVertexArray(null);
      shadowGpu = { vao, quad, buf };
    }
    return shadowGpu;
  }

  function atlasTexture(g: WebGL2RenderingContext): WebGLTexture {
    if (atlasTex === null) {
      atlasTex = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, atlasTex);
      // Premultiplied upload turns white-on-transparent glyphs into coverage in the red channel.
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (atlas === null) {
        g.texImage2D(g.TEXTURE_2D, 0, g.R8, 1, 1, 0, g.RED, g.UNSIGNED_BYTE, new Uint8Array(1));
      } else {
        g.texImage2D(g.TEXTURE_2D, 0, g.R8, g.RED, g.UNSIGNED_BYTE, atlas);
      }
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAX_LEVEL, ATLAS_MAX_LEVEL);
      g.generateMipmap(g.TEXTURE_2D);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
      const aniso = g.getExtension('EXT_texture_filter_anisotropic');
      if (aniso !== null) {
        const max = Number(g.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1;
        g.texParameterf(
          g.TEXTURE_2D,
          aniso.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(max, MAX_ANISOTROPY),
        );
      }
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    }
    return atlasTex;
  }

  /** Rebuilds the atlas canvas for `font` and releases the texture made from the previous one. */
  function atlasFor(g: WebGL2RenderingContext, font: string): void {
    if (font === atlasFont) return;
    atlasFont = font;
    atlas = buildAtlas(font, opts.labels, labelFont);
    if (atlasTex !== null) g.deleteTexture(atlasTex);
    atlasTex = null;
  }

  /** True when the skin's program compiles (or is cached); a failing skin is not cached. */
  function compiles(g: WebGL2RenderingContext, s: SkinGpu): boolean {
    try {
      program(g, s.key, s.fragment);
      return true;
    } catch {
      return false;
    }
  }

  /** Forgets every GPU handle; deletes them first when `remove` is set and the context is alive. */
  function dropGpu(g: WebGL2RenderingContext, remove: boolean): void {
    if (remove) {
      for (const p of programs.values()) g.deleteProgram(p.program);
      for (const b of meshes.values()) g.deleteBuffer(b);
      for (const s of sets.values()) {
        g.deleteVertexArray(s.vao);
        g.deleteBuffer(s.buf);
      }
      if (shadowGpu !== null) {
        g.deleteVertexArray(shadowGpu.vao);
        g.deleteBuffer(shadowGpu.quad);
        g.deleteBuffer(shadowGpu.buf);
      }
      if (atlasTex !== null) g.deleteTexture(atlasTex);
    }
    programs.clear();
    meshes.clear();
    sets.clear();
    shadowGpu = null;
    atlasTex = null;
  }

  /** Draws the current roll at its current step. Allocation-free once resources exist. */
  function render(): void {
    const g = gl;
    if (g === null || lost || disposed) return;
    g.viewport(0, 0, canvas.width, canvas.height);
    g.clearColor(0, 0, 0, 0);
    g.depthMask(true);
    g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    const r = roll;
    if (r === null) return;
    viewProjection(aspect, vp);
    const s = r.step;
    const scale = r.scale;
    let ns = 0;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- no iterator allocation per frame
    for (let i = 0; i < r.groups.length; i++) {
      const grp = r.groups[i];
      if (grp === undefined) continue;
      let n = 0;
      // eslint-disable-next-line @typescript-eslint/prefer-for-of -- no iterator allocation per frame
      for (let k = 0; k < grp.bodies.length; k++) {
        const b = grp.bodies[k];
        if (b === undefined || b.startStep > s) continue;
        const o = n * INST;
        writePose(b, s, b.value === null ? -1 : grp.row, grp.data, o);
        const h = at(grp.data, o + 1) * scale;
        const fade = 1 - h / 4;
        // Seen from straight above, a blob under the die is hidden; offset it as the light would.
        shadowData[ns * 4] = at(grp.data, o) * scale + h * SHADOW_X;
        shadowData[ns * 4 + 1] = at(grp.data, o + 2) * scale + h * SHADOW_Z;
        shadowData[ns * 4 + 2] = 1.3 * grp.radius * scale;
        shadowData[ns * 4 + 3] = 0.45 * (fade < 0 ? 0 : fade > 1 ? 1 : fade);
        n++;
        ns++;
      }
      grp.count = n;
    }
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

    if (shadows && ns > 0) {
      const p = program(g, 'shadow', SHADOW_FRAGMENT);
      const res = shadowRes(g);
      g.disable(g.DEPTH_TEST);
      g.disable(g.CULL_FACE);
      g.useProgram(p.program);
      g.uniformMatrix4fv(p.u.get('uVP') ?? null, false, vp);
      g.uniform1f(p.u.get('uAlpha') ?? null, alpha);
      g.bindBuffer(g.ARRAY_BUFFER, res.buf);
      g.bufferSubData(g.ARRAY_BUFFER, 0, shadowData, 0, ns * 4);
      g.bindVertexArray(res.vao);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, ns);
    }

    const k = r.skin;
    const p = program(g, k.key, k.fragment);
    const u = p.u;
    const f = k.u;
    const cam = cameraPosition();
    g.enable(g.DEPTH_TEST);
    g.enable(g.CULL_FACE);
    g.cullFace(g.BACK);
    atlasFor(g, k.font ?? labelFont);
    g.useProgram(p.program);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, atlasTexture(g));
    g.uniform1i(u.get('uAtlas') ?? null, 0);
    g.uniformMatrix4fv(u.get('uVP') ?? null, false, vp);
    g.uniform1f(u.get('uScale') ?? null, scale);
    g.uniform3f(u.get('uCam') ?? null, cam[0], cam[1], cam[2]);
    g.uniform3f(u.get('uBase') ?? null, at(f, 0), at(f, 1), at(f, 2));
    g.uniform3f(u.get('uBase2') ?? null, at(f, 3), at(f, 4), at(f, 5));
    g.uniform3f(u.get('uLabel') ?? null, at(f, 6), at(f, 7), at(f, 8));
    g.uniform3f(u.get('uMat') ?? null, at(f, 9), at(f, 10), at(f, 11));
    g.uniform1f(u.get('uAlpha') ?? null, alpha);
    if (k.transparent) {
      // Glass: back faces without depth writes, then front faces over them.
      g.depthMask(false);
      g.cullFace(g.FRONT);
      drawDice(g, r, true);
      g.depthMask(true);
      g.cullFace(g.BACK);
      drawDice(g, r, false);
    } else {
      drawDice(g, r, true);
    }
    g.bindVertexArray(null);
  }

  /** One instanced draw per label set; `upload` refreshes the instance buffers first. */
  function drawDice(g: WebGL2RenderingContext, r: Roll, upload: boolean): void {
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- no iterator allocation per frame
    for (let i = 0; i < r.groups.length; i++) {
      const grp = r.groups[i];
      if (grp === undefined || grp.count === 0) continue;
      const res = setGpu(g, grp.set);
      if (upload) {
        g.bindBuffer(g.ARRAY_BUFFER, res.buf);
        g.bufferSubData(g.ARRAY_BUFFER, 0, grp.data, 0, grp.count * INST);
      }
      g.bindVertexArray(res.vao);
      g.drawArraysInstanced(g.TRIANGLES, 0, getDieMesh(shapeOf(grp.set)).vertexCount, grp.count);
    }
  }

  function resolvePending(): void {
    const p = pending;
    pending = null;
    if (p !== null) p.resolve(p.summary);
  }

  function loop(): void {
    if (frame === 0 && !lost && !disposed) frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(fadeTimer);
    fadeTimer = undefined;
    fadeStart = -1;
    alpha = 1;
  }

  /** Shows the final frame, resolves the roll, and schedules the fade. */
  function settle(r: Roll): void {
    r.step = r.plan.totalSteps;
    r.done = true;
    render();
    resolvePending();
    if (fadeAfterMs === null) return;
    fadeTimer = setTimeout(() => {
      fadeTimer = undefined;
      fadeStart = performance.now();
      loop();
    }, fadeAfterMs);
  }

  function tick(): void {
    frame = 0;
    const r = roll;
    if (r === null) return;
    const now = performance.now();
    if (!r.done) {
      const s = (now - r.t0) / 1000 / DT;
      if (s >= r.plan.totalSteps) {
        settle(r);
        return;
      }
      r.step = s < 0 ? 0 : s;
    } else if (fadeStart >= 0) {
      alpha = 1 - (now - fadeStart) / FADE_MS;
      if (alpha <= 0) {
        tray.clear();
        return;
      }
    } else {
      return;
    }
    render();
    frame = requestAnimationFrame(tick);
  }

  /** Reads the CSS size; resizes the drawing buffer only when the device-pixel size changed. */
  function fit(): void {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw <= 0 || ch <= 0) {
      aspect = 1;
      return;
    }
    aspect = cw / ch;
    const dpr = Math.min(devicePixelRatio, maxDpr);
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function reduced(): boolean {
    const mode = opts.reducedMotion ?? 'auto';
    return (
      mode === 'always' ||
      (mode === 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    );
  }

  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (gl !== null) dropGpu(gl, false);
    // The outcome is known; the dice redraw when the context is restored.
    resolvePending();
  };
  const onRestored = (): void => {
    lost = false;
    const g = gl;
    const r = roll;
    if (g !== null) {
      // Skins chosen while lost compile now; a failing one is dropped for the previous valid skin.
      const want = lostSkin;
      lostSkin = null;
      if (want !== null && compiles(g, want.gpu)) {
        traySkin = want.ref;
        if (r !== null && r.eventSkin === undefined) r.skin = want.gpu;
      }
      if (r !== null && !compiles(g, r.skin)) {
        r.skin = skinGpu(resolveSkin(traySkin));
        if (!compiles(g, r.skin)) r.skin = skinGpu(resolveSkin(undefined));
      }
    }
    if (r !== null && (!r.done || fadeStart >= 0)) loop();
    else render();
  };
  let observer: ResizeObserver | null = null;

  const tray: DiceTray = {
    supported: gl !== null,

    async playRoll(event: RollEvent): Promise<RollSummary> {
      const summary = evaluate(event);
      if (disposed || gl === null) return summary;
      // Compile first: a skin whose shader fails rejects here and leaves the current roll alone.
      // While lost the skin compiles on restore, falling back to the tray skin if it fails.
      const skin = skinGpu(resolveSkin(event.skin ?? traySkin));
      if (!lost) program(gl, skin.key, skin.fragment);
      stop();
      resolvePending();
      fit();
      const scale = fitScale(dieScale, slots(event).length, aspect);
      const plan = planRoll(event, trayBounds(aspect, scale));
      const groups: Group[] = [];
      LABEL_SETS.forEach((set, row) => {
        const bodies = plan.bodies.filter((b) => b.labelSet === set);
        if (bodies.length === 0) return;
        const radius = getPolyhedron(shapeOf(set)).radius;
        let data = instances.get(set);
        if (data === undefined) {
          data = new Float32Array(MAX_BODIES * INST);
          instances.set(set, data);
        }
        groups.push({ set, row, bodies, radius, data, count: 0 });
      });
      const r: Roll = {
        plan,
        groups,
        eventSkin: event.skin,
        skin,
        scale,
        t0: performance.now(),
        step: 0,
        done: false,
      };
      roll = r;
      const done = new Promise<RollSummary>((resolve) => {
        pending = { resolve, summary };
      });
      // While lost the outcome resolves now; the dice draw on restore if this roll is still current.
      if (reduced() || lost) settle(r);
      else loop();
      return done;
    },

    setSkin(skin: SkinRef): void {
      if (gl !== null && !disposed) {
        // Resolve before storing: a skin that cannot be resolved throws here, never on restore.
        const s = skinGpu(resolveSkin(skin));
        if (lost) {
          lostSkin = { ref: skin, gpu: s };
          return;
        }
        // Throws PollyrollShaderError before anything changes, so the tray keeps its skin.
        program(gl, s.key, s.fragment);
        const r = roll;
        if (r !== null && r.eventSkin === undefined) {
          r.skin = s;
          if (frame === 0) render();
        }
      }
      traySkin = skin;
    },

    setDieScale(scale: number): void {
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new RangeError(`dieScale must be a positive finite number, got ${scale}`);
      }
      dieScale = scale;
    },

    clear(): void {
      stop();
      roll = null;
      resolvePending();
      render();
    },

    resize(): void {
      fit();
      render();
    },

    dispose(): void {
      if (disposed) return;
      stop();
      roll = null;
      resolvePending();
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      observer?.disconnect();
      observer = null;
      if (gl !== null) dropGpu(gl, !lost && !gl.isContextLost());
      if (own) canvas.remove();
    },
  };

  if (gl !== null) {
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    observer = new ResizeObserver(() => tray.resize());
    observer.observe(canvas);
    fit();
    render();
  }
  return tray;
}
