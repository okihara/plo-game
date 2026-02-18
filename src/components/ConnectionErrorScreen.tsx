interface ConnectionErrorScreenProps {
  error: string;
  onRetry: () => void;
  onBack: () => void;
}

export function ConnectionErrorScreen({ error, onRetry, onBack }: ConnectionErrorScreenProps) {
  return (
    <div className="h-full w-full light-bg flex items-center justify-center p-4">
      <div className="text-center border border-cream-300 rounded-2xl p-8 max-w-sm shadow-[0_4px_16px_rgba(139,126,106,0.1)] bg-white">
        <div className="text-[#C0392B] text-5xl mb-4">!</div>
        <h2 className="text-cream-900 text-xl font-bold mb-2">接続エラー</h2>
        <p className="text-cream-600 mb-6">{error}</p>
        <div className="space-y-3">
          <button
            onClick={onRetry}
            className="w-full py-3 px-6 bg-forest text-white rounded-xl font-bold hover:bg-forest-light transition-all shadow-md"
          >
            再接続
          </button>
          <button
            onClick={onBack}
            className="w-full py-3 px-6 border border-cream-300 rounded-xl font-bold text-cream-700 hover:border-cream-400 transition-all"
          >
            ロビーに戻る
          </button>
        </div>
      </div>
    </div>
  );
}
