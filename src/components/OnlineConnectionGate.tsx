import type { ReactNode } from 'react';
import { AlertDialogOverlay } from './AlertDialog';

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
  displacedVariant?: OnlineConnectionDisplacedVariant;
  connectionError: string | null;
  connectionErrorPolicy?: 'always' | 'without-game-state';
  hasGameState?: boolean;
  /** auto-reconnect 中: エラーではなく「再接続中」のオーバーレイを出す */
  isReconnecting?: boolean;
  onBack: () => void;
  /** 切断エラー時の主ボタンラベル（既定は「ロビーに戻る」） */
  connectionErrorPrimaryLabel?: string;
  /** 切断エラー時の主ボタン処理（既定は onBack） */
  onConnectionErrorPrimary?: () => void;
  children: ReactNode;
};

/** 再接続中オーバーレイの adornment（くるくる回るスピナー） */
function ReconnectingSpinner() {
  return (
    <div
      className="animate-spin mx-auto rounded-full border-cream-300 border-t-cream-700"
      style={{ width: '10cqw', height: '10cqw', borderWidth: '1cqw' }}
      aria-hidden
    />
  );
}

/**
 * 別タブ接続（displaced）・auto-reconnect 中・切断エラーをゲーム画面に重ねて表示する。
 * 優先度: displaced > reconnecting > connectionError。
 */
export function OnlineConnectionGate({
  isDisplaced,
  displacedVariant = 'play',
  connectionError,
  connectionErrorPolicy = 'always',
  hasGameState = false,
  isReconnecting = false,
  onBack,
  connectionErrorPrimaryLabel = 'ロビーに戻る',
  onConnectionErrorPrimary,
  children,
}: OnlineConnectionGateProps) {
  const showConnectionError =
    connectionError != null &&
    connectionError !== '' &&
    (connectionErrorPolicy !== 'without-game-state' || !hasGameState);

  const copy = DISPLACED_COPY[displacedVariant];

  const alertOverlayProps = isDisplaced
    ? {
        title: '別のタブで接続されました' as const,
        description: copy.subtitle,
        primaryLabel: copy.backLabel,
        onPrimary: onBack,
      }
    : showConnectionError && !isReconnecting
      ? {
          title: 'エラー' as const,
          description: connectionError as string,
          primaryLabel: connectionErrorPrimaryLabel,
          onPrimary: onConnectionErrorPrimary ?? onBack,
        }
      : null;

  // 再接続中は displaced を優先しつつ、エラーオーバーレイより上に出す
  const showReconnecting = isReconnecting && !isDisplaced;

  return (
    <>
      {children}
      {alertOverlayProps && (
        <AlertDialogOverlay
          title={alertOverlayProps.title}
          description={alertOverlayProps.description}
          primaryLabel={alertOverlayProps.primaryLabel}
          onPrimary={alertOverlayProps.onPrimary}
        />
      )}
      {showReconnecting && (
        <div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 px-[5cqw]"
          role="status"
          aria-live="polite"
        >
          <div className="text-center border border-cream-300 rounded-[4cqw] px-[8cqw] py-[10cqw] w-full max-w-[min(92vw,36rem)] shadow-[0_4px_24px_rgba(0,0,0,0.35)] bg-white">
            <div className="mb-[3cqw]">
              <ReconnectingSpinner />
            </div>
            <h2 className="text-cream-900 font-bold mb-[2cqw]" style={{ fontSize: '5cqw' }}>
              再接続中
            </h2>
            <p className="text-cream-700" style={{ fontSize: '3.5cqw' }}>
              サーバーとの接続が一時的に切れました。復旧するまでお待ちください。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
