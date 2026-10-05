export type MaterialPreset = 'plastic' | 'metal' | 'wood' | 'glass' | 'stone' | 'gem';
export interface MaterialParams {
  metalness: number;
  roughness: number;
  clearcoat?: number;
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
