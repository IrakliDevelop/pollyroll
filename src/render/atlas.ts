import { getPolyhedron } from '../geometry/polyhedra';
import { labelIndex, labelText, labelUnderline, shapeOf } from '../geometry/labels';
import type { LabelSet } from '../geometry/labels';
import { ATLAS_COLUMNS, ATLAS_ROWS } from './shaders';

export const CELL = 128;
/** Minimum empty border around every glyph, px; the tray's deepest atlas mip level relies on it. */
const PAD = 8;
/** Deepest atlas mip: its texels are PAD px, so no mip or bilinear tap reaches a neighbouring
 *  cell's glyph. */
export const ATLAS_MAX_LEVEL = Math.log2(PAD);
/** Glyph block (ink plus any underline) fits this height and the padded cell width. */
const INK_HEIGHT = 0.8 * CELL;
const INK_WIDTH = CELL - 2 * PAD;
/** Font size used to measure a label before scaling it to fit. */
const PROBE = 100;

/** Atlas row order: one row per label set. */
export const LABEL_SETS: readonly LabelSet[] = [
  'd4',
  'd6',
  'd8',
  'd10',
  'd12',
  'd20',
  'd100tens',
  'd100ones',
  'dF',
];

export type CustomLabels = Partial<Record<LabelSet, readonly string[]>>;

/** Always-parsable font set before a probe; never equal to a bold probe font once serialized. */
const SENTINEL = '10px serif';

/**
 * First of `fonts` the context accepts. An unparsable assignment leaves `ctx.font` unchanged, so a
 * font is rejected when the sentinel set just before it is still in place.
 */
function pickFont(ctx: CanvasRenderingContext2D, fonts: readonly string[]): string {
  for (const font of fonts) {
    ctx.font = SENTINEL;
    const sentinel = ctx.font;
    ctx.font = `bold ${PROBE}px ${font}`;
    if (ctx.font !== sentinel) return font;
  }
  return 'system-ui';
}

/**
 * Canvas2D glyph atlas: ATLAS_COLUMNS × ATLAS_ROWS cells of CELL px, row = label set, column =
 * readout index; custom labels are looked up by natural label index (`labelIndex`); bold glyphs
 * white on transparent, ink centered and scaled to 0.8 of the cell height or the padded cell width,
 * 6/9 underlined where the set requires it (default labels only).
 * Draws with `font`, or `fallback`, then 'system-ui', when the context cannot parse it.
 * Returns null when no 2D context is available.
 */
export function buildAtlas(
  requested: string,
  labels: CustomLabels = {},
  fallback = 'system-ui',
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const font = pickFont(ctx, [requested, fallback, 'system-ui']);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  LABEL_SETS.forEach((set, row) => {
    const count = getPolyhedron(shapeOf(set)).readouts.length;
    for (let i = 0; i < count; i++) {
      const custom = labels[set]?.[labelIndex(set, i)];
      const text = custom ?? labelText(set, i);
      if (text === '') continue;
      const underline = custom === undefined && labelUnderline(set, i);
      ctx.font = `bold ${PROBE}px ${font}`;
      const probe = ctx.measureText(text);
      // Underline: a gap and a bar of 0.08 × font size each below the ink.
      const blockH =
        probe.actualBoundingBoxAscent +
        probe.actualBoundingBoxDescent +
        (underline ? 0.16 * PROBE : 0);
      const inkW = probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight;
      if (blockH <= 0 || inkW <= 0) continue;
      const size = PROBE * Math.min(INK_HEIGHT / blockH, INK_WIDTH / inkW);
      ctx.font = `bold ${size}px ${font}`;
      const m = ctx.measureText(text);
      const ascent = m.actualBoundingBoxAscent;
      const descent = m.actualBoundingBoxDescent;
      const height = ascent + descent + (underline ? 0.16 * size : 0);
      const cx = (i + 0.5) * CELL + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
      const baseline = (row + 0.5) * CELL - height / 2 + ascent;
      ctx.fillText(text, cx, baseline);
      if (underline) {
        const half = Math.max(m.actualBoundingBoxLeft + m.actualBoundingBoxRight, 0.4 * size) / 2;
        ctx.fillRect(cx - half, baseline + descent + 0.08 * size, 2 * half, 0.08 * size);
      }
    }
  });
  return canvas;
}
