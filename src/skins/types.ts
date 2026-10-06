export type MaterialPreset = 'plastic' | 'metal' | 'wood' | 'glass' | 'stone' | 'gem';
export interface MaterialParams {
  metalness: number;
  roughness: number;
  clearcoat?: number;
  /** 0 (default) is opaque; above 0 the die is see-through, clearer as it rises. */
  transmission?: number;
  /** Depth of the body colour along the view path through a see-through die. */
  tint?: number;
  /** Strength of gem glints; 0 is none. */
  sparkle?: number;
}
export type LabelStyle = 'engraved' | 'printed' | 'embossed';
export type PatternName = 'none' | 'gradient' | 'speckle' | 'marble' | 'wood' | 'swirl';
export interface Skin {
  material: MaterialPreset | MaterialParams;
  color: string | [string, string];
  labelColor: string;
  labelStyle?: LabelStyle;
  pattern?: PatternName | { glsl: string };
  font?: string;
}
export type SkinRef = string | Skin;
