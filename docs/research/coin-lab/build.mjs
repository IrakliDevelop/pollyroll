import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const SR = 48000, root = 'sources';
export const SOURCES = {
  hc1: ['rpg/Audio/handleCoins.ogg'], hc2: ['rpg/Audio/handleCoins2.ogg'], click: ['rpg/Audio/metalClick.ogg'],
  bigHit: ['online/big2700.mp3', 4.3, 1.2], bigEnd: ['online/big2700.mp3', 11.4, 2.6],
  oga: ['online/oga-coin_drop.ogg', 0.4, 0.75], wiki: ['online/wiki-coin-floor.ogg', 0.5, 1.25],
};
// Decodes to mono 48 kHz, peak-normalised to 0.9 so loud sources do not clip in 16-bit.
export function pcm16([file, ss, t]) {
  const trim = ss === undefined ? [] : ['-ss', String(ss), '-t', String(t)];
  const b = execFileSync('ffmpeg', ['-v', 'error', ...trim, '-i', `${root}/${file}`, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  return Buffer.from(Int16Array.from(x, (v) => Math.round((v / m) * 0.9 * 32767)).buffer);
}
export function wav(data) { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40); return Buffer.concat([h, data]); }
if (process.argv[2] === 'page') {
  const clips = Object.fromEntries(Object.entries(SOURCES).map(([k, f]) => [k, wav(pcm16(f)).toString('base64')]));
  let html = readFileSync('template.html', 'utf8');
  html = html.replace('__CORE__', () => readFileSync('core.js', 'utf8')).replace('__LAB__', () => readFileSync('lab.js', 'utf8')).replace('__CLIPS__', () => JSON.stringify(clips));
  writeFileSync('coin-flip-lab.html', html);
  console.log('bytes', html.length);
}
