import { Loader2 } from 'lucide-react';

export function TableMoveOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-[4cqw]">
      <div className="text-center">
        <Loader2 className="w-[10cqw] h-[10cqw] text-blue-400 animate-spin mx-auto mb-[4cqw]" />
        <h2 className="text-[4.5cqw] font-bold text-white mb-[1cqw]">テーブル移動中</h2>
        <p className="text-gray-400 text-[3cqw]">新しいテーブルに移動しています...</p>
      </div>
    </div>
  );
}
