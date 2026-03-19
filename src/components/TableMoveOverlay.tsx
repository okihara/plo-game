import { Loader2 } from 'lucide-react';

export function TableMoveOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-1">テーブル移動中</h2>
        <p className="text-gray-400 text-sm">新しいテーブルに移動しています...</p>
      </div>
    </div>
  );
}
