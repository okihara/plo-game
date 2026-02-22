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
    <div className="absolute top-[3%] left-[2%] z-50 pointer-events-auto">
      <div className="bg-black/70 border border-gray-600 rounded-md p-[1vh] min-w-[18vh] shadow-xl text-[1.2vh] backdrop-blur-sm">
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-[0.8vh] border-b border-gray-700 pb-[0.5vh]">
          <span className="text-white font-bold">オープンハンド評価</span>
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
            スコア: {preflopEval.score.toFixed(2)}
          </div>
          <div className="flex flex-col gap-[0.3vh]">
            <EvalItem label="ペア" value={preflopEval.pairRank} positive={!!preflopEval.pairRank} />
            <EvalItem label="Aスート" value={preflopEval.hasAceSuited ? "あり" : "なし"} positive={preflopEval.hasAceSuited} />
            <EvalItem label="ダブルスート" value={preflopEval.isDoubleSuited ? "あり" : "なし"} positive={preflopEval.isDoubleSuited} />
            <EvalItem label="シングルスート" value={preflopEval.isSingleSuited ? "あり" : "なし"} positive={preflopEval.isSingleSuited} />
            <EvalItem label="ランダウン" value={preflopEval.isRundown ? "あり" : "なし"} positive={preflopEval.isRundown} />
            <EvalItem label="ラップ" value={preflopEval.hasWrap ? "あり" : "なし"} positive={preflopEval.hasWrap} />
            <EvalItem label="ダングラー" value={preflopEval.hasDangler ? "あり" : "なし"} positive={false} negative={preflopEval.hasDangler} />
          </div>
        </div>

        {/* ポストフロップ評価 */}
        {!isPreflop && postflopInfo && (
          <div className="border-t border-gray-700 pt-[0.8vh]">
            <div className="flex flex-col gap-[0.3vh]">
              {postflopInfo.handRank && (
                <div className="flex justify-between">
                  <span className="text-gray-400">ハンド</span>
                  <span className="text-yellow-300 font-bold">{postflopInfo.handRank.name}</span>
                </div>
              )}
              {postflopInfo.outs && (
                <>
                  <OutsItem label="フラッシュ" value={postflopInfo.outs.flushOuts} icon="♣" />
                  <OutsItem label="ストレート" value={postflopInfo.outs.straightOuts} icon="→" />
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

