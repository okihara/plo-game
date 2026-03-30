import { Card as CardType, getPreFlopEvaluation, calculateOuts, evaluatePLOHand, HandRank } from '../logic';
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
  const preflopEval = useMemo(
    () => isVisible ? getPreFlopEvaluation(holeCards) : null,
    [holeCards, isVisible]
  );

  const postflopInfo = useMemo(() => {
    if (!isVisible || holeCards.length !== 4 || communityCards.length < 3) {
      return null;
    }
    const outs = communityCards.length < 5 ? calculateOuts(holeCards, communityCards) : null;

    // 5枚揃っている場合のみハンドランクを計算
    let handRank: HandRank | null = null;
    if (communityCards.length === 5) {
      handRank = evaluatePLOHand(holeCards, communityCards);
    }

    return { outs, handRank };
  }, [holeCards, communityCards, isVisible]);

  if (!isVisible || holeCards.length === 0 || !preflopEval) return null;

  const isPreflop = communityCards.length < 3;

  return (
    <div className="absolute bottom-[25cqw] left-[0cqw] z-50 pointer-events-auto shrink-0">
      <div className="bg-black/70 border border-gray-600 rounded p-[1cqw] shadow-xl text-[2.5cqw] backdrop-blur-sm w-[20cqw]">
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-[0.3cqw] border-b border-gray-700 pb-[0.3cqw]">
          <span className="text-white font-bold text-[2.5cqw]">オープン評価</span>
        </div>

        {/* プリフロップ評価 */}
        <div className={!isPreflop && postflopInfo ? 'mb-[0.5cqw]' : ''}>
          <div className="text-white font-bold text-[3cqw] mb-[0.3cqw]">
            {preflopEval.score.toFixed(2)}
          </div>
          <div className="flex flex-col gap-[0.1cqw]">
            <EvalItem label="ペア" value={preflopEval.pairRank} positive={!!preflopEval.pairRank} />
            <EvalItem label="A♠" value={preflopEval.hasAceSuited ? "✓" : "-"} positive={preflopEval.hasAceSuited} />
            <EvalItem label="DS" value={preflopEval.isDoubleSuited ? "✓" : "-"} positive={preflopEval.isDoubleSuited} />
            <EvalItem label="SS" value={preflopEval.isSingleSuited ? "✓" : "-"} positive={preflopEval.isSingleSuited} />
            <EvalItem label="Run" value={preflopEval.isRundown ? "✓" : "-"} positive={preflopEval.isRundown} />
            <EvalItem label="Wrap" value={preflopEval.hasWrap ? "✓" : "-"} positive={preflopEval.hasWrap} />
            <EvalItem label="Dng" value={preflopEval.hasDangler ? "!" : "-"} positive={false} negative={preflopEval.hasDangler} />
          </div>
        </div>

        {/* ポストフロップ評価 */}
        {!isPreflop && postflopInfo && (
          <div className="border-t border-gray-700 pt-[0.3cqw]">
            <div className="flex flex-col gap-[0.1cqw]">
              {postflopInfo.handRank && (
                <div className="flex justify-between">
                  <span className="text-gray-400">役</span>
                  <span className="text-yellow-300 font-bold">{postflopInfo.handRank.name}</span>
                </div>
              )}
              {postflopInfo.outs && (
                <>
                  <OutsItem label="F" value={postflopInfo.outs.flushOuts} icon="♣" />
                  <OutsItem label="S" value={postflopInfo.outs.straightOuts} icon="→" />
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

