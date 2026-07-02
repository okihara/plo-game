// プレイヤーの公開プロフィール（他プレイヤーにも見える表示用情報）

/**
 * ネームプレート装飾の種類。
 * 追加時はここのリテラルと、サーバーの resolveNameplate（どのバッジで付くか）、
 * クライアントの NAMEPLATE_STYLES（どう見えるか）の3箇所だけ変更する。
 */
export type NameplateDecoration = 'weekly_champion' | 'season_top3';

/**
 * 着席時にサーバーで確定する公開プロフィールのスナップショット。
 * テーブル層・プロトコル・クライアント変換は中身を解釈せず、このオブジェクトごと伝播する。
 */
export interface PlayerProfile {
  /** 表示名（displayName、または nameMasked に応じてマスク済みの username） */
  name: string;
  /** avatarUrl が無いときのフォールバック用アバターID */
  avatarId: number;
  avatarUrl: string | null;
  /** ネームプレート装飾（保有バッジから着席時に解決。無装飾は undefined） */
  nameplate?: NameplateDecoration;
}
