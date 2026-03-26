import { Loader2 } from 'lucide-react';

export function TableMoveOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-[4cqw]">
      <div className="bg-white rounded-[3cqw] border border-cream-300 shadow-[0_8px_40px_rgba(139,126,106,0.2)] p-[8cqw] text-center">
        <Loader2 className="w-[10cqw] h-[10cqw] text-forest animate-spin mx-auto mb-[4cqw]" />
        <h2 className="text-[4.5cqw] font-bold text-cream-900 mb-[1cqw]">テーブル移動中</h2>
        <p className="text-cream-600 text-[3cqw]">新しいテーブルに移動しています...</p>
      </div>
    </div>
  );
}
