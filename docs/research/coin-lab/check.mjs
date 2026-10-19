import vm from 'node:vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { SOURCES, pcm16, wav } from './build.mjs';
const c = {}; vm.createContext(c); vm.runInContext(readFileSync('core.js', 'utf8') + ';Object.assign(globalThis,{DEFAULTS,SCENARIOS,timeline,render,cut,normalize,CLINKS,ONLINE_HITS,GRAINS,SR});', c);
const raw = Object.fromEntries(Object.entries(SOURCES).map(([k, f]) => { const b = pcm16(f); const i = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); return [k, Float32Array.from(i, (v) => v / 32768)]; }));
const samples = { clinks: c.CLINKS.map(([k, a, b]) => c.cut(raw[k], a, b)), hits: c.ONLINE_HITS.map(([k, a, b]) => c.cut(raw[k], a, b)), grains: c.GRAINS.map(([k, a, b]) => c.cut(raw[k], a, b)) };
console.log('hits ms', samples.hits.map((x) => (x.length / 48).toFixed(0)).join(' '), 'grains ms', samples.grains.map((x) => (x.length / 48).toFixed(0)).join(' '));
console.log('clink ms', samples.clinks.map((x) => (x.length / 48).toFixed(0)).join(' '));
for (const sc of c.SCENARIOS) {
  const ev = c.timeline(c.DEFAULTS, sc);
  const kinds = {}; for (const e of ev) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const line = [];
  for (const take of ['synth', 'blend', 'hybrid', 'clinks', 'online']) {
    const t0 = performance.now(); const x = c.render(take, ev, c.DEFAULTS, samples); const ms = performance.now() - t0;
    let nan = 0, e2 = 0; for (const v of x) { if (!Number.isFinite(v)) nan++; e2 += v * v; }
    line.push(`${take} ${(x.length / 48000).toFixed(2)}s rms ${(10 * Math.log10(e2 / x.length)).toFixed(0)}dB ${ms.toFixed(0)}ms${nan ? ' NaN!' : ''}`);
    const pcm = Buffer.from(Int16Array.from(x, (v) => Math.round(v * 32767)).buffer);
    writeFileSync(`out-${sc.id}-${take}.wav`, wav(pcm));
  }
  console.log(sc.id, JSON.stringify(kinds), '\n  ', line.join(' | '));
}
