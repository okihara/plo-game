import { Card as CardType, getPreFlopEvaluation, calculateEquity, calculateOuts, evaluatePLOHand, HandRank } from '../logic';
import { useMemo } from 'react';

interface HandAnalysisOverlayProps {
  holeCards: CardType[];
  communityCards: CardType[];
  isVisible: boolean;
  onClose: () => void;
}

export function HandAnalysisOverlay({
  holeCards,
  communityCards,
  isVisible,
  onClose,
}: HandAnalysisOverlayProps) {
  const preflopEval = useMemo(() => getPreFlopEvaluation(holeCards), [holeCards]);

  const postflopInfo = useMemo(() => {
    if (communityCards.length < 3) {
      return null;
    }
    const equity = calculateEquity(holeCards, communityCards, 5, 300);
    const outs = communityCards.length < 5 ? calculateOuts(holeCards, communityCards) : null;

    // 5枚揃っている場合のみハンドランクを計算
    let handRank: HandRank | null = null;
    if (communityCards.length === 5) {
      handRank = evaluatePLOHand(holeCards, communityCards);
    }

    return { equity, outs, handRank };
  }, [holeCards, communityCards]);

  if (!isVisible || holeCards.length === 0) return null;

  const isPreflop = communityCards.length < 3;

  return (
    <div className="fixed top-[1vh] left-[1vh] z-50 pointer-events-auto">
      <div className="bg-black/90 border border-gray-600 rounded-md p-[1vh] min-w-[18vh] shadow-xl text-[1.2vh]">
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-[0.8vh] border-b border-gray-700 pb-[0.5vh]">
          <span className="text-white font-bold">Analysis</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-[1.5vh] leading-none"
          >
            ×
          </button>
        </div>

        {/* プリフロップ評価 */}
        <div className="mb-[1vh]">
          <div className="text-white font-bold text-[1.5vh] mb-[0.5vh]">
            Score: {preflopEval.score.toFixed(2)}
          </div>
          <div className="flex flex-col gap-[0.3vh]">
            <EvalItem label="Pair" value={preflopEval.pairRank} positive={!!preflopEval.pairRank} />
            <EvalItem label="A-suited" value={preflopEval.hasAceSuited ? "Yes" : "No"} positive={preflopEval.hasAceSuited} />
            <EvalItem label="DS" value={preflopEval.isDoubleSuited ? "Yes" : "No"} positive={preflopEval.isDoubleSuited} />
            <EvalItem label="SS" value={preflopEval.isSingleSuited ? "Yes" : "No"} positive={preflopEval.isSingleSuited} />
            <EvalItem label="Rundown" value={preflopEval.isRundown ? "Yes" : "No"} positive={preflopEval.isRundown} />
            <EvalItem label="Wrap" value={preflopEval.hasWrap ? "Yes" : "No"} positive={preflopEval.hasWrap} />
            <EvalItem label="Dangler" value={preflopEval.hasDangler ? "Yes" : "No"} positive={false} negative={preflopEval.hasDangler} />
          </div>
        </div>

        {/* ポストフロップ評価 */}
        {!isPreflop && postflopInfo && (
          <div className="border-t border-gray-700 pt-[0.8vh]">
            <div className="flex flex-col gap-[0.3vh]">
              {postflopInfo.handRank && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Hand</span>
                  <span className="text-yellow-300 font-bold">{postflopInfo.handRank.name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Equity</span>
                <span className={`font-bold ${getEquityColor(postflopInfo.equity)}`}>
                  {postflopInfo.equity.toFixed(0)}%
                </span>
              </div>
              {postflopInfo.outs && (
                <>
                  <OutsItem label="Flush" value={postflopInfo.outs.flushOuts} icon="♣" />
                  <OutsItem label="Straight" value={postflopInfo.outs.straightOuts} icon="→" />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 評価項目コンポーネント
function EvalItem({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string | null;
  positive: boolean;
  negative?: boolean;
}) {
  const colorClass = negative
    ? 'text-red-400'
    : positive
    ? 'text-green-400'
    : 'text-gray-500';

  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={colorClass}>{value || '-'}</span>
    </div>
  );
}

// アウツ項目コンポーネント
function OutsItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: string;
}) {
  if (value === 0) {
    return (
      <div className="flex justify-between">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-500">-</span>
      </div>
    );
  }

  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-cyan-400">{icon}{value}</span>
    </div>
  );
}

function getEquityColor(equity: number): string {
  if (equity >= 60) return 'text-yellow-300';
  if (equity >= 40) return 'text-green-400';
  if (equity >= 25) return 'text-blue-400';
  return 'text-gray-400';
}
