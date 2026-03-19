import { Trophy } from 'lucide-react';

interface EliminationOverlayProps {
  position: number;
  totalPlayers: number;
  prizeAmount: number;
  onClose: () => void;
}

function formatChips(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  return String(amount);
}

function getOrdinal(n: number): string {
  return `${n}位`;
}

export function EliminationOverlay({ position, totalPlayers, prizeAmount, onClose }: EliminationOverlayProps) {
  const isWinner = position === 1;
  const isInTheMoney = prizeAmount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 p-8 max-w-sm w-full mx-4 text-center">
        {/* Icon */}
        <div className="mb-4">
          {isWinner ? (
            <div className="w-20 h-20 mx-auto bg-yellow-500/20 rounded-full flex items-center justify-center">
              <Trophy className="w-10 h-10 text-yellow-400" />
            </div>
          ) : isInTheMoney ? (
            <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
              <Trophy className="w-10 h-10 text-green-400" />
            </div>
          ) : (
            <div className="w-20 h-20 mx-auto bg-gray-700/50 rounded-full flex items-center justify-center">
              <span className="text-3xl">💀</span>
            </div>
          )}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold mb-2">
          {isWinner ? '優勝!' : isInTheMoney ? '入賞!' : 'トーナメント終了'}
        </h2>

        {/* Position */}
        <div className="text-4xl font-black mb-1">
          {getOrdinal(position)}
        </div>
        <div className="text-gray-400 text-sm mb-6">
          {totalPlayers}人中
        </div>

        {/* Prize */}
        {isInTheMoney && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl py-3 px-4 mb-6">
            <div className="text-xs text-yellow-400/70 mb-1">獲得賞金</div>
            <div className="text-2xl font-bold text-yellow-400">
              {formatChips(prizeAmount)} chips
            </div>
          </div>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-colors"
        >
          ロビーに戻る
        </button>
      </div>
    </div>
  );
}
