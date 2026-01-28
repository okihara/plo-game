import { GameState } from '../logic';

interface ResultOverlayProps {
  state: GameState;
  onNextHand: () => void;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
}

export function ResultOverlay({ state, onNextHand }: ResultOverlayProps) {
  // ハンド完了していない、または勝者がいない（待機中など）場合は表示しない
  if (!state.isHandComplete || state.winners.length === 0) {
    return null;
  }

  const humanPlayer = state.players.find(p => p.isHuman)!;
  const humanWon = state.winners.some(w => w.playerId === humanPlayer.id);
  const winnerInfo = state.winners[0];

  let title = '';
  let details = '';
  let amount = '';

  if (humanWon) {
    const myWinAmount = state.winners.find(w => w.playerId === humanPlayer.id)!.amount;
    title = 'YOU WIN!';
    details = winnerInfo.handName || '';
    amount = `+${formatChips(myWinAmount)}`;
  } else {
    const winner = state.players.find(p => p.id === winnerInfo.playerId)!;
    title = 'YOU LOSE';
    details = `${winner.name}の勝利${winnerInfo.handName ? ` - ${winnerInfo.handName}` : ''}`;
  }

  return (
    <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-end pb-[8%] z-[100] animate-fade-in">
      <div className="text-center p-[2.5vh] bg-black/70 rounded-2xl mx-[2.5vh]">
        <div
          className={`text-[3.5vh] font-black mb-[2vh] uppercase ${
            humanWon
              ? 'text-green-400 drop-shadow-[0_0_2vh_rgba(0,255,0,0.5)]'
              : 'text-red-400 drop-shadow-[0_0_2vh_rgba(255,68,68,0.5)]'
          }`}
        >
          {title}
        </div>
        <div className="text-[2vh] text-gray-400 mb-[2.5vh]">{details}</div>
        {amount && <div className="text-[3vh] font-bold text-yellow-400 mb-[3.5vh]">{amount}</div>}
        <button
          onClick={onNextHand}
          className="py-[2vh] px-[7vh] text-[2.2vh] font-bold bg-gradient-to-b from-green-500 to-green-700 text-white border-none rounded-full cursor-pointer uppercase tracking-wider shadow-[0_0.5vh_1.5vh_rgba(76,175,80,0.4)] min-w-[25vh] active:scale-95 transition-transform"
        >
          次のハンド
        </button>
      </div>
    </div>
  );
}
