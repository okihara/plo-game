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

  const overlayProps = isDisplaced
    ? {
        title: '別のタブで接続されました' as const,
        description: copy.subtitle,
        primaryLabel: copy.backLabel,
        onPrimary: onBack,
        adornment: undefined as ReactNode | undefined,
      }
    : isReconnecting
      ? {
          title: '再接続中' as const,
          description: 'サーバーとの接続が一時的に切れました。復旧するまでお待ちください。',
          primaryLabel: '戻る',
          onPrimary: onBack,
          adornment: <ReconnectingSpinner /> as ReactNode | undefined,
        }
      : showConnectionError
        ? {
            title: 'エラー' as const,
            description: connectionError as string,
            primaryLabel: connectionErrorPrimaryLabel,
            onPrimary: onConnectionErrorPrimary ?? onBack,
            adornment: undefined as ReactNode | undefined,
          }
        : null;

  return (
    <>
      {children}
      {overlayProps && (
        <AlertDialogOverlay
          title={overlayProps.title}
          description={overlayProps.description}
          primaryLabel={overlayProps.primaryLabel}
          onPrimary={overlayProps.onPrimary}
          adornment={overlayProps.adornment}
        />
      )}
    </>
  );
}
