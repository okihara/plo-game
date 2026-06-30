import { useEffect, useState } from 'react';

interface SeasonResultProps {
  onBack: () => void;
}

interface RankEntry {
  position: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  totalRp: number;
  entries: number;
  wins: number;
  itm: number;
  best: number | null;
}

interface AwardWinner {
  userId: string;
  name: string;
  avatarUrl: string | null;
  value: number;
  valueLabel: string;
}

interface Award {
  key: string;
  category: string;
  title: string;
  emoji: string;
  description: string;
  winner: AwardWinner | null;
  runnersUp: AwardWinner[];
}

interface SeasonData {
  season: { name: string; label: string; start: string; end: string };
  stats: { tournaments: number; rankedPlayers: number; totalEntries: number; handsScanned: number };
  ranking: RankEntry[];
  awards: Award[];
}

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

function navigateToPlayer(userId: string) {
  window.history.pushState({}, '', `/player/${userId}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Avatar({ url, name, size }: { url: string | null; name: string; size: string }) {
  if (url) {
    return <img src={url} alt={name} className={`${size} rounded-full object-cover border border-cream-300 shrink-0`} />;
  }
  return (
    <div className={`${size} rounded-full bg-forest/15 text-forest font-bold flex items-center justify-center shrink-0 border border-cream-300`}>
      {name.slice(0, 1)}
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];
const PODIUM_RING = ['ring-amber-400', 'ring-slate-300', 'ring-orange-400'];
// ポディウムの並び: 2位・1位・3位
const PODIUM_ORDER = [1, 0, 2];

function Podium({ top3 }: { top3: RankEntry[] }) {
  return (
    <div className="flex items-end justify-center gap-[2cqw] mt-[3cqw]">
      {PODIUM_ORDER.map((idx) => {
        const e = top3[idx];
        if (!e) return <div key={idx} className="flex-1" />;
        const isFirst = idx === 0;
        const heights = ['h-[26cqw]', 'h-[20cqw]', 'h-[16cqw]'];
        return (
          <button
            key={idx}
            onClick={() => navigateToPlayer(e.userId)}
            className="flex-1 flex flex-col items-center gap-[1cqw] active:scale-[0.97] transition-transform"
          >
            <span className={`${isFirst ? 'text-[7cqw]' : 'text-[5.5cqw]'} leading-none`}>{MEDALS[idx]}</span>
            <Avatar url={e.avatarUrl} name={e.name} size={isFirst ? 'w-[15cqw] h-[15cqw] ring-[0.6cqw]' : 'w-[11cqw] h-[11cqw] ring-[0.5cqw]'} />
            <span className="text-[2.8cqw] font-bold text-cream-900 truncate max-w-full px-[1cqw]">{e.name}</span>
            <div className={`w-full ${heights[idx]} rounded-t-[2cqw] bg-gradient-to-b from-forest to-forest-dark border-[0.4cqw] ${PODIUM_RING[idx]} flex flex-col items-center justify-center text-white`}>
              <span className="text-[5cqw] font-extrabold leading-none">{e.totalRp}</span>
              <span className="text-[2.4cqw] text-white/70">RP</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RankRow({ e }: { e: RankEntry }) {
  const top10 = e.position <= 10;
  return (
    <button
      onClick={() => navigateToPlayer(e.userId)}
      className={`w-full flex items-center gap-[2cqw] px-[3cqw] py-[2cqw] rounded-[2cqw] active:scale-[0.99] transition-all ${
        top10 ? 'bg-white border border-cream-300' : 'bg-cream-100'
      }`}
    >
      <span className={`w-[7cqw] text-center font-bold ${top10 ? 'text-forest text-[3.6cqw]' : 'text-cream-700 text-[3.2cqw]'}`}>{e.position}</span>
      <Avatar url={e.avatarUrl} name={e.name} size="w-[7cqw] h-[7cqw]" />
      <span className="flex-1 min-w-0 text-left text-[3.2cqw] font-bold text-cream-900 truncate">{e.name}</span>
      <div className="text-right shrink-0">
        <span className="text-[3.6cqw] font-extrabold text-forest">{e.totalRp}</span>
        <span className="text-[2.4cqw] text-cream-700 ml-[0.5cqw]">RP</span>
        <div className="text-[2.3cqw] text-cream-700 leading-none mt-[0.3cqw]">
          {e.entries}戦 {e.wins > 0 && <span className="text-amber-600 font-bold">優勝{e.wins}</span>}
        </div>
      </div>
    </button>
  );
}

function AwardCard({ award }: { award: Award }) {
  const w = award.winner;
  return (
    <div className="bg-white border border-cream-300 rounded-[3cqw] p-[3cqw] flex flex-col gap-[1.5cqw]">
      <div className="flex items-center gap-[1.5cqw]">
        <span className="text-[6cqw] leading-none">{award.emoji}</span>
        <div className="min-w-0">
          <p className="text-[3.4cqw] font-bold text-cream-900 leading-tight">{award.title}</p>
          <p className="text-[2.4cqw] text-cream-700 leading-tight">{award.description}</p>
        </div>
      </div>
      {w ? (
        <button
          onClick={() => navigateToPlayer(w.userId)}
          className="flex items-center gap-[2cqw] bg-cream-100 rounded-[2cqw] px-[2.5cqw] py-[2cqw] active:scale-[0.98] transition-transform"
        >
          <Avatar url={w.avatarUrl} name={w.name} size="w-[9cqw] h-[9cqw]" />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[3.4cqw] font-bold text-cream-900 truncate">{w.name}</p>
            <p className="text-[2.8cqw] font-bold text-forest">{w.valueLabel}</p>
          </div>
        </button>
      ) : (
        <div className="bg-cream-100 rounded-[2cqw] px-[2.5cqw] py-[2.5cqw] text-center text-[2.8cqw] text-cream-700">
          該当者なし
        </div>
      )}
      {award.runnersUp.length > 0 && (
        <div className="flex flex-col gap-[0.8cqw]">
          {award.runnersUp.map((r, i) => (
            <button
              key={r.userId}
              onClick={() => navigateToPlayer(r.userId)}
              className="flex items-center gap-[1.5cqw] px-[1cqw] active:opacity-70"
            >
              <span className="text-[2.6cqw] text-cream-700 w-[4cqw]">{i + 2}位</span>
              <Avatar url={r.avatarUrl} name={r.name} size="w-[5cqw] h-[5cqw]" />
              <span className="flex-1 min-w-0 text-left text-[2.7cqw] text-cream-800 truncate">{r.name}</span>
              <span className="text-[2.6cqw] text-cream-700 shrink-0">{r.valueLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SeasonResult({ onBack }: SeasonResultProps) {
  const [data, setData] = useState<SeasonData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/season`, { credentials: 'include' });
        const d = await res.json();
        if (!alive) return;
        if (d && d.ready) {
          setData(d);
        } else {
          // サーバーが裏で集計中（202 ready:false）→ 少し待って再取得
          timer = setTimeout(load, 3000);
        }
      } catch {
        if (alive) setError(true);
      }
    };

    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center light-bg px-[8cqw] text-center">
        <p className="text-[3.5cqw] text-cream-700 mb-[4cqw]">読み込みに失敗しました</p>
        <button onClick={onBack} className="px-[6cqw] py-[2.5cqw] text-[3.5cqw] bg-forest text-white rounded-[2cqw] font-bold">
          ロビーに戻る
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center light-bg gap-[2cqw]">
        <p className="text-[4cqw] text-cream-900 font-bold">シーズン1を集計中...</p>
        <p className="text-[2.8cqw] text-cream-700">全ハンドを計算しています。少々お待ちください 🃏</p>
      </div>
    );
  }

  const categories = [...new Set(data.awards.map((a) => a.category))];

  return (
    <div className="h-full overflow-y-auto light-bg">
      {/* Hero */}
      <div className="bg-gradient-to-b from-forest to-forest-dark px-[4cqw] pt-[3cqw] pb-[5cqw] rounded-b-[4cqw] shadow-[0_8px_30px_rgba(29,58,39,0.4)]">
        <div className="flex items-center">
          <button onClick={onBack} className="text-white/80 hover:text-white text-[3.2cqw] font-bold">
            ← 戻る
          </button>
        </div>
        <div className="text-center mt-[2cqw]">
          <p className="text-[3cqw] text-white/70 tracking-widest">SEASON 1 FINAL RESULT</p>
          <h1 className="text-[7cqw] font-extrabold text-white leading-tight mt-[0.5cqw]">{data.season.name} 結果発表</h1>
          <p className="text-[3cqw] text-white/70 mt-[0.5cqw]">{data.season.label}</p>
        </div>
        <div className="flex justify-center gap-[6cqw] mt-[3cqw] text-center text-white">
          <div>
            <p className="text-[5cqw] font-extrabold leading-none">{data.stats.tournaments}</p>
            <p className="text-[2.4cqw] text-white/60 mt-[0.5cqw]">開催トナメ</p>
          </div>
          <div>
            <p className="text-[5cqw] font-extrabold leading-none">{data.stats.rankedPlayers}</p>
            <p className="text-[2.4cqw] text-white/60 mt-[0.5cqw]">ランクイン</p>
          </div>
          <div>
            <p className="text-[5cqw] font-extrabold leading-none">{data.stats.totalEntries.toLocaleString()}</p>
            <p className="text-[2.4cqw] text-white/60 mt-[0.5cqw]">延べ参加</p>
          </div>
        </div>
      </div>

      <div className="px-[4cqw] pb-[10cqw]">
        {/* TOP10 表彰 */}
        <h2 className="text-[4cqw] font-bold text-cream-900 mt-[4cqw] mb-[1cqw]">🏅 RPランキング TOP10</h2>
        {data.ranking.length >= 3 && <Podium top3={data.ranking.slice(0, 3)} />}
        <div className="flex flex-col gap-[1.2cqw] mt-[3cqw]">
          {data.ranking.slice(3).map((e) => (
            <RankRow key={e.userId} e={e} />
          ))}
        </div>

        {/* Awards */}
        <h2 className="text-[4cqw] font-bold text-cream-900 mt-[6cqw] mb-[1cqw]">🎉 シーズンアワード</h2>
        <p className="text-[2.6cqw] text-cream-700 mb-[2cqw]">トーナメントの全ハンドから集計した特別賞</p>
        {categories.map((cat) => (
          <div key={cat} className="mt-[3cqw]">
            <h3 className="text-[3.2cqw] font-bold text-forest mb-[1.5cqw]">{cat}</h3>
            <div className="flex flex-col gap-[2cqw]">
              {data.awards
                .filter((a) => a.category === cat)
                .map((a) => (
                  <AwardCard key={a.key} award={a} />
                ))}
            </div>
          </div>
        ))}

        <p className="text-[2.6cqw] text-cream-700 text-center mt-[6cqw]">
          みんなシーズン1お疲れさま！シーズン2もよろしく 🃏
        </p>
      </div>
    </div>
  );
}
