import { useState, useEffect, useCallback } from 'react';
import { GameState } from '../logic';
import { useGameSettings } from '../contexts/GameSettingsContext';

interface ResultOverlayProps {
  state: GameState;
  mySeat: number;
}

export function ResultOverlay({ state, mySeat }: ResultOverlayProps) {
  const { formatChips } = useGameSettings();
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const [animationComplete, setAnimationComplete] = useState(false);

  const myPlayer = state.players[mySeat];
  const hasWinners = state.isHandComplete && state.winners.length > 0;
  const iWon = hasWinners && state.winners.some(w => w.playerId === myPlayer.id);
  const myWinAmount = iWon ? state.winners.find(w => w.playerId === myPlayer.id)!.amount : 0;
  const winnerInfo = hasWinners ? state.winners[0] : null;

  // カウントアップアニメーション（自分が勝った時のみ）
  useEffect(() => {
    if (!iWon || !myWinAmount) {
      setDisplayedAmount(0);
      setAnimationComplete(false);
      return;
    }

    setDisplayedAmount(0);
    setAnimationComplete(false);

    const duration = 1000;
    const startTime = Date.now();
    let animationId: number;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedAmount(Math.floor(myWinAmount * eased));

      if (progress < 1) {
        animationId = requestAnimationFrame(animate);
      } else {
        setAnimationComplete(true);
      }
    };

    // 0.4秒後にカウントアップ開始（タイトルアニメーション後）
    const timeout = setTimeout(() => {
      animationId = requestAnimationFrame(animate);
    }, 400);

    return () => {
      clearTimeout(timeout);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [iWon, myWinAmount]);

  // タップでスキップ
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !animationComplete) {
      setAnimationComplete(true);
      if (iWon) setDisplayedAmount(myWinAmount);
    }
  }, [animationComplete, iWon, myWinAmount]);

  // 勝者がいない場合は表示しない
  if (!hasWinners || !winnerInfo) {
    return null;
  }

  const winner = state.players.find(p => p.id === winnerInfo.playerId);
  if (!winner) return null;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-end pb-[8%] z-[100]"
      onClick={handleOverlayClick}
    >
      <div className="text-center p-[2.5vh] bg-black/80 rounded-2xl mx-[2.5vh] backdrop-blur-sm">
        {iWon ? (
          <>
            <div className="text-[4vh] font-black mb-[2vh] uppercase text-amber-400 animate-win-bounce drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">
              WIN
            </div>
            {winnerInfo.handName && (
              <div className="text-[2.8vh] font-semibold text-gray-200 mb-[2.5vh]">{winnerInfo.handName}</div>
            )}
            <div className="text-[3vh] font-bold text-yellow-400 mb-[3.5vh] animate-amount-pop">
              +{formatChips(animationComplete ? myWinAmount : displayedAmount)}
            </div>
            {state.rake > 0 && (
              <div className="text-[1.8vh] text-gray-400 -mt-[2vh] mb-[2vh]">
                Rake: {formatChips(state.rake)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-[3vh] font-bold mb-[2vh] text-blue-400">
              {winner.name} wins
            </div>
            {winnerInfo.handName && (
              <div className="text-[2.8vh] font-semibold text-gray-200 mb-[2.5vh]">{winnerInfo.handName}</div>
            )}
            <div className="text-[2.5vh] font-semibold text-yellow-400 mb-[3.5vh]">
              {formatChips(winnerInfo.amount)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
