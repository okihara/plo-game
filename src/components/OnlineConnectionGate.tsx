import type { ReactNode } from 'react';
import { ConnectionErrorScreen } from './ConnectionErrorScreen';

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
   * always: 切断メッセージがあれば常に ConnectionErrorScreen
   * without-game-state: 観戦など、卓状態がまだないときだけエラー画面
   */
  connectionErrorPolicy?: 'always' | 'without-game-state';
  /** connectionErrorPolicy が without-game-state のときに使用 */
  hasGameState?: boolean;
  onBack: () => void;
  children: ReactNode;
};

/**
 * 別タブ接続（displaced）と切断エラーを共通処理し、問題なければ children を表示する。
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
  if (isDisplaced) {
    const { subtitle, backLabel } = DISPLACED_COPY[displacedVariant];
    return (
      <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/90">
        <div className="text-center px-[8%]">
          <p className="text-white font-bold mb-4" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
            別のタブで接続されました
          </p>
          <p className="text-white/70 mb-6" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
            {subtitle}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 rounded-lg border border-white/30 text-white/80 hover:bg-white/10 active:bg-white/20 transition-colors"
            style={{ fontSize: 'min(2vh, 3.5vw)' }}
          >
            {backLabel}
          </button>
        </div>
      </div>
    );
  }

  const showConnectionError =
    connectionError != null &&
    connectionError !== '' &&
    (connectionErrorPolicy !== 'without-game-state' || !hasGameState);

  if (showConnectionError) {
    return <ConnectionErrorScreen error={connectionError} onBack={onBack} />;
  }

  return <>{children}</>;
}
