import { createRoll, evaluate, isRollEvent, parse, PollyrollSyntaxError, redact } from 'pollyroll';
import type { RollEvent } from 'pollyroll';
import { classic, createDiceTray } from 'pollyroll/render';
import type { DiceTray, Skin } from 'pollyroll/render';
import { byId, createSkinEditor } from './editor';

const form = byId('controls', HTMLFormElement);
const notationInput = byId('notation', HTMLInputElement);
const sizeInput = byId('size', HTMLInputElement);
const sizeValue = byId('size-value', HTMLOutputElement);
const hiddenBox = byId('hidden', HTMLInputElement);
const soundBox = byId('sound', HTMLInputElement);
const examples = byId('examples', HTMLDivElement);
const errorEl = byId('error', HTMLPreElement);
const noticeEl = byId('notice', HTMLParagraphElement);
const resultA = byId('result-a', HTMLParagraphElement);
const resultB = byId('result-b', HTMLParagraphElement);

const dieScale = Number(sizeInput.value);
const trayA = createDiceTray(byId('tray-a', HTMLDivElement), { dieScale });
const trayB = createDiceTray(byId('tray-b', HTMLDivElement), { dieScale });
noticeEl.hidden = trayA.supported && trayB.supported;

let rollId = 0;
let skin: Skin = classic;
let last: RollEvent | null = null;

function showError(text: string | null): void {
  errorEl.hidden = text === null;
  errorEl.textContent = text ?? '';
}

/** One results line: total (or "hidden") and kept or success count, plus dropped, per group. */
function describe(event: RollEvent): string {
  const summary = evaluate(event);
  const counted = parse(event.notation).terms.filter((t) => t.kind === 'dice');
  const parts = [`Total: ${summary.total === null ? 'hidden' : String(summary.total)}`];
  summary.groups.forEach((g, i) => {
    if (g.subtotal === null) {
      parts.push(`#${i + 1} ${g.die}: hidden`);
      return;
    }
    const pick = (indices: number[]): string => indices.map((k) => String(g.dice[k])).join(', ');
    let text = `#${i + 1} ${g.die}: `;
    text += counted[i]?.success ? `successes ${g.subtotal}` : `kept [${pick(g.kept)}]`;
    if (g.dropped.length > 0) text += ` dropped [${pick(g.dropped)}]`;
    parts.push(text);
  });
  if (summary.modifier !== 0)
    parts.push(`modifier ${summary.modifier > 0 ? '+' : ''}${summary.modifier}`);
  return parts.join(' · ');
}

function play(tray: DiceTray, event: RollEvent, out: HTMLElement, id: number): void {
  out.textContent = 'Rolling…';
  tray.playRoll(event).then(
    () => {
      if (id === rollId) out.textContent = describe(event);
    },
    (error: unknown) => {
      if (id === rollId) out.textContent = `Error: ${String(error)}`;
    },
  );
}

function roll(): void {
  const notation = notationInput.value;
  try {
    last = createRoll(notation);
  } catch (error) {
    if (error instanceof PollyrollSyntaxError) {
      showError(`${error.message}\n${notation}\n${' '.repeat(error.index)}^`);
    } else {
      showError(String(error));
    }
    return;
  }
  showError(null);
  send(last);
}

function send(roll: RollEvent): void {
  // Custom GLSL is local-only (isRollEvent rejects it): such rolls use each tray's setSkin skin.
  const event = typeof skin.pattern === 'object' ? roll : { ...roll, skin };
  const id = ++rollId;
  play(trayA, event, resultA, id);

  // What a transport would carry: a JSON round trip of the (optionally redacted) event.
  const wire: unknown = JSON.parse(JSON.stringify(hiddenBox.checked ? redact(event) : event));
  if (!isRollEvent(wire)) {
    trayB.clear();
    resultB.textContent = 'Error: received an invalid RollEvent.';
    return;
  }
  play(trayB, wire, resultB, id);
}

createSkinEditor(skin, (next) => {
  trayA.setSkin(next);
  trayB.setSkin(next);
  skin = next;
  last ??= createRoll('d20+d6');
  send(last);
});

// Both trays share the scale: the walls depend on it, so it must match for identical motion.
sizeInput.addEventListener('input', () => {
  sizeValue.textContent = sizeInput.value;
  trayA.setDieScale(Number(sizeInput.value));
  trayB.setDieScale(Number(sizeInput.value));
});

// Only tray A clacks: tray B replays the same roll, so two sounding trays would double every hit.
soundBox.addEventListener('change', () => trayA.setSound(soundBox.checked ? 1 : 0));

for (const notation of [
  'adv',
  '4d6dl1',
  '4d6r1',
  '2d20ro1',
  '5d10>=7',
  '3d6!',
  'd6!>=5',
  'd%+d10',
  '4dF',
  '30d6',
]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = notation;
  button.addEventListener('click', () => {
    notationInput.value = notation;
    roll();
  });
  examples.append(button);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  roll();
});
