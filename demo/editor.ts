import { createRoll, isRollEvent } from 'pollyroll';
import {
  amethyst,
  aquamarine,
  brass,
  classic,
  emerald,
  oak,
  obsidian,
  materialPresets,
  PollyrollShaderError,
  ruby,
  sapphire,
  smoke,
  topaz,
} from 'pollyroll/render';
import type {
  LabelStyle,
  MaterialParams,
  MaterialPreset,
  PatternName,
  Skin,
} from 'pollyroll/render';

export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`missing #${id}`);
  return el;
}

const PRESETS = new Map(
  Object.entries({
    classic,
    obsidian,
    brass,
    oak,
    sapphire,
    ruby,
    emerald,
    amethyst,
    topaz,
    aquamarine,
    smoke,
  }),
);
const MATERIALS: readonly MaterialPreset[] = ['plastic', 'metal', 'wood', 'glass', 'stone', 'gem'];
const STYLES: readonly LabelStyle[] = ['engraved', 'printed', 'embossed'];
const PATTERNS: readonly PatternName[] = ['none', 'gradient', 'speckle', 'marble', 'wood', 'swirl'];
const PARAMS = ['metalness', 'roughness', 'clearcoat', 'transmission', 'tint', 'sparkle'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

const fields = byId('skin-fields', HTMLFieldSetElement);
const startFrom = byId('start-from', HTMLSelectElement);
const colorA = byId('color-a', HTMLInputElement);
const twoTone = byId('two-tone', HTMLInputElement);
const colorB = byId('color-b', HTMLInputElement);
const labelColor = byId('label-color', HTMLInputElement);
const material = byId('material', HTMLSelectElement);
const materialParams = byId('material-params', HTMLDivElement);
const labelStyle = byId('label-style', HTMLSelectElement);
const pattern = byId('pattern', HTMLSelectElement);
const font = byId('font', HTMLInputElement);
const glslPanel = byId('glsl-panel', HTMLDivElement);
const glsl = byId('glsl', HTMLTextAreaElement);
const glslError = byId('glsl-error', HTMLPreElement);
const json = byId('skin-json', HTMLTextAreaElement);
const importText = byId('import-text', HTMLTextAreaElement);
const importError = byId('import-error', HTMLParagraphElement);
const slider = (k: string): HTMLInputElement => byId(`m-${k}`, HTMLInputElement);

function readSkin(): Skin {
  const n = (k: string): number => Number(slider(k).value);
  const skin: Skin = {
    material: MATERIALS.find((m) => m === material.value) ?? {
      metalness: n('metalness'),
      roughness: n('roughness'),
      clearcoat: n('clearcoat'),
      transmission: n('transmission'),
      tint: n('tint'),
      sparkle: n('sparkle'),
    },
    color: twoTone.checked ? [colorA.value, colorB.value] : colorA.value,
    labelColor: labelColor.value,
    labelStyle: STYLES.find((s) => s === labelStyle.value) ?? 'engraved',
    pattern: PATTERNS.find((p) => p === pattern.value) ?? { glsl: glsl.value },
  };
  if (font.value !== '') skin.font = font.value;
  return skin;
}

function sync(): void {
  colorB.disabled = !twoTone.checked;
  materialParams.hidden = material.value !== 'custom';
  glslPanel.hidden = pattern.value !== 'custom';
  for (const k of PARAMS) byId(`m-${k}-value`, HTMLOutputElement).textContent = slider(k).value;
}

function setSliders(m: MaterialParams): void {
  for (const k of PARAMS) slider(k).value = String(m[k] ?? 0);
}

function load(skin: Skin): void {
  const [a, b] = typeof skin.color === 'string' ? [skin.color, skin.color] : skin.color;
  colorA.value = a;
  colorB.value = b;
  twoTone.checked = typeof skin.color !== 'string';
  labelColor.value = skin.labelColor;
  const m = skin.material;
  material.value = typeof m === 'string' ? m : 'custom';
  setSliders(typeof m === 'object' ? m : materialPresets[m]);
  labelStyle.value = skin.labelStyle ?? 'engraved';
  const p = skin.pattern ?? 'none';
  pattern.value = typeof p === 'string' ? p : 'custom';
  if (typeof p === 'object') glsl.value = p.glsl;
  font.value = skin.font ?? '';
  sync();
}

/** A skin passing isRollEvent's inline-skin rules (custom GLSL allowed), with hex colours. */
function parseSkin(text: string): Skin | null {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof x !== 'object' || x === null) return null;
  const custom =
    'pattern' in x &&
    typeof x.pattern === 'object' &&
    x.pattern !== null &&
    'glsl' in x.pattern &&
    typeof x.pattern.glsl === 'string';
  const probe = custom ? { ...x, pattern: 'none' } : x;
  if (!isRollEvent({ ...createRoll('d6'), skin: probe })) return null;
  const skin = x as Skin;
  // Colour inputs only hold #rrggbb.
  return [skin.color, skin.labelColor].flat().every((c) => HEX.test(c)) ? skin : null;
}

/**
 * Wires the "Customize dice" panel, starting from `initial`. Every change calls `apply`; when it
 * throws PollyrollShaderError the log is shown and the last good skin stays.
 */
export function createSkinEditor(initial: Skin, apply: (skin: Skin) => void): void {
  startFrom.append(...[...PRESETS.keys()].map((name) => new Option(name)));
  material.prepend(...MATERIALS.map((m) => new Option(m)));
  labelStyle.append(...STYLES.map((s) => new Option(s)));
  pattern.prepend(...PATTERNS.map((p) => new Option(p)));
  load(initial);
  json.value = JSON.stringify(initial, null, 2);

  function update(): void {
    const skin = readSkin();
    try {
      apply(skin);
    } catch (error) {
      if (!(error instanceof PollyrollShaderError)) throw error;
      glslError.hidden = false;
      glslError.textContent = `${error.message}\n${error.log.replace(/[\s\0]+$/, '')}`;
      return;
    }
    glslError.hidden = true;
    json.value = JSON.stringify(skin, null, 2);
  }

  // Sliders track the named material, so switching to Custom starts from it.
  material.addEventListener('input', () => {
    const named = MATERIALS.find((m) => m === material.value);
    if (named !== undefined) setSliders(materialPresets[named]);
  });
  startFrom.addEventListener('input', () => {
    const preset = PRESETS.get(startFrom.value);
    if (preset !== undefined) load(preset);
  });
  let timer = 0;
  fields.addEventListener('input', () => {
    sync();
    clearTimeout(timer);
    timer = window.setTimeout(update, 150);
  });
  byId('copy', HTMLButtonElement).addEventListener('click', () => {
    void navigator.clipboard.writeText(json.value);
  });
  byId('import', HTMLButtonElement).addEventListener('click', () => {
    const skin = parseSkin(importText.value);
    importError.hidden = skin !== null;
    importError.textContent = 'Not a valid skin: expected Skin JSON with #rrggbb colours.';
    if (skin === null) return;
    load(skin);
    update();
  });
}
