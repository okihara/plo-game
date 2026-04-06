import { MiniCard } from './HandHistoryUtils';

export interface HandSummaryForResult {
  handId: string;
  holeCards: string[];
  communityCards: string[];
  finalHand: string | null;
  profit: number;
  potSize: number;
}

interface HandStatsForOverlay {
  lastHand: HandSummaryForResult | null;
  bestHand: HandSummaryForResult | null;
  worstHand: HandSummaryForResult | null;
  totalHands: number;
}

interface EliminationOverlayProps {
  position: number;
  totalPlayers: number;
  prizeAmount: number;
  tournamentName?: string;
  playerName?: string;
  handStats?: HandStatsForOverlay;
  closeLabel?: string;
  onClose: () => void;
}

/** English ordinal suffix for a number (1st, 2nd, 3rd, 4th …) */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Format today as YYYY.MM.DD */
function todayLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function HandStatRow({ label, hand }: { label: string; hand: HandSummaryForResult }) {
  return (
    <div className="flex items-center justify-between gap-[2cqw]">
      <span className="text-cream-700 text-[2.6cqw] font-medium shrink-0">{label}</span>
      <div className="flex items-center gap-[0.5cqw]">
        {hand.holeCards.map((c, i) => (
          <MiniCard key={i} cardStr={c} />
        ))}
      </div>
    </div>
  );
}

export function EliminationOverlay({
  position,
  totalPlayers,
  prizeAmount: _prizeAmount,
  tournamentName,
  playerName,
  handStats,
  closeLabel = 'ロビーに戻る',
  onClose,
}: EliminationOverlayProps) {
  const isWinner = position === 1;
  const isTop3 = position <= 3;
  // カード左帯と順位テキストの色を順位で変える
  const accentColor = isWinner
    ? '#b8860b'          // gold
    : isTop3
      ? '#6b7280'        // silver-gray
      : '#4a7c5c';       // forest

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm px-[6cqw]">
      {/* カード本体 */}
      <div className="relative bg-white rounded-[2cqw] shadow-[0_12px_60px_rgba(0,0,0,0.35)] w-full max-w-[88cqw] h-[120cqw] overflow-hidden">
        {/* 左の帯（本の背表紙風） */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[5cqw] rounded-l-[2cqw]"
          style={{ backgroundColor: accentColor }}
        />

        {/* コンテンツ */}
        <div className="pl-[11cqw] pr-[6cqw] py-[10cqw] text-center h-full flex flex-col justify-center">
          {/* 順位（ヒーロー要素） */}
          <div
            className="font-black leading-none mb-[4cqw]"
            style={{
              fontSize: position < 100 ? '26cqw' : '19cqw',
              color: accentColor,
              letterSpacing: '-0.02em',
            }}
          >
            {ordinal(position)}
          </div>

          {/* 日付 */}
          <div className="text-cream-700 text-[3.2cqw] tracking-wider mb-[1.5cqw]">
            {todayLabel()}
          </div>

          {/* トーナメント名 */}
          {tournamentName && (
            <div className="text-cream-800 font-bold text-[3.8cqw] mb-[1.5cqw] leading-snug">
              {tournamentName}
            </div>
          )}

          {/* 参加者数 */}
          <div className="text-cream-700 text-[3.2cqw] mb-[5cqw]">
            {totalPlayers} entries
          </div>

          {/* ハンド統計 or 順位メッセージ */}
          <div
            className="inline-block rounded-[2cqw] px-[5cqw] py-[2.5cqw] mb-[5cqw]"
            style={{ backgroundColor: `${accentColor}12`, border: `1px solid ${accentColor}30` }}
          >
            {handStats && handStats.totalHands > 0 ? (
              <div className="flex flex-col gap-[1.5cqw]">
                {handStats.lastHand && (
                  <HandStatRow label="Last Hand" hand={handStats.lastHand} />
                )}
                {handStats.bestHand && (
                  <HandStatRow label="Best Hand" hand={handStats.bestHand} />
                )}
                {handStats.worstHand && (
                  <HandStatRow label="Worst Hand" hand={handStats.worstHand} />
                )}
              </div>
            ) : (
              <div className="text-cream-700 text-[3.8cqw] py-[1cqw]">
                {totalPlayers}人中 {position}位
              </div>
            )}
          </div>

          {/* プレイヤー名 */}
          {playerName && (
            <div className="mb-[2cqw] border-b border-cream-400 pb-[1cqw] inline-block mx-auto">
              <span className="text-cream-700 text-[2.8cqw]">Name: </span>
              <span className="text-cream-800 font-bold text-[4cqw]">
                {playerName}
              </span>
            </div>
          )}

          {/* サイトロゴ */}
          <img
            src="/images/plo_baby.png"
            alt="BabyPLO"
            className="mx-auto w-[12cqw] h-[12cqw] object-contain mb-[1cqw] opacity-90 rounded-full"
          />
          <div className="text-cream-900 text-[2.8cqw] tracking-[0.3em]">
            BabyPLO
          </div>
        </div>
      </div>

      {/* ボタン（カード外） */}
      <button
        type="button"
        onClick={onClose}
        className="w-full max-w-[88cqw] mt-[4cqw] py-[3cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3.5cqw] transition-colors shadow-[0_4px_20px_rgba(45,90,61,0.3)]"
      >
        {closeLabel}
      </button>
    </div>
  );
}
