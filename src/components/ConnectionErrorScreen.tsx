import { useId } from 'react';
import { AlertDialogCard } from './AlertDialog';

interface ConnectionErrorScreenProps {
  error: string;
  onBack: () => void;
}

/** 接続エラー専用の全画面 */
export function ConnectionErrorScreen({ error, onBack }: ConnectionErrorScreenProps) {
  const titleId = useId();

  return (
    <div className="h-full w-full light-bg flex items-center justify-center px-[5cqw]">
      <AlertDialogCard
        titleId={titleId}
        title="エラー"
        description={error}
        primaryLabel="ロビーに戻る"
        onPrimary={onBack}
      />
    </div>
  );
}
