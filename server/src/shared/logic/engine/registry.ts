// GameVariant → VariantDescriptor のレジストリ
// 新しいバリアントは variants/ に記述子を追加してここに 1 行登録する。

import { GameVariant } from '../types.js';
import { VariantDescriptor } from './descriptor.js';
import { omahaDescriptor } from './variants/omaha.js';
import { limitHoldemDescriptor, omahaHiLoDescriptor } from './variants/fixedLimitBoard.js';
import { studDescriptorFor } from './variants/stud.js';
import { drawNoLimitDescriptor, drawFixedLimitDescriptor } from './variants/draw.js';
import { bombPotDescriptor } from './variants/bombPot.js';
import { StudHighRules } from '../rules/studHighRules.js';
import { RazzRules } from '../rules/razzRules.js';
import { StudHiLoRules } from '../rules/studHiLoRules.js';

const DESCRIPTORS: Record<GameVariant, VariantDescriptor> = {
  plo: omahaDescriptor,
  plo5: omahaDescriptor,
  plo6: omahaDescriptor,
  plo_hilo: omahaDescriptor,
  big_o: omahaDescriptor,
  limit_holdem: limitHoldemDescriptor,
  omaha_hilo: omahaHiLoDescriptor,
  stud: studDescriptorFor(new StudHighRules()),
  razz: studDescriptorFor(new RazzRules()),
  stud_hilo: studDescriptorFor(new StudHiLoRules()),
  'limit_2-7_triple_draw': drawFixedLimitDescriptor,
  'no_limit_2-7_single_draw': drawNoLimitDescriptor,
  plo_double_board_bomb: bombPotDescriptor,
};

export function getEngineDescriptor(variant: GameVariant): VariantDescriptor {
  return DESCRIPTORS[variant];
}
