interface SearchingTableScreenProps {
  blindsLabel: string;
  onCancel: () => void;
}

export function SearchingTableScreen({ blindsLabel, onCancel }: SearchingTableScreenProps) {
  return (
    <div className="h-full bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-black/20 border-t-black mx-auto mb-4"></div>
        <p className="text-black text-lg font-bold mb-1">テーブルを検索中...</p>
        <p className="text-black/40 text-sm">{blindsLabel}</p>
        <button
          onClick={onCancel}
          className="mt-8 py-2 px-6 border border-black/20 rounded-xl text-black/50 hover:text-black hover:border-black/40 transition-all text-sm"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
