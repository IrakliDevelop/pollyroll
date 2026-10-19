// Page wiring: decode embedded WAVs, build the take rows, clip pickers, controls and settings box.
function pcm(b64) {
  const bin = atob(b64), n = (bin.length - 44) >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(44 + 2 * i) | (bin.charCodeAt(45 + 2 * i) << 8); if (v >= 32768) v -= 65536; out[i] = v / 32768; }
  return out;
}
const RAW = Object.fromEntries(Object.entries(CLIPS).map(([k, v]) => [k, pcm(v)]));
const CLINK_SAMPLES = CLINKS.map(([k, a, b]) => cut(RAW[k], a, b));
const HIT_SAMPLES = ONLINE_HITS.map(([k, a, b]) => cut(RAW[k], a, b));
const GRAIN_SAMPLES = GRAINS.map(([k, a, b]) => cut(RAW[k], a, b));
const TAKES = [['synth', 'Synth', '--synth'], ['blend', 'Blend', '--metal'], ['hybrid', 'Hybrid', '--hybrid'], ['clinks', 'Coin clinks', '--clink'], ['online', 'Online recordings', '--online']];
const CTL = [
  ['pitch', 'Coin pitch', 2.5, 11, 0.1, 'kHz', 'Lowest ring mode. Kenney clinks 4.9; the small coin from Wikimedia rings at 10; bigger or thinner coins ring lower.'],
  ['ringMs', 'Ring length', 10, 400, 5, 'ms', 'How long the ring lasts after a hit. A coin in the air rings 6× longer.'],
  ['split', 'Shimmer', 0, 4, 0.1, '%', 'Spacing of each mode\'s two close tones. Measured 2.1–2.4 in the clinks.'],
  ['bright', 'Brightness', 0.3, 1.6, 0.05, '×', 'Level of the higher modes.'],
  ['knockDb', 'Table knock', -40, 0, 1, 'dB', 'Short knock of the coin on the table.'],
  ['knock', 'Knock pitch', 0.4, 3, 0.05, 'kHz', 'Wood sits near 1–1.5 kHz.'],
  ['wobbleMs', 'Wobble length', 0, 1500, 25, 'ms', 'How long it wobbles before lying flat (doubled in the long spin-down).'],
  ['wobbleDb', 'Wobble loudness', -30, 0, 1, 'dB', 'Rim contacts relative to the landing.'],
  ['endRate', 'Wobble end rate', 40, 300, 5, '/s', 'Contacts per second just before it stops.'],
  ['contact', 'Contact softness', 1, 12, 0.25, 'kHz', 'On wood the strike excites little above this. Lower is softer wood; the hard surface ignores it.'],
  ['bodyDb', 'Table body', -24, 6, 1, 'dB', 'Ring of the wooden table itself (0.6–2.4 kHz), which carries most of a real coin on wood.'],
  ['bodyMs', 'Table ring length', 3, 40, 1, 'ms', 'Measured 7–15 in the €2 coin recording.'],
  ['blendDb', 'Blend: clink level', -24, 6, 1, 'dB', 'Loudness of the recorded clink layered on each synth landing and bounce.'],
  ['blendMs', 'Blend: clink length', 3, 90, 1, 'ms', 'Keep only the first part of each clink; 90 plays it whole. Short keeps the real strike, the synth carries the ring.'],
];
let P = { ...DEFAULTS };
const use = { clinks: CLINK_SAMPLES.map(() => true), hits: HIT_SAMPLES.map(() => true), grains: GRAIN_SAMPLES.map(() => true) };
try { const saved = JSON.parse(localStorage.getItem('coin-lab') ?? 'null'); if (saved) { P = { ...P, ...saved.P }; for (const k of Object.keys(use)) if (saved.use?.[k]?.length === use[k].length) use[k] = saved.use[k]; } } catch {}

let ctx = null, playing = null;
function play(x) {
  ctx ??= new AudioContext();
  ctx.resume();
  playing?.stop();
  const b = ctx.createBuffer(1, x.length, SR); b.copyToChannel(x, 0);
  const src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start();
  playing = src;
}
function draw(canvas, x, color) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth || 300, h = canvas.clientHeight || 46;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(color).trim();
  const step = x.length / w;
  for (let px = 0; px < w; px++) {
    let m = 0; const a = Math.floor(px * step), b = Math.floor((px + 1) * step);
    for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i]));
    const bar = Math.max(1, m * h * 0.95); g.fillRect(px, (h - bar) / 2, 1, bar);
  }
}
const samples = () => ({ clinks: CLINK_SAMPLES.filter((_, i) => use.clinks[i]), hits: HIT_SAMPLES.filter((_, i) => use.hits[i]), grains: GRAIN_SAMPLES.filter((_, i) => use.grains[i]) });
const renderTake = (take, sc) => render(take, timeline(P, sc), P, samples());

const rows = [];
function buildFlips() {
  const host = document.getElementById('flips');
  for (const sc of SCENARIOS) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="row" style="justify-content:space-between"><h3>${sc.name}</h3><button class="chip ghost" type="button">Play all five</button></div><p>${sc.note}</p>`;
    card.querySelector('button').addEventListener('click', () => {
      const parts = TAKES.map(([t]) => renderTake(t, sc)), gap = Math.round(0.45 * SR);
      const all = new Float32Array(parts.reduce((n, x) => n + x.length + gap, 0)); let at = 0;
      for (const x of parts) { all.set(x, at); at += x.length + gap; }
      play(all);
    });
    for (const [take, label, color] of TAKES) {
      const row = document.createElement('div'); row.className = 'take';
      row.innerHTML = `<button class="play" type="button"><i class="dot" style="background:var(${color})"></i>${label}</button><canvas aria-hidden="true"></canvas>`;
      row.querySelector('button').addEventListener('click', () => play(renderTake(take, sc)));
      card.append(row);
      rows.push({ canvas: row.querySelector('canvas'), take, sc, color });
    }
    host.append(card);
  }
}
// Waveforms redraw one row per frame so a slider release never freezes the page; a newer redraw cancels the older one.
let drawId = 0;
async function redraw() {
  const id = ++drawId;
  for (const r of rows) { await new Promise(requestAnimationFrame); if (id !== drawId) return; draw(r.canvas, renderTake(r.take, r.sc), r.color); }
}

function clipCard(host, name, note, x, color, onPlay, pick) {
  const el = document.createElement('div'); el.className = 'clip';
  el.innerHTML = `<label>${pick ? '<input type="checkbox">' : ''}<span>${name}</span></label><small>${note}</small><canvas aria-hidden="true"></canvas><button class="play" type="button"><i class="dot" style="background:var(${color})"></i>Play</button>`;
  if (pick) { const box = el.querySelector('input'); box.id = `pick-${pick.set}-${pick.i}`; box.checked = use[pick.set][pick.i]; box.addEventListener('change', () => { use[pick.set][pick.i] = box.checked; save(); redraw(); }); }
  el.querySelector('button').addEventListener('click', onPlay);
  host.append(el);
  requestAnimationFrame(() => draw(el.querySelector('canvas'), x, color));
}
function buildClips() {
  CLINK_SAMPLES.forEach((x, i) => { const [k, ms] = CLINKS[i]; clipCard(document.getElementById('clinks'), `Clink ${i + 1}`, `${k === 'hc1' ? 'handleCoins' : 'handleCoins2'} at ${ms} ms · ${Math.round(x.length / 48)} ms`, x, '--clink', () => play(x), { set: 'clinks', i }); });
  const SRC_NAME = { oga: 'OpenGameArt coin drop', wiki: 'Wikimedia coin on floor' };
  HIT_SAMPLES.forEach((x, i) => { const [k, ms] = ONLINE_HITS[i]; clipCard(document.getElementById('hits'), `Hit ${i + 1}`, `${SRC_NAME[k]} at ${ms} ms · ${Math.round(x.length / 48)} ms`, x, '--online', () => play(x), { set: 'hits', i }); });
  GRAIN_SAMPLES.forEach((x, i) => clipCard(document.getElementById('grains'), `Rim contact ${i + 1}`, `BigSoundBank €2 coin at ${GRAIN_AT[i]} ms`, x, '--online', () => play(x), { set: 'grains', i }));
  [['bigHit', '€2 coin wobbling', 'BigSoundBank #4, 4.3–5.5 s of 14.6'], ['bigEnd', '€2 coin spin-down ending', 'BigSoundBank #4, 11.4–14.0 s'], ['oga', 'Coin dropped on a table', 'OpenGameArt, Vinrax'], ['wiki', 'Coin dropped on a wooden floor', 'Wikimedia Commons, ezwa']].forEach(([k, name, note]) => clipCard(document.getElementById('online-sources'), name, note, RAW[k], '--online', () => play(RAW[k])));
  [['hc1', 'handleCoins', 'RPG Audio · a handful of coins'], ['hc2', 'handleCoins2', 'RPG Audio · coins dropped in a hand'], ['click', 'metalClick', 'RPG Audio · small metal click']].forEach(([k, name, note]) => clipCard(document.getElementById('sources'), name, note, RAW[k], '--clink', () => play(RAW[k])));
}

function buildControls() {
  const host = document.getElementById('controls'); host.innerHTML = '';
  for (const [key, label, min, max, step, unit, help] of CTL) {
    const el = document.createElement('div'); el.className = 'ctl';
    el.innerHTML = `<label for="c-${key}">${label} <output></output></label><input id="c-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${P[key]}"><small>${help}</small>`;
    const input = el.querySelector('input'), out = el.querySelector('output');
    const show = () => { out.textContent = `${P[key]} ${unit}`; };
    input.addEventListener('input', () => { P[key] = Number(input.value); show(); save(); });
    input.addEventListener('change', redraw);
    show(); host.append(el);
  }
}
function toggles() {
  const surface = document.getElementById('surface'), flick = document.getElementById('flick');
  const sync = () => {
    surface.setAttribute('aria-checked', 'true'); surface.textContent = { wood: 'Surface: wooden table', hard: 'Surface: hard (glass, stone)', felt: 'Surface: felt tray (synth only)' }[P.surface];
    flick.setAttribute('aria-checked', String(P.flick));
  };
  surface.onclick = () => { P.surface = { wood: 'hard', hard: 'felt', felt: 'wood' }[P.surface]; sync(); save(); redraw(); };
  flick.onclick = () => { P.flick = !P.flick; sync(); save(); redraw(); };
  sync();
}
function save() {
  const on = (k) => use[k].flatMap((v, i) => (v ? [i + 1] : []));
  const picked = { clinks: on('clinks'), onlineHits: on('hits'), rimContacts: on('grains') };
  document.getElementById('settings').textContent = JSON.stringify({ ...P, ...picked });
  try { localStorage.setItem('coin-lab', JSON.stringify({ P, use })); } catch {}
}

const ONLINE = [
  ['Coin_Spin_Drop_01', 'artisan187 · Freesound', 'https://freesound.org/people/artisan187/sounds/818514/', 'Commemorative coin spins, wobbles and stops. 48 kHz.', '4.0 s', 'CC0', true],
  ['Spinning Coin', 'CassieTee · Freesound', 'https://freesound.org/people/CassieTee/sounds/209462/', 'Coin spinning down on wood.', '2.9 s', 'CC0', true],
  ['coin 3', 'arseniiv · Freesound', 'https://freesound.org/people/arseniiv/sounds/257347/', 'Coin settling after a flip. Phone recording.', '1.1 s', 'CC0', true],
  ['2 € Coin Flip', 'fedecortex · Freesound', 'https://freesound.org/people/fedecortex/sounds/587022/', 'Euro coin flipped onto a wooden table; needs trimming.', '7.0 s', 'CC0', true],
  ['Coin spinning on a table #4', 'BigSoundBank', 'https://bigsoundbank.com/coin-spinning-on-a-table-4-s2700.html', '€2 coin on varnished wood: spins, slows, stops.', '15 s', 'CC0', 'lab'],
  ['Coin Drop', 'Vinrax · OpenGameArt', 'https://opengameart.org/content/coin-drop', 'Coin dropped on a table.', '1.4 s', 'CC0', 'lab'],
  ['Coin Spin (long)', 'jon.k.clancy · Freesound', 'https://freesound.org/people/jon.k.clancy/sounds/402934/', 'Quarter spins to a halt on a wooden desk.', '7.8 s', 'CC0', true],
  ['Coin dropped on wooden floor', 'Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Coin_dropped_on_wooden_floor.ogg', 'Single small coin on a wooden floor.', '2.3 s', 'Public domain', 'lab'],
  ['Coin_Flip', 'Mediasaur · Freesound', 'https://freesound.org/people/Mediasaur/sounds/788074/', 'Short 50p flip, noise-reduced.', '0.48 s', 'CC0', true],
  ['Coin Flip 9', 'Baconation · Freesound', 'https://freesound.org/people/Baconation/sounds/592481/', 'Thumb flick with a metal ring.', '0.62 s', 'CC0', true],
];
function buildOnline() {
  document.getElementById('online').innerHTML = ONLINE.map(([title, who, url, what, len, lic, login], i) =>
    `<tr><td class="num">${i + 1}</td><td><a href="${url}" target="_blank" rel="noopener">${title}</a><br><small style="color:var(--muted)">${who}</small></td><td>${what}${login === 'lab' ? ' <span class="pill ok">in this lab</span>' : login ? ' <span class="pill warn">account to download</span>' : ''}</td><td class="num">${len}</td><td><span class="pill ok">${lic}</span></td></tr>`).join('');
}

document.getElementById('reset').addEventListener('click', () => { P = { ...DEFAULTS }; buildControls(); toggles(); save(); redraw(); });
buildFlips(); buildClips(); buildControls(); toggles(); buildOnline(); save(); redraw();
addEventListener('resize', redraw);
