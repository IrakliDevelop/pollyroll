/** GLSL ES 3.00 sources. Attribute locations are fixed by layout qualifiers. */
import { NOISE } from '../skins/patterns';
import type { LabelStyle } from '../skins/types';

export const ATLAS_COLUMNS = 20;
export const ATLAS_ROWS = 9;
/** Unit direction toward the key light, world space. */
export const LIGHT_DIR = [-0.5, 0.7071, -0.5] as const;

/** Die vertex: mesh (pos, normal, label lu/lv/cell) + instance (position.xyz, atlas row; quaternion). */
export const DIE_VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aLabel;
layout(location=3) in vec4 aInst;
layout(location=4) in vec4 aQuat;
uniform mat4 uVP;
uniform float uScale;
out vec3 vObj;
out vec3 vObjN;
out vec3 vN;
out vec3 vW;
out vec2 vUV;
flat out vec2 vCell;
vec3 rot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
void main() {
  vObj = aPos;
  vObjN = aNormal;
  vN = rot(aQuat, aNormal);
  vW = (rot(aQuat, aPos) + aInst.xyz) * uScale;
  vUV = aLabel.xy;
  vCell = aLabel.z < 0.0 || aInst.w < 0.0 ? vec2(-1.0) : vec2(aLabel.z, aInst.w);
  gl_Position = uVP * vec4(vW, 1.0);
}
`;

/** Bump from atlas coverage: height h = H·a, N' = N − ∇h (surface gradient from screen derivatives). */
const bump = (h: string, shade: string): string => `vec3 r1 = cross(dpy, N);
    vec3 r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    N = normalize(abs(det) * N - sign(det) * ${h} * (da.x * r1 + da.y * r2));
    base = mix(base, uLabel, a) * (1.0 ${shade} 0.15 * a);`;

/** Label blending per label style: engraved sinks the glyph and darkens it, embossed raises it. */
const LABEL: Record<LabelStyle, string> = {
  printed: 'base = mix(base, uLabel, a);',
  engraved: bump('-0.02', '-'),
  embossed: bump('0.02', '+'),
};

/** Gem glints: object-space cells whose jittered facet normal reflects the key light at the eye. */
const SPARKLE = `vec3 h = hash3(floor(vObj * 10.0));
    vec3 Rj = reflect(-V, normalize(N + (h - 0.5) * 0.8));
    hl += step(0.8, h.x) * pow(max(dot(Rj, LIGHT_DIR), 0.0), 12.0) * 6.0;`;

/** Glass: absorption tint base^(k·path) with path = 1 − N·V, so the body darkens toward the
 *  silhouette; gem uses a deeper tint, sharper highlight, and glints. */
const glass = (gem: boolean): string => `float fr = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  float path = 1.0 - nv;
  vec3 tint = pow(max(base, vec3(1e-4)), vec3(${gem ? '0.9' : '0.6'} + ${gem ? '1.6' : '1.4'} * path));
  vec3 g = env(refract(-V, N, 1.0 / 1.5), 0.0) * tint * ${gem ? '3.0' : '4.0'};
  if (gl_FrontFacing) {
    vec3 hl = (spec(N, V, LIGHT_DIR, vec3(0.04), ${gem ? '0.12' : '0.18'}) * 2.0
      + spec(N, V, LIGHT_DIR, vec3(0.04), 0.4)) * LIGHT * nl
      + fr * env(R, 0.0) * 2.0 + vec3(pow(path, 3.0) * ${gem ? '0.8' : '1.6'});
    ${gem ? SPARKLE : ''}
    g += hl;
    al = max(mix(${gem ? '0.35' : '0.12'}, ${gem ? '0.9' : '0.85'}, path), clamp(dot(hl, vec3(0.5)), 0.0, 1.0));
  } else {
    al = mix(${gem ? '0.8' : '0.6'}, ${gem ? '0.95' : '0.85'}, path);
  }
  c = mix(g, c, lab);
  al = mix(al, 1.0, lab);`;

/** Material kind of a die program: opaque, glass, or gem (glass with deeper tint and sparkle). */
export type DieKind = 'opaque' | 'glass' | 'gem';

/**
 * Die fragment for a feature set: label style, material kind, and the `pattern` GLSL function.
 * Glass and gem output Fresnel-weighted alpha with a refraction tint; labels stay opaque.
 */
export function dieFragment(label: LabelStyle, kind: DieKind, pattern: string): string {
  const flat = label === 'printed';
  return `#version 300 es
precision highp float;
in vec3 vObj;
in vec3 vObjN;
in vec3 vN;
in vec3 vW;
in vec2 vUV;
flat in vec2 vCell;
uniform vec3 uCam;
uniform vec3 uBase;
uniform vec3 uBase2;
uniform vec3 uLabel;
uniform vec3 uMat;
uniform float uAlpha;
uniform sampler2D uAtlas;
out vec4 oColor;
const float PI = 3.14159265;
const vec3 LIGHT_DIR = vec3(${LIGHT_DIR.join(', ')});
const vec3 LIGHT = vec3(3.2);
const vec3 SKY = vec3(0.42, 0.44, 0.48);
const vec3 GROUND = vec3(0.26, 0.24, 0.22);
const float EXPOSURE = 0.55;
${NOISE}
${pattern}
vec3 hemi(vec3 d) {
  return mix(GROUND, SKY, d.y * 0.5 + 0.5);
}
vec3 env(vec3 d, float r) {
  return mix(mix(GROUND, SKY, smoothstep(-0.2, 0.2, d.y)), hemi(d), r);
}
vec3 fresnel(vec3 f0, float c) {
  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
}
vec3 spec(vec3 N, vec3 V, vec3 L, vec3 f0, float r) {
  vec3 H = normalize(V + L);
  float nl = max(dot(N, L), 0.001);
  float nv = max(dot(N, V), 0.001);
  float nh = max(dot(N, H), 0.0);
  float a = r * r;
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float k = (r + 1.0) * (r + 1.0) / 8.0;
  float G = nv / (nv * (1.0 - k) + k) * nl / (nl * (1.0 - k) + k);
  return D * G * fresnel(f0, max(dot(V, H), 0.0)) / (4.0 * nv * nl);
}
void main() {
  vec3 base = pattern(vObj, normalize(vObjN), uBase, uBase2);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  // Sample and differentiate in uniform control flow; apply inside the branch.
  vec2 uv = clamp(vUV, 0.0, 1.0);
  vec2 cell = max(vCell, 0.0);
  float a = texture(uAtlas, vec2((cell.x + uv.x) / ${ATLAS_COLUMNS}.0, (cell.y + 1.0 - uv.y) / ${ATLAS_ROWS}.0)).r;
  ${flat ? '' : 'vec3 dpx = dFdx(vW);\n  vec3 dpy = dFdy(vW);\n  vec2 da = vec2(dFdx(a), dFdy(a));'}
  float lab = 0.0;
  if (vCell.x >= 0.0 && uv == vUV && gl_FrontFacing) {
    lab = a;
    ${LABEL[label]}
  }
  // Label fill is dielectric paint: on metal it stays dark instead of mirroring the environment.
  float m = uMat.x * (1.0 - min(2.0 * lab, 1.0));
  float r = uMat.y;
  float cc = uMat.z;
  vec3 V = normalize(uCam - vW);
  vec3 R = reflect(-V, N);
  float nl = max(dot(N, LIGHT_DIR), 0.0);
  float nv = max(dot(N, V), 0.001);
  vec3 f0 = mix(vec3(0.04), base, m);
  vec3 F = fresnel(f0, max(dot(V, normalize(V + LIGHT_DIR)), 0.0));
  vec3 c = ((1.0 - F) * (1.0 - m) * base / PI + spec(N, V, LIGHT_DIR, f0, r)) * LIGHT * nl;
  vec3 Fa = fresnel(f0, nv) * (1.0 - r * 0.5);
  c += (1.0 - Fa) * (1.0 - m) * base * hemi(N) + Fa * env(R, r);
  if (cc > 0.0) {
    float fc = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
    c = c * (1.0 - cc * fc) + cc * (spec(N, V, LIGHT_DIR, vec3(0.04), 0.15) * LIGHT * nl + fc * env(R, 0.15));
  }
  c *= 1.0 - 0.7 * lab * uMat.x;
  float al = 1.0;
  ${kind === 'opaque' ? '' : glass(kind === 'gem')}
  c *= EXPOSURE;
  c = clamp(c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  c = pow(c, vec3(1.0 / 2.2));
  al *= uAlpha;
  oColor = vec4(c * al, al);
}
`;
}

/** Blob shadow vertex: unit quad corner + instance (x, z, radius, alpha), world units. */
export const SHADOW_VERTEX = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aShadow;
uniform mat4 uVP;
out vec2 vC;
out float vA;
void main() {
  vC = aCorner;
  vA = aShadow.w;
  gl_Position = uVP * vec4(aShadow.x + aCorner.x * aShadow.z, 0.001, aShadow.y + aCorner.y * aShadow.z, 1.0);
}
`;

export const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vC;
in float vA;
uniform float uAlpha;
out vec4 oColor;
void main() {
  float a = vA * uAlpha * (1.0 - smoothstep(0.0, 1.0, length(vC)));
  oColor = vec4(0.0, 0.0, 0.0, a);
}
`;
