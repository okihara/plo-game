import { Trophy } from 'lucide-react';
import { formatChips } from '../utils/formatChips';

interface EliminationOverlayProps {
  position: number;
  totalPlayers: number;
  prizeAmount: number;
  onClose: () => void;
}

export function EliminationOverlay({ position, totalPlayers, prizeAmount, onClose }: EliminationOverlayProps) {
  const isWinner = position === 1;
  const isInTheMoney = prizeAmount > 0;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm px-[4cqw]">
      <div className="bg-gray-900 rounded-[3cqw] border border-gray-700 p-[8cqw] w-full max-w-[92cqw] text-center">
        <div className="mb-[4cqw]">
          {isWinner ? (
            <div className="w-[20cqw] h-[20cqw] mx-auto bg-yellow-500/20 rounded-full flex items-center justify-center">
              <Trophy className="w-[10cqw] h-[10cqw] text-yellow-400" />
            </div>
          ) : isInTheMoney ? (
            <div className="w-[20cqw] h-[20cqw] mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
              <Trophy className="w-[10cqw] h-[10cqw] text-green-400" />
            </div>
          ) : (
            <div className="w-[20cqw] h-[20cqw] mx-auto bg-gray-700/50 rounded-full flex items-center justify-center">
              <span className="text-[9cqw] leading-none">💀</span>
            </div>
          )}
        </div>

        <h2 className="text-[5cqw] font-bold mb-[2cqw]">
          {isWinner ? '優勝!' : isInTheMoney ? '入賞!' : 'トーナメント終了'}
        </h2>

        <div className="text-[9cqw] font-black mb-[1cqw]">
          {position}位
        </div>
        <div className="text-gray-400 text-[3cqw] mb-[6cqw]">
          {totalPlayers}人中
        </div>

        {isInTheMoney && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-[2.5cqw] py-[3cqw] px-[4cqw] mb-[6cqw]">
            <div className="text-[2.5cqw] text-yellow-400/70 mb-[1cqw]">獲得賞金</div>
            <div className="text-[5cqw] font-bold text-yellow-400">
              {formatChips(prizeAmount)} chips
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-[3cqw] bg-gray-700 hover:bg-gray-600 rounded-[2.5cqw] font-bold text-[3.5cqw] transition-colors"
        >
          ロビーに戻る
        </button>
      </div>
    </div>
  );
}
