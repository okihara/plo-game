import { DEFAULT_AVATAR_URL } from '@plo/shared';
import { ordinalSuffix } from './RankingUtils';
import { useSeasonLiveRanking, type LiveRankEntry, type LiveRankingView } from '../hooks/useSeasonLiveRanking';

interface SeasonRpRankingProps {
  userId?: string;
}

function RankRow({ entry, isMe }: { entry: LiveRankEntry; isMe: boolean }) {
  return (
    <div
      className={`flex items-center gap-[2cqw] py-[2cqw] px-[2.5cqw] rounded-[2cqw] shadow-[0_2px_8px_rgba(139,126,106,0.12)] ${
        isMe ? 'bg-forest/10 border border-forest/30' : 'bg-white border border-cream-200'
      }`}
    >
      <div className="w-[8cqw] text-center shrink-0">
        <span className="text-[3.2cqw] font-bold text-cream-700">
          {entry.position}<sup className="text-[1.8cqw]">{ordinalSuffix(entry.position)}</sup>
        </span>
      </div>
      <div className="flex items-center gap-[2cqw] flex-1 min-w-0">
        <div className="w-[7cqw] h-[7cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
          <img src={entry.avatarUrl || DEFAULT_AVATAR_URL} alt="" className="w-full h-full object-cover" />
        </div>
        <span className={`text-[3cqw] truncate ${isMe ? 'font-bold text-forest' : 'text-cream-800'}`}>
          {entry.name}
        </span>
      </div>
      <div className="text-right shrink-0">
        <span className="text-[3.2cqw] font-bold text-forest">{entry.totalRp}</span>
        <span className="text-[2.2cqw] text-cream-700 ml-[0.5cqw]">RP</span>
        <div className="text-[2cqw] text-cream-700 leading-none mt-[0.3cqw]">
          {entry.entries}戦{entry.wins > 0 && <span className="text-amber-700 font-bold ml-[1cqw]">優勝{entry.wins}</span>}
        </div>
      </div>
    </div>
  );
}

function MyRankCard({ userId, data }: { userId?: string; data: LiveRankingView }) {
  if (!userId) {
    return (
      <div className="bg-white border border-cream-300 rounded-[3cqw] px-[3cqw] py-[3cqw] text-center text-[2.8cqw] text-cream-700">
        ログインすると自分の順位が表示されます
      </div>
    );
  }

  const me = data.me;
  if (!me) {
    return (
      <div className="bg-white border border-cream-300 rounded-[3cqw] px-[3cqw] py-[3cqw] text-center">
        <p className="text-[3cqw] font-bold text-cream-900">あなたはまだランク外です</p>
        <p className="text-[2.6cqw] text-cream-700 mt-[0.5cqw]">トナメで入賞するとRPが付きます</p>
      </div>
    );
  }

  return (
    <div className="bg-forest text-white rounded-[3cqw] px-[4cqw] py-[3cqw] shadow-[0_2px_8px_rgba(139,126,106,0.2)]">
      <p className="text-[2.6cqw] text-white/80">あなたの順位</p>
      <div className="flex items-end justify-between">
        <p className="leading-none">
          <span className="text-[8cqw] font-extrabold">{me.position}</span>
          <span className="text-[3.4cqw] font-bold ml-[0.5cqw]">位</span>
          <span className="text-[2.8cqw] text-white/80 ml-[1.5cqw]">/ {data.rankedPlayers}人</span>
        </p>
        <p className="leading-none text-right">
          <span className="text-[6cqw] font-extrabold">{me.totalRp}</span>
          <span className="text-[2.8cqw] ml-[0.5cqw]">RP</span>
        </p>
      </div>
      <p className="text-[2.5cqw] text-white/80 mt-[1.5cqw]">
        {me.entries}戦 · 入賞{me.itm}回 · 優勝{me.wins}回{me.best != null && ` · 最高${me.best}位`}
      </p>
      {(me.rpToTop != null || me.rpToNext != null) && (
        <div className="flex gap-[2cqw] mt-[2cqw]">
          {me.rpToTop != null && (
            <span className="bg-white/15 rounded-[1.5cqw] px-[2cqw] py-[1cqw] text-[2.6cqw] font-bold">
              TOP{data.topN}まであと {me.rpToTop}RP
            </span>
          )}
          {me.rpToNext != null && (
            <span className="bg-white/15 rounded-[1.5cqw] px-[2cqw] py-[1cqw] text-[2.6cqw] font-bold">
              {me.rpToNext === 0 ? 'ひとつ上と同点' : `ひとつ上まであと ${me.rpToNext}RP`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 進行中シーズンの RP ランキング（TOP30＋自分の順位と前後） */
export function SeasonRpRanking({ userId }: SeasonRpRankingProps) {
  const { data, loading } = useSeasonLiveRanking(userId);

  if (loading) {
    return (
      <div className="flex flex-col items-center py-[8cqw]">
        <div className="w-[6cqw] h-[6cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
        <p className="text-cream-700 text-[3cqw] mt-[2cqw]">読み込み中...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-[8cqw] text-cream-700 text-[3cqw]">
        ランキングを取得できませんでした
      </div>
    );
  }

  return (
    <div>
      <div className="text-center text-[2.5cqw] text-cream-700 mb-[2cqw]">
        {data.season.name}（{data.season.label}）· 完了トナメ {data.tournamentsCounted}本
      </div>

      <MyRankCard userId={userId} data={data} />

      <h3 className="text-[3.4cqw] font-bold text-cream-900 mt-[4cqw] mb-[1.5cqw]">RPランキング TOP{data.topN}</h3>
      {data.top.length === 0 ? (
        <div className="text-center py-[8cqw] text-cream-700 text-[3cqw]">
          まだRP獲得者がいません
        </div>
      ) : (
        <div className="space-y-[1cqw]">
          {data.top.map(e => <RankRow key={e.userId} entry={e} isMe={e.userId === userId} />)}
        </div>
      )}

      {data.around.length > 0 && (
        <>
          <div className="text-center text-[3.4cqw] text-cream-700 leading-none py-[1.5cqw]">⋮</div>
          <div className="space-y-[1cqw]">
            {data.around.map(e => <RankRow key={e.userId} entry={e} isMe={e.userId === userId} />)}
          </div>
        </>
      )}

      <p className="text-[2.4cqw] text-cream-700 mt-[3cqw] leading-relaxed">
        RPはトナメの入賞賞金 1,000 ごとに 1RP（切り上げ）。シーズン中の完了トナメを通算しています。
      </p>
    </div>
  );
}
