/**
 * tweet モジュールで使う型。Prisma 生成型は値が必要な所だけ再エクスポートする。
 */
export { TweetKind, TweetStatus } from '@prisma/client';

export interface PromptResult {
  text: string;
  promptVersion: string;
  /** プロンプト構築に使った構造化データ。承認画面で「生成に使った材料」として参照可能にするため保存。 */
  promptInputJson: unknown;
  /** 添付画像の絶対パス（kind により付ける/付けない）。未指定なら添付なし。 */
  attachedImagePath?: string;
}
