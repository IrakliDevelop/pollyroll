import { createRoll, evaluate, isRollEvent, PollyrollSyntaxError, redact } from 'pollyroll';
import type { RollEvent, RollSummary } from 'pollyroll';
import { createDiceTray } from 'pollyroll/render';
import type { DiceTray } from 'pollyroll/render';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`missing #${id}`);
  return el;
}

const form = byId('controls', HTMLFormElement);
const notationInput = byId('notation', HTMLInputElement);
const skinSelect = byId('skin', HTMLSelectElement);
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
  let event: RollEvent;
  try {
    event = createRoll(notation, { skin: skinSelect.value });
  } catch (error) {
    if (error instanceof PollyrollSyntaxError) {
      showError(`${error.message}\n${notation}\n${' '.repeat(error.index)}^`);
    } else {
      showError(String(error));
    }
    return;
  }
  showError(null);
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
