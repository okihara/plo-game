import { ChevronRight } from 'lucide-react';
import { useSeasonLiveRanking } from '../hooks/useSeasonLiveRanking';

interface SeasonRankBannerProps {
  userId: string;
  /** タップでシーズン RP ランキング全体を開く */
  onOpen?: () => void;
}

/** トナメ画面上部に出す、進行中シーズンの自分の RP 順位 */
export function SeasonRankBanner({ userId, onOpen }: SeasonRankBannerProps) {
  const { data } = useSeasonLiveRanking(userId);
  if (!data) return null;

  const me = data.me;
  const hint = !me
    ? '入賞するとRPが付きます'
    : me.rpToTop != null
      ? `TOP${data.topN}まであと ${me.rpToTop}RP`
      : me.rpToNext != null
        ? `ひとつ上まであと ${me.rpToNext}RP`
        : 'シーズン首位';

  // タップ先がない画面（/tournaments 単体ページ等）では表示のみ
  const Container = onOpen ? 'button' : 'div';

  return (
    <Container
      onClick={onOpen}
      className="w-full flex items-center gap-[3cqw] bg-forest text-white rounded-[3cqw] px-[4cqw] py-[2.5cqw] shadow-[0_2px_8px_rgba(139,126,106,0.2)] active:scale-[0.99] transition-transform text-left"
    >
      <div className="shrink-0">
        <p className="text-[2.4cqw] text-white/80 leading-tight">{data.season.name} RP順位</p>
        {me ? (
          <p className="leading-none mt-[0.5cqw]">
            <span className="text-[6.5cqw] font-extrabold">{me.position}</span>
            <span className="text-[3cqw] font-bold ml-[0.3cqw]">位</span>
            <span className="text-[2.6cqw] text-white/80 ml-[1cqw]">/ {data.rankedPlayers}人</span>
          </p>
        ) : (
          <p className="text-[4cqw] font-extrabold leading-none mt-[0.5cqw]">ランク外</p>
        )}
      </div>
      <div className="flex-1 min-w-0 text-right">
        {me && (
          <p className="leading-none">
            <span className="text-[4.5cqw] font-extrabold">{me.totalRp}</span>
            <span className="text-[2.6cqw] ml-[0.5cqw]">RP</span>
          </p>
        )}
        <p className="text-[2.5cqw] text-white/85 mt-[0.8cqw] truncate">{hint}</p>
      </div>
      {onOpen && <ChevronRight className="w-[4.5cqw] h-[4.5cqw] text-white/80 shrink-0" />}
    </Container>
  );
}
