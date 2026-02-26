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

  const handleShareToX = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const handName = winnerInfo?.handName ? ` (${winnerInfo.handName})` : '';
    const amount = formatChips(myWinAmount);
    const text = `Baby PLOで+${amount}チップ獲得${handName}\n\n無料PLOポーカーで対戦しよう!`;
    const url = window.location.origin;
    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }, [winnerInfo, myWinAmount, formatChips]);

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
            <div className="text-[3vh] font-bold text-yellow-400 mb-[2vh] animate-amount-pop">
              +{formatChips(animationComplete ? myWinAmount : displayedAmount)}
            </div>
            {animationComplete && (
              <button
                onClick={handleShareToX}
                className="px-[2vh] py-[1vh] text-[1.8vh] font-bold bg-white text-black rounded-full hover:bg-gray-200 active:scale-95 transition-all"
              >
                Xでシェア
              </button>
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
