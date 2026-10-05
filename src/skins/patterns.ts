import type { PatternName } from './types';

/**
 * Noise helpers shared by every die program: a PCG-style uvec3 integer hash (identical on every
 * GPU, unlike a sin hash), trilinear value noise, and four-octave fbm. Cell coordinates are offset
 * to stay positive before the uint conversion.
 */
export const NOISE = `uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(vec3 c) {
  return vec3(pcg3(uvec3(c + 4096.0))) / 4294967296.0;
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(1.0, 0.0);
  return mix(
    mix(mix(hash3(i).x, hash3(i + e.xyy).x, f.x), mix(hash3(i + e.yxy).x, hash3(i + e.xxy).x, f.x), f.y),
    mix(mix(hash3(i + e.yyx).x, hash3(i + e.xyx).x, f.x), mix(hash3(i + e.yxx).x, hash3(i + e.xxx).x, f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float w = 0.5;
  for (int k = 0; k < 4; k++) {
    s += w * vnoise(p);
    p = p * 2.03 + 1.7;
    w *= 0.5;
  }
  return s;
}
`;

const SIGNATURE = 'vec3 pattern(vec3 p, vec3 n, vec3 a, vec3 b) {';

/**
 * Built-in patterns implementing the custom pattern contract: object-space position `p`, object
 * normal `n`, and the skin's two linear colors `a` and `b` (equal for a single color) → base color.
 */
export const PATTERNS: Record<PatternName, string> = {
  none: `${SIGNATURE} return a; }`,
  gradient: `${SIGNATURE} return mix(a, b, smoothstep(-0.8, 0.8, p.y)); }`,
  speckle: `${SIGNATURE}
  vec3 q = p * 14.0;
  vec3 h = hash3(floor(q));
  float d = length(fract(q) - 0.25 - 0.5 * h);
  return mix(a, b, step(h.x, 0.5) * (1.0 - smoothstep(0.12, 0.2, d)));
}`,
  marble: `${SIGNATURE}
  float t = fbm(p * 2.5);
  float v = abs(fract(p.x * 0.9 + p.y * 0.6 + 2.5 * t) - 0.5) * 2.0;
  return mix(mix(a, b, 0.5 * t), b, 1.0 - smoothstep(0.0, 0.12, v));
}`,
  wood: `${SIGNATURE}
  float ring = fract(length(p.xz) * 9.0 + 2.0 * fbm(p * vec3(2.0, 0.4, 2.0)));
  float grain = vnoise(p * vec3(40.0, 2.0, 40.0));
  return mix(a, b, clamp(ring * ring + 0.2 * grain, 0.0, 1.0));
}`,
  swirl: `${SIGNATURE}
  float t = atan(p.z, p.x) * 0.4774648 + length(p.xz) * 2.5 + p.y * 0.6;
  return mix(a, b, smoothstep(0.3, 0.7, abs(fract(t) - 0.5) * 2.0));
}`,
};
