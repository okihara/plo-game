import { describe, it, expect } from 'vitest';
import { resolveEntryStatus } from '../entryStatus.js';
import type { TournamentPlayer } from '../types.js';

function source(player: Partial<TournamentPlayer> | undefined, canReenter = false) {
  return {
    getPlayer: () => player as TournamentPlayer | undefined,
    canReenter: () => canReenter,
  };
}

describe('resolveEntryStatus', () => {
  it('DB登録済みでメモリ未着席なら entered', () => {
    expect(resolveEntryStatus(source(undefined), 'u1', 0)).toBe('entered');
  });

  it('プレイ中なら entered', () => {
    expect(resolveEntryStatus(source({ status: 'playing', reentryCount: 0 }), 'u1', 0)).toBe('entered');
  });

  it('切断中でも脱落していなければ entered', () => {
    expect(resolveEntryStatus(source({ status: 'disconnected', reentryCount: 0 }), 'u1', 0)).toBe('entered');
  });

  it('脱落済みで DB の課金回数がメモリより多ければ reentry_pending', () => {
    // canReenter が true でも課金済みを優先する（再課金させない）
    expect(resolveEntryStatus(source({ status: 'eliminated', reentryCount: 0 }, true), 'u1', 1)).toBe('reentry_pending');
  });

  it('課金済みなら期限切れ（canReenter=false）でも reentry_pending', () => {
    expect(resolveEntryStatus(source({ status: 'eliminated', reentryCount: 0 }, false), 'u1', 1)).toBe('reentry_pending');
  });

  it('脱落済みでリエントリー可能なら can_reenter', () => {
    expect(resolveEntryStatus(source({ status: 'eliminated', reentryCount: 0 }, true), 'u1', 0)).toBe('can_reenter');
  });

  it('脱落済みでリエントリー不可なら eliminated', () => {
    expect(resolveEntryStatus(source({ status: 'eliminated', reentryCount: 1 }, false), 'u1', 1)).toBe('eliminated');
  });
});
