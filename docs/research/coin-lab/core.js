// DOM-free audio core: flip timelines, modal coin synth, sample mixing. Shared by the page and the Node checks.
const SR = 48000;
const DEFAULTS = {
  pitch: 4.9, ringMs: 60, split: 2.2, bright: 1, knockDb: -12, knock: 1.2,
  wobbleMs: 600, wobbleDb: -12, endRate: 140, blendDb: -4, blendMs: 25, contact: 3, bodyDb: 0, bodyMs: 12, surface: 'wood', flick: false,
};
// Mode ratios and levels fitted to single clinks in Kenney's handleCoins (4.9, 8.5, 13.2, 17.5 kHz).
const RATIOS = [1, 1.73, 2.72, 3.57];
const LEVELS = [1, 0.55, 0.35, 0.2];
// Wooden table modes fitted to the €2 coin (BigSoundBank) and the table drop (OpenGameArt): 0.6–2.4 kHz.
const TABLE = [610, 980, 1240, 1600, 1750, 2060, 2340];

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const db = (d) => Math.pow(10, d / 20);

// One coin thrown into the tray: landing, bounces that shrink, then an Euler-disk wobble whose contact rate climbs until it lies flat.
function flip(P, sc, seed, t0) {
  const r = rng(seed), ev = [];
  if (P.flick) ev.push({ t: t0 - 0.42, s: 0.7, kind: 'air' });
  ev.push({ t: t0, s: 1, kind: 'land' });
  let t = t0, gap = 0.08 + 0.03 * r(), s = 0.5;
  for (let i = 0; i < sc.bounces; i++) { t += gap; ev.push({ t, s: s * (0.8 + 0.4 * r()), kind: 'bounce' }); gap *= 0.62; s *= 0.5; }
  const T = (P.wobbleMs / 1000) * sc.wobble;
  if (T > 0.02) {
    const start = t + gap, r0 = 16, ws = db(P.wobbleDb);
    let phase = 0;
    for (let k = 0; k < T * 1000; k++) {
      const u = k / 1000 / T;
      phase += Math.min(P.endRate, r0 * Math.pow(1 - u, -1 / 3)) / 1000;
      if (phase >= 1) { phase -= 1; ev.push({ t: start + u * T, s: ws * (0.4 + 0.6 * (1 - u)) * (0.75 + 0.5 * r()), kind: 'wobble' }); }
    }
    ev.push({ t: start + T, s: 0.3, kind: 'flat' });
  } else {
    ev.push({ t: t + gap, s: 0.12, kind: 'flat' });
  }
  return ev;
}

function timeline(P, sc) {
  const ev = sc.coins.flatMap((c, i) => flip(P, { ...sc, wobble: sc.wobble * c.wobble }, sc.seed + i * 7919, c.at));
  const first = Math.min(...ev.map((e) => e.t));
  for (const e of ev) e.t += 0.05 - first;
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

const RING = { air: 6, land: 1, bounce: 1, wobble: 0.45, flat: 0.12 };

// Damped resonator recursion: y[i] = 2·d·cos(w)·y[i-1] − d²·y[i-2] gives d^i·sin(w·i + ph) without a sin per sample.
function ring(out, i0, f, amp, tau, ph) {
  if (f > 0.45 * SR) return;
  const w = (2 * Math.PI * f) / SR, n = Math.min(Math.round(5 * tau * SR), out.length - i0);
  const d = Math.exp(-1 / (tau * SR)), c1 = 2 * d * Math.cos(w), c2 = d * d, att = 0.0003 * SR;
  let y1 = Math.sin(ph - w) / d, y2 = Math.sin(ph - 2 * w) / (d * d);
  for (let i = 0; i < n; i++) { const y = c1 * y1 - c2 * y2; y2 = y1; y1 = y; out[i0 + i] += amp * Math.min(1, i / att) * y; }
}
// A soft surface keeps the coin in contact longer, so the strike excites little above 1/(contact time): a 4th-order roll-off.
const excite = (f, P) => (P.surface === 'hard' ? 1 : 1 / Math.sqrt(1 + Math.pow(f / (P.contact * 1000), 4)));

// Modal synthesis: each coin mode is a split doublet of damped sines (the shimmer of a real coin); on wood the table's own modes carry most of the sound.
function synthHit(out, e, P, r) {
  const i0 = Math.round(e.t * SR), felt = P.surface === 'felt', air = e.kind === 'air';
  const tauMul = RING[e.kind] * (felt ? 0.35 : 1);
  RATIOS.forEach((ratio, k) => {
    const f0 = P.pitch * 1000 * ratio;
    const amp = LEVELS[k] * Math.pow(P.bright, k) * Math.pow(e.s, 1 + 0.25 * k) * (air ? 1 : excite(f0, P));
    const tau = ((P.ringMs / 1000) * tauMul) / Math.pow(ratio, 0.8);
    for (const side of [-1, 1]) ring(out, i0, f0 * (1 + (side * P.split) / 200), amp / 2, tau, 2 * Math.PI * r());
  });
  if (air) return;
  if (P.surface === 'wood') {
    const g = e.s * db(P.bodyDb);
    for (const f of TABLE) ring(out, i0, f * (0.98 + 0.04 * r()), g * (0.3 + 0.7 * r()) * excite(f, P), P.bodyMs / 1000, 2 * Math.PI * r());
  }
  // RBJ band-pass biquad on white noise: the click of the strike itself.
  const fk = P.knock * 1000 * (felt ? 0.5 : 1), Q = 1.5, w0 = (2 * Math.PI * fk) / SR, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
  const b0 = al / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - al) / a0;
  const tau = (felt ? 4 : 2.5) / 1000, n = Math.min(Math.round(8 * tau * SR), out.length - i0), g = 3 * e.s * db(P.knockDb - (felt ? 6 : 0));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, env = 1; const decay = Math.exp(-1 / (tau * SR));
  for (let i = 0; i < n; i++) {
    const x = (r() * 2 - 1) * env; env *= decay;
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i0 + i] += g * y;
  }
}

// Two cascaded RBJ low-passes (4th order) at the contact cutoff: what a clink would keep if the coin hit wood instead of another coin.
const softened = new Map();
function soften(x, P) {
  const key = `${P.contact}`;
  let cache = softened.get(x); if (!cache) softened.set(x, (cache = new Map()));
  if (cache.has(key)) return cache.get(key);
  const w0 = (2 * Math.PI * P.contact * 1000) / SR, al = Math.sin(w0) / Math.SQRT2, a0 = 1 + al, cw = Math.cos(w0);
  const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, a1 = (-2 * cw) / a0, a2 = (1 - al) / a0;
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const z = new Float32Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; z[i] = v; }
    y = z;
  }
  y = normalize(y);
  cache.set(key, y);
  return y;
}

// Plays sample x into out at time t with linear-interpolated resampling; maxSec cuts it short with a 3 ms fade.
function mix(out, x, t, gain, rate, maxSec) {
  const i0 = Math.round(t * SR), fade = Math.round(0.003 * SR);
  const n = Math.min(Math.floor((x.length - 1) / rate), Math.round(maxSec * SR));
  for (let i = 0; i < n; i++) {
    const p = i * rate, j = p | 0, f = p - j;
    let v = x[j] * (1 - f) + x[j + 1] * f;
    if (maxSec !== Infinity && n - i < fade) v *= (n - i) / fade;
    const k = i0 + i; if (k >= 0 && k < out.length) out[k] += v * gain;
  }
}

// Cuts one clink starting 1 ms before the first sample above 20% of its local peak, ending before the next onset.
function cut(x, ms, nextMs) {
  const a = Math.round(((ms - 4) * SR) / 1000), b = Math.round(((ms + 6) * SR) / 1000);
  let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i] || 0));
  let s = a; while (s < b && Math.abs(x[s]) < 0.2 * p) s++;
  s = Math.max(0, s - 48);
  const end = Math.min(x.length, Math.round((Math.min(nextMs - 1, ms + 250) * SR) / 1000));
  const y = x.slice(s, end), fade = Math.round(0.005 * SR);
  for (let i = 0; i < fade && i < y.length; i++) y[y.length - 1 - i] *= i / fade;
  return normalize(y);
}
function normalize(y) { let m = 0; for (const v of y) m = Math.max(m, Math.abs(v)); for (let i = 0; i < y.length; i++) y[i] /= m || 1; return y; }
// Hits from the online CC0 clips: a coin dropped on a table (OpenGameArt) and on a wooden floor (Wikimedia).
const ONLINE_HITS = [['oga', 72, 164], ['oga', 164, 213], ['oga', 213, 300], ['wiki', 380, 488], ['wiki', 488, 700], ['wiki', 831, 868], ['wiki', 879, 912]];
// Rim contacts of a wobbling €2 coin (BigSoundBank), about 40 ms apart.
const GRAIN_AT = [115, 159, 204, 256, 297, 330, 369, 413, 456, 495, 535, 574];
const GRAINS = GRAIN_AT.map((ms, i) => ['bigHit', ms, GRAIN_AT[i + 1] ?? 610]);
const CLINKS = [['hc1', 149, 223], ['hc1', 223, 241], ['hc1', 241, 271], ['hc1', 271, 340], ['hc2', 52, 69], ['hc2', 69, 115], ['hc2', 115, 168], ['hc2', 168, 231]];

const SHORT = { wobble: 0.03, flat: 0.02 };

function render(take, ev, P, samples) {
  const out = new Float32Array(Math.round((ev[ev.length - 1].t + 0.7) * SR));
  const r = rng(99);
  for (const e of ev) {
    const rim = e.kind === 'wobble' || e.kind === 'flat';
    if (take === 'synth' || (take !== 'clinks' && take !== 'online' && rim)) { synthHit(out, e, P, r); continue; }
    // Blend: the synth hit with a recorded clink layered on top; a short clink keeps only its strike and leaves the ring to the synth.
    if (take === 'blend') {
      synthHit(out, e, P, r);
      if (samples.clinks.length === 0) continue;
      const raw = samples.clinks[Math.floor(r() * samples.clinks.length)], x = P.surface === 'wood' ? soften(raw, P) : raw;
      mix(out, x, e.t, e.s * db(P.blendDb), 0.96 + 0.08 * r(), P.blendMs >= 90 ? Infinity : P.blendMs / 1000);
      continue;
    }
    const set = take === 'online' ? (rim ? samples.grains : samples.hits) : samples.clinks;
    if (set.length === 0) continue;
    const pick = set[Math.floor(r() * set.length)], x = take !== 'online' && P.surface === 'wood' ? soften(pick, P) : pick;
    const rate = e.kind === 'air' ? 1 : 0.96 + 0.08 * r();
    // The €2 grains already sit at wobble loudness in their clip, so they are lifted to match the synth's rim level.
    mix(out, x, e.t, take === 'online' && rim ? Math.min(1, e.s * 2) : e.s, rate, SHORT[e.kind] ?? Infinity);
  }
  let m = 0; for (const v of out) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] *= 0.85 / (m || 1);
  return out;
}

const SCENARIOS = [
  { id: 'quick', name: 'Quick flip', note: 'Lands on its rim, bounces twice, wobbles flat in about half a second.', bounces: 2, wobble: 1, seed: 11, coins: [{ at: 0, wobble: 1 }] },
  { id: 'spin', name: 'Long spin-down', note: 'One bounce, then a long wobble whose rattle speeds up until it stops dead, like a coin spun on a table.', bounces: 1, wobble: 2, seed: 23, coins: [{ at: 0, wobble: 1 }] },
  { id: 'flat', name: 'Flat landing', note: 'Lands face down and patters to rest without wobbling.', bounces: 4, wobble: 0, seed: 37, coins: [{ at: 0, wobble: 1 }] },
  { id: 'two', name: 'Two coins', note: 'Two coins thrown together, landing 0.16 s apart.', bounces: 2, wobble: 1, seed: 51, coins: [{ at: 0, wobble: 0.8 }, { at: 0.16, wobble: 1.15 }] },
];
