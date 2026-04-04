interface ConnectionErrorPanelProps {
  error: string;
  onBack: () => void;
}

/** エラー文言と「ロビーに戻る」ボタンのカード（オーバーレイ用・全画面用で共通） */
export function ConnectionErrorPanel({ error, onBack }: ConnectionErrorPanelProps) {
  return (
    <div className="text-center border border-cream-300 rounded-[4cqw] px-[8cqw] py-[10cqw] w-full max-w-[min(92vw,36rem)] shadow-[0_4px_24px_rgba(0,0,0,0.35)] bg-white">
      <div className="text-[#C0392B] mb-[3cqw]" style={{ fontSize: '12cqw' }}>
        !
      </div>
      <h2 className="text-cream-900 font-bold mb-[2cqw]" style={{ fontSize: '5cqw' }}>
        エラー
      </h2>
      <p className="text-cream-600 mb-[6cqw]" style={{ fontSize: '3.5cqw' }}>
        {error}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="w-full py-[3cqw] px-[6cqw] border border-cream-300 rounded-[3cqw] font-bold text-cream-700 hover:border-cream-400 transition-all"
        style={{ fontSize: '3.5cqw' }}
      >
        ロビーに戻る
      </button>
    </div>
  );
}

interface ConnectionErrorScreenProps {
  error: string;
  onBack: () => void;
}

/** 接続エラー専用の全画面（オーバーレイにしない場合の単体利用） */
export function ConnectionErrorScreen({ error, onBack }: ConnectionErrorScreenProps) {
  return (
    <div className="h-full w-full light-bg flex items-center justify-center px-[5cqw]">
      <ConnectionErrorPanel error={error} onBack={onBack} />
    </div>
  );
}
