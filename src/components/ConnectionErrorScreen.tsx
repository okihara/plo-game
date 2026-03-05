interface ConnectionErrorScreenProps {
  error: string;
  onBack: () => void;
}

export function ConnectionErrorScreen({ error, onBack }: ConnectionErrorScreenProps) {
  return (
    <div className="h-full w-full light-bg flex items-center justify-center px-[5cqw]">
      <div className="text-center border border-cream-300 rounded-[4cqw] px-[8cqw] py-[10cqw] w-full shadow-[0_4px_16px_rgba(139,126,106,0.1)] bg-white">
        <div className="text-[#C0392B] mb-[3cqw]" style={{ fontSize: '12cqw' }}>!</div>
        <h2 className="text-cream-900 font-bold mb-[2cqw]" style={{ fontSize: '5cqw' }}>エラー</h2>
        <p className="text-cream-600 mb-[6cqw]" style={{ fontSize: '3.5cqw' }}>{error}</p>
        <button
          onClick={onBack}
          className="w-full py-[3cqw] px-[6cqw] border border-cream-300 rounded-[3cqw] font-bold text-cream-700 hover:border-cream-400 transition-all"
          style={{ fontSize: '3.5cqw' }}
        >
          ロビーに戻る
        </button>
      </div>
    </div>
  );
}
