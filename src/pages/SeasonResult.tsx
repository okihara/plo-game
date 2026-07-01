import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

type SeasonTab = 'overall' | 'me';

interface SeasonResultProps {
  onBack: () => void;
}

interface SeasonAwardRank {
  key: string;
  title: string;
  emoji: string;
  rank: number;
  total: number;
  valueLabel: string;
}

interface MateRef {
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
}

interface PlayerStats {
  userId: string;
  rpRank: number | null;
  totalRp: number;
  tournaments: number;
  entries: number;
  reentries: number;
  wins: number;
  itm: number;
  best: number | null;
  totalRoi: number | null;
  avgRoi: number | null;
  hands: number;
  vpip: number | null;
  pfr: number | null;
  afq: number | null;
  threeBet: number | null;
  wsd: number | null;
  allinHands: number;
  allinWins: number;
  allinWinRate: number | null;
  maxPotWon: number;
  knockouts: number;
  topTableMate: MateRef | null;
  topHuMate: MateRef | null;
  awardRanks: SeasonAwardRank[];
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
  stats: { tournaments: number; participants: number; rankedPlayers: number; totalEntries: number; handsScanned: number };
  ranking: RankEntry[];
  awards: Award[];
}

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

function navigateToPlayer(userId: string) {
  window.history.pushState({}, '', `/player/${userId}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const signedPct = (n: number | null) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`);
const roiAccent = (n: number | null): 'forest' | 'red' | undefined => (n == null ? undefined : n >= 0 ? 'forest' : 'red');

// 1〜3位のランクバッジ配色（絵文字は使わず色で表現）
const RANK_BADGE: Record<number, string> = {
  1: 'bg-amber-400 text-white',
  2: 'bg-slate-300 text-slate-800',
  3: 'bg-orange-400 text-white',
};

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

function StatRow({ label, value, accent }: { label: string; value: string; accent?: 'forest' | 'red' }) {
  const color = accent === 'forest' ? 'text-forest' : accent === 'red' ? 'text-[#C0392B]' : 'text-cream-900';
  return (
    <div className="flex items-center justify-between bg-white border border-cream-300 rounded-[2cqw] px-[3cqw] py-[2.2cqw]">
      <span className="text-[3cqw] text-cream-700">{label}</span>
      <span className={`text-[3.6cqw] font-extrabold ${color}`}>{value}</span>
    </div>
  );
}

function MateRow({ label, mate, unit }: { label: string; mate: MateRef | null; unit: string }) {
  return (
    <div className="flex items-center gap-[2cqw] bg-white border border-cream-300 rounded-[2cqw] px-[3cqw] py-[2cqw]">
      <span className="text-[3cqw] text-cream-700 shrink-0">{label}</span>
      {mate ? (
        <button
          onClick={() => navigateToPlayer(mate.userId)}
          className="flex items-center gap-[1.5cqw] flex-1 min-w-0 justify-end active:opacity-70"
        >
          <Avatar url={mate.avatarUrl} name={mate.name} size="w-[6cqw] h-[6cqw]" />
          <span className="text-[3cqw] font-bold text-cream-900 truncate">{mate.name}</span>
          <span className="text-[2.6cqw] text-cream-700 shrink-0">
            {mate.count}
            {unit}
          </span>
        </button>
      ) : (
        <span className="flex-1 text-right text-[2.8cqw] text-cream-700">—</span>
      )}
    </div>
  );
}

function RankRow({ e }: { e: RankEntry }) {
  const top10 = e.position <= 10;
  const medal = RANK_BADGE[e.position]; // 1〜3位
  const badgeClass = medal ?? (top10 ? 'bg-forest text-white' : 'text-cream-700');
  return (
    <button
      onClick={() => navigateToPlayer(e.userId)}
      className={`w-full flex items-center gap-[2cqw] px-[3cqw] py-[2cqw] rounded-[2cqw] active:scale-[0.99] transition-all ${
        top10
          ? 'bg-white border border-cream-300 shadow-[0_2px_8px_rgba(139,126,106,0.12)]'
          : 'bg-cream-100 border border-transparent'
      }`}
    >
      <span
        className={`rounded-full flex items-center justify-center font-extrabold shrink-0 ${
          top10 ? 'w-[7.5cqw] h-[7.5cqw] text-[3.4cqw]' : 'w-[6.5cqw] h-[6.5cqw] text-[3cqw]'
        } ${badgeClass}`}
      >
        {e.position}
      </span>
      <Avatar url={e.avatarUrl} name={e.name} size={top10 ? 'w-[8.5cqw] h-[8.5cqw]' : 'w-[7cqw] h-[7cqw]'} />
      <span className={`flex-1 min-w-0 text-left font-bold truncate ${top10 ? 'text-[3.3cqw] text-cream-900' : 'text-[3cqw] text-cream-800'}`}>
        {e.name}
      </span>
      <div className="text-right shrink-0">
        <span className={`font-extrabold text-forest ${top10 ? 'text-[4.2cqw]' : 'text-[3.4cqw]'}`}>{e.totalRp}</span>
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
      <div>
        <p className="text-[3.4cqw] font-bold text-cream-900 leading-tight">{award.title}</p>
        <p className="text-[2.4cqw] text-cream-700 leading-tight">{award.description}</p>
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

function PersonalSection({ player, rankedPlayers, viewerName, viewerAvatar }: {
  player: PlayerStats;
  rankedPlayers: number;
  viewerName: string;
  viewerAvatar: string | null;
}) {
  // 相対順位（賞レースで上位なものから並べる＝得意分野が先頭に来る）
  const awardRanks = [...player.awardRanks].sort((a, b) => a.rank / a.total - b.rank / b.total);

  return (
    <div className="mt-[3cqw]">
      {/* RP順位ヒーロー（横並び） */}
      <div className="bg-gradient-to-br from-forest to-forest-dark rounded-[3cqw] p-[3cqw] flex items-center gap-[3cqw] text-white">
        <Avatar url={viewerAvatar} name={viewerName} size="w-[13cqw] h-[13cqw] ring-[0.5cqw] ring-white/40" />
        <div className="min-w-0 flex-1">
          <p className="text-[3.4cqw] font-bold truncate">{viewerName}</p>
          {player.rpRank ? (
            <p className="text-[2.6cqw] text-white/70 leading-tight">
              RPランキング <span className="text-[6cqw] font-extrabold text-white align-middle">{player.rpRank}</span>
              <span className="text-[3cqw]"> 位</span>
              <span className="text-white/60"> / {rankedPlayers}人</span>
            </p>
          ) : (
            <p className="text-[2.8cqw] text-white/70 mt-[0.5cqw]">RP獲得なし（入賞でRPが付きます）</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[6cqw] font-extrabold leading-none">{player.totalRp}</p>
          <p className="text-[2.4cqw] text-white/60">RP</p>
        </div>
      </div>

      {/* トーナメント成績（縦） */}
      <h3 className="text-[3cqw] font-bold text-forest mt-[3cqw] mb-[1.5cqw]">トーナメント成績</h3>
      <div className="flex flex-col gap-[1.2cqw]">
        <StatRow label="出場" value={num(player.tournaments)} />
        <StatRow label="優勝" value={num(player.wins)} accent={player.wins > 0 ? 'forest' : undefined} />
        <StatRow label="入賞（ITM）" value={num(player.itm)} />
        <StatRow label="最高順位" value={player.best != null ? `${player.best}位` : '—'} />
        <StatRow label="総エントリー" value={num(player.entries)} />
        <StatRow label="リエントリー" value={num(player.reentries)} />
        <StatRow label="ITM率" value={player.tournaments > 0 ? `${Math.round((player.itm / player.tournaments) * 100)}%` : '—'} />
        <StatRow label="総ROI" value={signedPct(player.totalRoi)} accent={roiAccent(player.totalRoi)} />
        <StatRow label="平均ROI" value={signedPct(player.avgRoi)} accent={roiAccent(player.avgRoi)} />
        <StatRow label="撃墜数" value={`${num(player.knockouts)}KO`} />
        <StatRow label="最大ポット" value={num(player.maxPotWon)} />
      </div>

      {/* ハンドスタッツ（縦） */}
      <h3 className="text-[3cqw] font-bold text-forest mt-[3cqw] mb-[1.5cqw]">ハンドスタッツ（トナメ）</h3>
      <div className="flex flex-col gap-[1.2cqw]">
        <StatRow label="ハンド数" value={num(player.hands)} />
        <StatRow label="VPIP" value={pct(player.vpip)} />
        <StatRow label="PFR" value={pct(player.pfr)} />
        <StatRow label="AFq" value={pct(player.afq)} />
        <StatRow label="3Bet" value={pct(player.threeBet)} />
        <StatRow label="W$SD" value={pct(player.wsd)} />
        <StatRow label="オールイン回数" value={`${num(player.allinHands)}回`} />
        <StatRow label="オールイン勝利" value={`${num(player.allinWins)}回`} />
        <StatRow label="オールイン勝率" value={pct(player.allinWinRate)} />
      </div>

      {/* よく対戦したプレイヤー（縦） */}
      <h3 className="text-[3cqw] font-bold text-forest mt-[3cqw] mb-[1.5cqw]">よく対戦したプレイヤー</h3>
      <div className="flex flex-col gap-[1.2cqw]">
        <MateRow label="一番同卓" mate={player.topTableMate} unit="ハンド" />
        <MateRow label="一番ヘッズアップ" mate={player.topHuMate} unit="回" />
      </div>

      {/* 賞レース順位（縦） */}
      {awardRanks.length > 0 && (
        <>
          <h3 className="text-[3cqw] font-bold text-forest mt-[3cqw] mb-[1.5cqw]">賞レース順位</h3>
          <div className="flex flex-col gap-[1.2cqw]">
            {awardRanks.map((a) => (
              <div
                key={a.key}
                className={`flex items-center gap-[2cqw] px-[3cqw] py-[2cqw] rounded-[2cqw] border ${
                  a.rank === 1 ? 'bg-amber-50 border-amber-300' : 'bg-white border-cream-300'
                }`}
              >
                <span className="flex-1 min-w-0 text-[3cqw] font-bold text-cream-900 truncate">{a.title}</span>
                <span className="text-[2.6cqw] text-cream-700 shrink-0">{a.valueLabel}</span>
                <span className={`text-[3.4cqw] font-extrabold shrink-0 ${a.rank === 1 ? 'text-amber-600' : 'text-forest'}`}>
                  {a.rank}
                  <span className="text-[2.4cqw] text-cream-700 font-normal">/{a.total}位</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function SeasonResult({ onBack }: SeasonResultProps) {
  const { user } = useAuth();
  const [data, setData] = useState<SeasonData | null>(null);
  const [player, setPlayer] = useState<PlayerStats | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<SeasonTab>('overall');
  const scrollRef = useRef<HTMLDivElement>(null);

  // タブ切替時はスクロール位置を先頭に戻す
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [tab]);

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

  // 閲覧者本人の個人データ（ログイン時のみ）
  useEffect(() => {
    if (!user?.id) {
      setPlayer(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/season/player/${user.id}`, { credentials: 'include' });
        const d = await res.json();
        if (!alive) return;
        if (d && d.ready) {
          setPlayer(d.player ?? null);
        } else {
          timer = setTimeout(load, 3000);
        }
      } catch {
        /* 個人データは取得失敗しても致命的ではないので無視 */
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [user?.id]);

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
        <p className="text-[2.8cqw] text-cream-700">全ハンドを計算しています。少々お待ちください</p>
      </div>
    );
  }

  const categories = [...new Set(data.awards.map((a) => a.category))];
  const showTabs = !!(user && player);
  const showMe = showTabs && tab === 'me';

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto light-bg">
      {/* Hero */}
      <div className="bg-[linear-gradient(110deg,#2D5A3D_0%,#3D7A53_50%,#E0872A_105%)] px-[4cqw] pt-[3cqw] pb-[5cqw] shadow-[0_8px_30px_rgba(29,58,39,0.4)]">
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
        {/* シーズン集計サマリー（横並び） */}
        <div className="flex justify-center gap-[4.5cqw] mt-[3cqw] text-center text-white">
          {[
            ['開催トナメ', data.stats.tournaments],
            ['参加人数', data.stats.participants],
            ['RP獲得者', data.stats.rankedPlayers],
            ['延べ参加', data.stats.totalEntries],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[4.6cqw] font-extrabold leading-none">{Number(value).toLocaleString()}</p>
              <p className="text-[2.3cqw] text-white/60 mt-[0.5cqw]">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 全体結果 / あなたの成績 タブ（ログイン時のみ） */}
      {showTabs && (
        <div className="px-[4cqw] mt-[3cqw]">
          <div className="flex gap-[1cqw] bg-cream-100 rounded-[2.5cqw] p-[0.8cqw] border border-cream-300">
            {(['overall', 'me'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-[2cqw] rounded-[2cqw] text-[3.2cqw] font-bold transition-colors ${
                  tab === t ? 'bg-forest text-white' : 'text-cream-700'
                }`}
              >
                {t === 'overall' ? '全体結果' : 'あなたの成績'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-[4cqw] pb-[10cqw]">
        {showMe ? (
          <PersonalSection
            player={player!}
            rankedPlayers={data.stats.rankedPlayers}
            viewerName={user!.displayName || user!.username}
            viewerAvatar={(user!.useTwitterAvatar && user!.twitterAvatarUrl ? user!.twitterAvatarUrl : user!.avatarUrl) ?? null}
          />
        ) : (
          <>
            {/* RPランキング（縦、1〜30位を一列） */}
            <h2 className="text-[4cqw] font-bold text-cream-900 mt-[4cqw] mb-[1.5cqw]">RPランキング TOP10</h2>
            <div className="flex flex-col gap-[1.2cqw]">
              {data.ranking.map((e) => (
                <RankRow key={e.userId} e={e} />
              ))}
            </div>

            {/* シーズンアワード（縦） */}
            <h2 className="text-[4cqw] font-bold text-cream-900 mt-[6cqw] mb-[1cqw]">シーズンアワード</h2>
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
              みんなシーズン1お疲れさま！シーズン2もよろしく
            </p>
          </>
        )}
      </div>
    </div>
  );
}
