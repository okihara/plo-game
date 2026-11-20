// 卓内 HUD を TournamentStatsCache の列（hud<Key>N / hud<Key>D）と相互変換する

import { HUD_STAT_KEYS, type HudStatKey, type PlayerHudStats } from '@plo/shared';

export type HudCacheFields = Record<`hud${Capitalize<HudStatKey>}${'N' | 'D'}`, number>;

function field(key: HudStatKey, part: 'N' | 'D'): keyof HudCacheFields {
  return `hud${key[0].toUpperCase()}${key.slice(1)}${part}` as keyof HudCacheFields;
}

/** HUD の値を列の値にする（加算用） */
export function hudToCacheFields(hud: PlayerHudStats): HudCacheFields {
  const fields = {} as HudCacheFields;
  for (const key of HUD_STAT_KEYS) {
    fields[field(key, 'N')] = hud[key].n;
    fields[field(key, 'D')] = hud[key].d;
  }
  return fields;
}

/** 列の値から HUD を作る。VPIP の分母は配られた全ハンドで数えるので、ハンド数として使う */
export function hudFromCacheFields(row: HudCacheFields): PlayerHudStats {
  const hud = { hands: row.hudVpipD } as PlayerHudStats;
  for (const key of HUD_STAT_KEYS) hud[key] = { n: row[field(key, 'N')], d: row[field(key, 'D')] };
  return hud;
}
