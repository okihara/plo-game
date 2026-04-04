import type { ReactNode } from 'react';
import { ConnectionErrorPanel } from './ConnectionErrorScreen';

const DISPLACED_COPY = {
  play: {
    subtitle: 'このタブでの接続は切断されました',
    backLabel: 'ロビーに戻る',
  },
  spectate: {
    subtitle: '観戦用の接続が切断されました（プレイ中の卓はそのままです）',
    backLabel: '戻る',
  },
} as const;

export type OnlineConnectionDisplacedVariant = keyof typeof DISPLACED_COPY;

type OnlineConnectionGateProps = {
  isDisplaced: boolean;
  /** 別タブ接続時の説明文・戻るラベル（既定は play） */
  displacedVariant?: OnlineConnectionDisplacedVariant;
  connectionError: string | null;
  /**
   * always: 切断メッセージがあれば常にエラーダイアログ
   * without-game-state: 観戦など、卓状態がまだないときだけ
   */
  connectionErrorPolicy?: 'always' | 'without-game-state';
  /** connectionErrorPolicy が without-game-state のときに使用 */
  hasGameState?: boolean;
  onBack: () => void;
  children: ReactNode;
};

/**
 * 別タブ接続（displaced）と切断エラーをゲーム画面に重ねて表示する。
 */
export function OnlineConnectionGate({
  isDisplaced,
  displacedVariant = 'play',
  connectionError,
  connectionErrorPolicy = 'always',
  hasGameState = false,
  onBack,
  children,
}: OnlineConnectionGateProps) {
  const showConnectionError =
    connectionError != null &&
    connectionError !== '' &&
    (connectionErrorPolicy !== 'without-game-state' || !hasGameState);

  return (
    <>
      {children}
      {isDisplaced && (
        <div
          className="fixed inset-0 z-[230] flex items-center justify-center bg-black/65 px-[8%]"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="online-connection-displaced-title"
        >
          <div className="text-center max-w-md">
            <p
              id="online-connection-displaced-title"
              className="text-white font-bold mb-4"
              style={{ fontSize: 'min(2.5vh, 4.5vw)' }}
            >
              別のタブで接続されました
            </p>
            <p className="text-white/80 mb-6" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
              {DISPLACED_COPY[displacedVariant].subtitle}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 rounded-lg border border-white/40 text-white/90 hover:bg-white/10 active:bg-white/20 transition-colors"
              style={{ fontSize: 'min(2vh, 3.5vw)' }}
            >
              {DISPLACED_COPY[displacedVariant].backLabel}
            </button>
          </div>
        </div>
      )}
      {!isDisplaced && showConnectionError && (
        <div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 px-[5cqw]"
          role="alertdialog"
          aria-modal="true"
          aria-label="接続エラー"
        >
          <ConnectionErrorPanel error={connectionError} onBack={onBack} />
        </div>
      )}
    </>
  );
}
