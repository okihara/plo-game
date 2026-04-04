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

  const copy = DISPLACED_COPY[displacedVariant];

  const overlayProps = isDisplaced
    ? {
        title: '別のタブで接続されました' as const,
        description: copy.subtitle,
        primaryLabel: copy.backLabel,
      }
    : showConnectionError
      ? {
          title: 'エラー' as const,
          description: connectionError as string,
          primaryLabel: 'ロビーに戻る' as const,
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
          onPrimary={onBack}
        />
      )}
    </>
  );
}
