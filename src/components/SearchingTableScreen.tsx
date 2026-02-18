interface SearchingTableScreenProps {
  blindsLabel: string;
  onCancel: () => void;
}

export function SearchingTableScreen({ blindsLabel, onCancel }: SearchingTableScreenProps) {
  return (
    <div className="h-full glass-bg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/20 border-t-emerald-400 mx-auto mb-4"></div>
        <p className="text-white text-lg font-bold mb-1">テーブルを検索中...</p>
        <p className="text-white/40 text-sm">{blindsLabel}</p>
        <button
          onClick={onCancel}
          className="mt-8 py-2 px-6 bg-white/[0.07] border border-white/[0.12] rounded-xl text-white/50 hover:text-white hover:bg-white/[0.12] hover:border-white/[0.2] transition-all text-sm backdrop-blur-xl"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
