interface ConnectionErrorScreenProps {
  error: string;
  onRetry: () => void;
  onBack: () => void;
}

export function ConnectionErrorScreen({ error, onRetry, onBack }: ConnectionErrorScreenProps) {
  return (
    <div className="h-full w-full bg-white flex items-center justify-center p-4">
      <div className="text-center border border-black/20 rounded-2xl p-8 max-w-sm shadow-2xl">
        <div className="text-red-500 text-5xl mb-4">!</div>
        <h2 className="text-black text-xl font-bold mb-2">接続エラー</h2>
        <p className="text-black/50 mb-6">{error}</p>
        <div className="space-y-3">
          <button
            onClick={onRetry}
            className="w-full py-3 px-6 bg-black text-white rounded-xl font-bold hover:bg-black/80 transition-all shadow-md"
          >
            再接続
          </button>
          <button
            onClick={onBack}
            className="w-full py-3 px-6 border border-black/20 rounded-xl font-bold text-black/70 hover:border-black/40 transition-all"
          >
            ロビーに戻る
          </button>
        </div>
      </div>
    </div>
  );
}
