import { getPolyhedron } from './polyhedra';
import type { Polyhedron, ShapeType } from './polyhedra';
import { add, cross, dot, length, normalize, scale, sub } from './vec';
import type { Vec3 } from './vec';

export const BEVEL = 0.08;
export const MESH_STRIDE = 9; // floats per vertex: px py pz, nx ny nz, lu lv, cell

export interface DieMesh {
  shape: ShapeType;
  data: Float32Array;
  vertexCount: number;
}

const EPS = 1e-9;

/** Label frame on a face plane: square center, side, right and up unit vectors, readout cell. */
interface Label {
  center: Vec3;
  side: number;
  right: Vec3;
  up: Vec3;
  cell: number;
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[(i + list.length) % list.length];
  if (v === undefined) throw new RangeError(`index ${i} out of range`);
  return v;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}

function centroid(points: readonly Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const p of points) c = add(c, p);
  return scale(c, 1 / points.length);
}

/** Face polygon inset in its plane by BEVEL (same vertex order as the face). */
function insetFace(poly: Polyhedron, f: number): Vec3[] {
  const face = at(poly.faces, f);
  const n = at(poly.normals, f);
  const pts = face.map((i) => at(poly.vertices, i));
  return pts.map((v, k) => {
    const m1 = cross(n, normalize(sub(v, at(pts, k - 1))));
    const m2 = cross(n, normalize(sub(at(pts, k + 1), v)));
    return add(v, scale(add(m1, m2), BEVEL / (1 + dot(m1, m2))));
  });
}

/** Minimum distance from c to the lines through consecutive polygon points. */
function inradius(c: Vec3, pts: readonly Vec3[]): number {
  let r = Infinity;
  pts.forEach((a, k) => {
    const e = normalize(sub(at(pts, k + 1), a));
    const d = sub(c, a);
    r = Math.min(r, length(sub(d, scale(e, dot(d, e)))));
  });
  return r;
}

function labelFrame(center: Vec3, side: number, upDir: Vec3, n: Vec3, cell: number): Label {
  const up = normalize(upDir);
  return { center, side, up, right: cross(up, n), cell };
}

/** Reading "up" for a full-face label: d6-like squares point at the (0, 1) edge midpoint,
 *  everything else at the farthest vertex (ties → earliest). */
function faceUp(c: Vec3, pts: readonly Vec3[]): Vec3 {
  const dist = pts.map((p) => length(sub(p, c)));
  const max = Math.max(...dist);
  const min = Math.min(...dist);
  if (pts.length === 4 && max - min <= EPS) return sub(midpoint(at(pts, 0), at(pts, 1)), c);
  const k = dist.findIndex((d) => d >= max - EPS);
  return sub(at(pts, k), c);
}

function build(shape: ShapeType): DieMesh {
  const poly = getPolyhedron(shape);
  const out: number[] = [];
  const emit = (p: Vec3, n: Vec3, label: Label | null): void => {
    out.push(p[0], p[1], p[2], n[0], n[1], n[2]);
    if (label === null) {
      out.push(-1, -1, -1);
      return;
    }
    const d = sub(p, label.center);
    out.push(
      dot(d, label.right) / label.side + 0.5,
      dot(d, label.up) / label.side + 0.5,
      label.cell,
    );
  };
  const tri = (a: Vec3, b: Vec3, c: Vec3, n: Vec3, label: Label | null): void => {
    emit(a, n, label);
    emit(b, n, label);
    emit(c, n, label);
  };

  const insets = poly.faces.map((_, f) => insetFace(poly, f));

  // Faces: label fans (d4: three corner quads per face).
  poly.faces.forEach((face, f) => {
    const n = at(poly.normals, f);
    const pts = at(insets, f);
    const c = centroid(pts);
    const r = inradius(c, pts);
    if (shape === 'd4') {
      pts.forEach((v, k) => {
        const next = midpoint(v, at(pts, k + 1));
        const prev = midpoint(at(pts, k - 1), v);
        // Largest glyph box (0.8 × 0.875 of the side) that fits the corner kite: k ≤ 2 / (0.8 + 0.4375 · 4/√3).
        const label = labelFrame(
          add(c, scale(sub(v, c), 0.36)),
          1.1 * r,
          sub(v, c),
          n,
          at(face, k),
        );
        tri(v, next, c, n, label);
        tri(v, c, prev, n, label);
      });
      return;
    }
    const label = labelFrame(c, 1.45 * r, faceUp(c, pts), n, f);
    pts.forEach((v, k) => tri(c, v, at(pts, k + 1), n, label));
  });

  /** Face index holding the directed edge a → b, and the position of a in it. */
  const findEdge = (a: number, b: number): [number, number] => {
    for (let g = 0; g < poly.faces.length; g++) {
      const face = at(poly.faces, g);
      const k = face.indexOf(a);
      if (k >= 0 && at(face, k + 1) === b) return [g, k];
    }
    throw new Error(`${shape} has no face with edge ${a} → ${b}`);
  };

  // Edge strips between the inset edges of the two faces sharing each hull edge.
  poly.faces.forEach((face, f) => {
    const nf = at(poly.normals, f);
    const pf = at(insets, f);
    face.forEach((a, k) => {
      const b = at(face, k + 1);
      if (a > b) return;
      const [g, j] = findEdge(b, a);
      const ng = at(poly.normals, g);
      const pg = at(insets, g);
      const aF = at(pf, k);
      const bF = at(pf, k + 1);
      const bG = at(pg, j);
      const aG = at(pg, j + 1);
      emit(aF, nf, null);
      emit(aG, ng, null);
      emit(bG, ng, null);
      emit(aF, nf, null);
      emit(bG, ng, null);
      emit(bF, nf, null);
    });
  });

  // Corner caps: walk the faces around each hull vertex counter-clockwise from outside.
  poly.vertices.forEach((_, v) => {
    const start = poly.faces.findIndex((face) => face.includes(v));
    const ring: [Vec3, Vec3][] = [];
    let f = start;
    do {
      const face = at(poly.faces, f);
      const k = face.indexOf(v);
      ring.push([at(at(insets, f), k), at(poly.normals, f)]);
      f = findEdge(v, at(face, k - 1))[0];
    } while (f !== start && ring.length <= poly.faces.length);
    const [p0, n0] = at(ring, 0);
    for (let i = 1; i + 1 < ring.length; i++) {
      const [p1, n1] = at(ring, i);
      const [p2, n2] = at(ring, i + 1);
      emit(p0, n0, null);
      emit(p1, n1, null);
      emit(p2, n2, null);
    }
  });

  return { shape, data: new Float32Array(out), vertexCount: out.length / MESH_STRIDE };
}

const cache: Partial<Record<ShapeType, DieMesh>> = {};

/** Non-indexed triangle list, CCW from outside, cached per shape. */
export function getDieMesh(shape: ShapeType): DieMesh {
  let mesh = cache[shape];
  if (mesh === undefined) {
    mesh = build(shape);
    cache[shape] = mesh;
  }
  return mesh;
}
