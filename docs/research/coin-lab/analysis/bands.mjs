import { decode } from './onsets.mjs';
import { fft } from './fft.mjs';
const SR = 48000, N = 2048, B = [[0, 1000], [1000, 4000], [4000, 8000], [8000, 24000]];
for (const f of process.argv.slice(2)) {
  const x = decode(f); const e = [0, 0, 0, 0];
  for (let at = 0; at + N <= x.length; at += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    for (let i = 1; i < N / 2; i++) { const hz = (i * SR) / N, p = re[i] ** 2 + im[i] ** 2; B.forEach(([a, b], k) => { if (hz >= a && hz < b) e[k] += p; }); }
  }
  const tot = e.reduce((a, b) => a + b);
  console.log(f.padEnd(24), B.map(([a, b], k) => `${a / 1000}-${b / 1000}k ${((100 * e[k]) / tot).toFixed(0).padStart(3)}%`).join('  '));
}
