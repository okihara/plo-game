interface ConnectingScreenProps {
  blindsLabel: string;
  onCancel: () => void;
}

export function ConnectingScreen({ blindsLabel, onCancel }: ConnectingScreenProps) {
  return (
    <div className="h-full w-full glass-bg flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-1">Baby PLO</h1>
        <div className="w-12 h-0.5 bg-gradient-to-r from-transparent via-white/30 to-transparent mx-auto mb-6"></div>
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className="bg-emerald-500/20 text-emerald-400 text-sm font-bold px-3 py-1 rounded">PLO</span>
          <span className="text-white/50">{blindsLabel}</span>
        </div>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/20 border-t-emerald-400 mx-auto mb-4"></div>
        <p className="text-white/50">サーバーに接続中...</p>
        <button
          onClick={onCancel}
          className="mt-6 text-white/30 hover:text-white/60 text-sm transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
