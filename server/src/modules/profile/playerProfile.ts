// 公開プロフィール（PlayerProfile）の組み立て

import { DEFAULT_AVATAR_URL, type PlayerProfile } from '@plo/shared';
import { maskName } from '../../shared/utils.js';
import { resolveNameplate } from '../badges/badgeService.js';
import { TABLE_CONSTANTS } from '../table/constants.js';

/**
 * 着席（トーナメントは参加）時に公開プロフィールを確定する。
 * 以降の層（テーブル・プロトコル・クライアント変換）は中身を解釈せず
 * PlayerProfile ごと伝播するため、表示項目の追加はここと描画側だけで済む。
 */
export async function buildPlayerProfile(
  odId: string,
  user: {
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    nameMasked?: boolean;
  }
): Promise<PlayerProfile> {
  return {
    name: user.displayName
      || ((user.nameMasked ?? true) ? maskName(user.username) : user.username),
    avatarId: Math.floor(Math.random() * TABLE_CONSTANTS.DEFAULT_AVATAR_COUNT),
    avatarUrl: user.avatarUrl || DEFAULT_AVATAR_URL,
    nameplate: await resolveNameplate(odId),
  };
}
