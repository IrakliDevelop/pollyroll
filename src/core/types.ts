import type { SkinRef } from '../skins/types';

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
export interface RolledDie {
  type: DieType;
  value: number | null;
  group: number;
  wave: number;
}
export type Audience = 'all' | 'dm' | string[];
export interface RollEvent {
  v: 1;
  id: string;
  notation: string;
  dice: RolledDie[];
  modifier: number;
  seed: string;
  skin?: SkinRef;
  rollerId?: string;
  audience?: Audience;
  createdAt: number;
}
export interface RollGroupSummary {
  die: DieType;
  dice: (number | null)[];
  kept: number[];
  dropped: number[];
  subtotal: number | null;
}
export interface RollSummary {
  total: number | null;
  modifier: number;
  groups: RollGroupSummary[];
}
export interface CreateRollOptions {
  rng?: (maxExclusive: number) => number;
  seed?: string;
  skin?: SkinRef;
  rollerId?: string;
  audience?: Audience;
}
