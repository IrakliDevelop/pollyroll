import { getPolyhedron } from '../geometry/polyhedra';
import { labelText, labelUnderline, shapeOf } from '../geometry/labels';
import type { LabelSet } from '../geometry/labels';
import { ATLAS_COLUMNS, ATLAS_ROWS } from './shaders';

export const CELL = 128;

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

/**
 * Canvas2D glyph atlas: ATLAS_COLUMNS × ATLAS_ROWS cells of CELL px, row = label set, column =
 * readout index; glyphs white on transparent, centered, 6/9 underlined where the set requires it.
 * Returns null when no 2D context is available.
 */
export function buildAtlas(font: string, labels: CustomLabels = {}): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const base = 0.62 * CELL;
  LABEL_SETS.forEach((set, row) => {
    const custom = labels[set];
    const count = getPolyhedron(shapeOf(set)).readouts.length;
    for (let i = 0; i < count; i++) {
      const text = custom?.[i] ?? labelText(set, i);
      if (text === '') continue;
      let size = base;
      ctx.font = `bold ${size}px ${font}`;
      const width = ctx.measureText(text).width;
      if (width > 0.8 * CELL) {
        size *= (0.8 * CELL) / width;
        ctx.font = `bold ${size}px ${font}`;
      }
      const m = ctx.measureText(text);
      const cx = (i + 0.5) * CELL;
      const cy = (row + 0.5) * CELL;
      ctx.fillText(text, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
      if (custom?.[i] === undefined && labelUnderline(set, i)) {
        const half = Math.max(m.width, 0.4 * size) / 2;
        ctx.fillRect(
          cx - half,
          cy + m.actualBoundingBoxAscent / 2 + 0.08 * size,
          2 * half,
          0.08 * size,
        );
      }
    }
  });
  return canvas;
}
