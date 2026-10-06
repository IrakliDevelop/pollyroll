import { createRoll, evaluate, isRollEvent, PollyrollSyntaxError, redact } from 'pollyroll';
import type { RollEvent, RollSummary } from 'pollyroll';
import { classic, createDiceTray } from 'pollyroll/render';
import type { DiceTray, Skin } from 'pollyroll/render';
import { byId, createSkinEditor } from './editor';

const form = byId('controls', HTMLFormElement);
const notationInput = byId('notation', HTMLInputElement);
const sizeInput = byId('size', HTMLInputElement);
const sizeValue = byId('size-value', HTMLOutputElement);
const hiddenBox = byId('hidden', HTMLInputElement);
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

/** One results line: total (or "hidden") and kept/dropped values per notation group. */
function describe(summary: RollSummary): string {
  const parts = [`Total: ${summary.total === null ? 'hidden' : String(summary.total)}`];
  summary.groups.forEach((g, i) => {
    if (g.subtotal === null) {
      parts.push(`#${i + 1} ${g.die}: hidden`);
      return;
    }
    const pick = (indices: number[]): string => indices.map((k) => String(g.dice[k])).join(', ');
    let text = `#${i + 1} ${g.die}: kept [${pick(g.kept)}]`;
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
      if (id === rollId) out.textContent = describe(evaluate(event));
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

form.addEventListener('submit', (e) => {
  e.preventDefault();
  roll();
});
