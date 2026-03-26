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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-[4cqw]">
      <div className="bg-white rounded-[3cqw] border border-cream-300 shadow-[0_8px_40px_rgba(139,126,106,0.2)] p-[8cqw] w-full max-w-[92cqw] text-center">
        <div className="mb-[4cqw]">
          {isWinner ? (
            <div className="w-[20cqw] h-[20cqw] mx-auto bg-forest/15 rounded-full flex items-center justify-center">
              <Trophy className="w-[10cqw] h-[10cqw] text-forest" />
            </div>
          ) : isInTheMoney ? (
            <div className="w-[20cqw] h-[20cqw] mx-auto bg-forest-light/15 rounded-full flex items-center justify-center">
              <Trophy className="w-[10cqw] h-[10cqw] text-forest-light" />
            </div>
          ) : (
            <div className="w-[20cqw] h-[20cqw] mx-auto bg-cream-200 rounded-full flex items-center justify-center">
              <span className="text-[9cqw] leading-none">💀</span>
            </div>
          )}
        </div>

        <h2 className="text-[5cqw] font-bold text-cream-900 mb-[2cqw]">
          {isWinner ? '優勝!' : isInTheMoney ? '入賞!' : 'トーナメント終了'}
        </h2>

        <div className="text-[9cqw] font-black text-cream-900 mb-[1cqw]">
          {position}位
        </div>
        <div className="text-cream-600 text-[3cqw] mb-[6cqw]">
          {totalPlayers}人中
        </div>

        {isInTheMoney && (
          <div className="bg-forest/10 border border-forest/20 rounded-[2.5cqw] py-[3cqw] px-[4cqw] mb-[6cqw]">
            <div className="text-[2.5cqw] text-cream-600 mb-[1cqw]">獲得賞金</div>
            <div className="text-[5cqw] font-bold text-forest">
              {formatChips(prizeAmount)} chips
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-[3cqw] bg-forest hover:bg-forest-light text-white rounded-[2.5cqw] font-bold text-[3.5cqw] transition-colors shadow-[0_4px_20px_rgba(45,90,61,0.3)]"
        >
          ロビーに戻る
        </button>
      </div>
    </div>
  );
}
