export type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100' | 'dF';
export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';
export interface DiceTerm {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  die: DieType;
  keep: { mode: KeepMode; n: number } | null;
  explode: boolean;
}
export interface ConstantTerm {
  kind: 'constant';
  sign: 1 | -1;
  value: number;
}
export type RollTerm = DiceTerm | ConstantTerm;
export interface RollAst {
  terms: RollTerm[];
}
