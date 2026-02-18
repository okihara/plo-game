interface SearchingTableScreenProps {
  blindsLabel: string;
  onCancel: () => void;
}

export function SearchingTableScreen({ blindsLabel, onCancel }: SearchingTableScreenProps) {
  return (
    <div className="h-full light-bg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cream-300 border-t-forest mx-auto mb-4"></div>
        <p className="text-cream-900 text-lg font-bold mb-1">テーブルを検索中...</p>
        <p className="text-cream-600 text-sm">{blindsLabel}</p>
        <button
          onClick={onCancel}
          className="mt-8 py-2 px-6 bg-white border border-cream-300 rounded-xl text-cream-600 hover:text-cream-900 hover:bg-cream-50 hover:border-cream-400 transition-all text-sm"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
