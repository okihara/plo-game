import { describe, it, expect } from 'vitest';
import { HUD_STAT_KEYS } from '@plo/shared';
import { hudFromCacheFields, hudToCacheFields } from '../hudCacheFields.js';
import { emptyHud } from '../hudStats.js';

describe('hudCacheFields', () => {
  it('HUD の全項目を hud<Key>N / hud<Key>D の列にして、元に戻せる', () => {
    const hud = emptyHud();
    HUD_STAT_KEYS.forEach((key, i) => { hud[key] = { n: i, d: i + 10 }; });
    hud.hands = hud.vpip.d;

    const fields = hudToCacheFields(hud);
    expect(Object.keys(fields)).toHaveLength(HUD_STAT_KEYS.length * 2);
    expect(fields).toMatchObject({ hudVpipN: 0, hudVpipD: 10, hudRaiseVsBetN: 12, hudBb3BetVsOpenD: 25 });
    expect(hudFromCacheFields(fields)).toEqual(hud);
  });
});
