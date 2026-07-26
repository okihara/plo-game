import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import {
  computeItmInfo,
  computeStackMetrics,
  getBigBlindUnit,
  type ClientTournamentState,
  type MZone,
  type TournamentStandingEntry,
} from '@plo/shared';
import { useCountdown } from '../hooks/useCountdown';
import { useTournamentStandings } from '../hooks/useTournamentStandings';
import { getAvatarImage } from './ProfilePopup';

/** プライズ・ブラインド・スタック表示専用（bb / K / M などの省略なし） */
function formatChipsAbsolute(amount: number): string {
  return Math.round(amount).toLocaleString('ja-JP');
}

function prizeOrdinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}TH`;
  switch (n % 10) {
    case 1:
      return `${n}ST`;
    case 2:
      return `${n}ND`;
    case 3:
      return `${n}RD`;
    default:
      return `${n}TH`;
  }
}

/** ブラインドの表記。bomb pot は sb=bb=0 なので ante だけを出す。 */
function formatBlinds(level: { smallBlind: number; bigBlind: number; ante: number }): string {
  const hasBlinds = level.smallBlind > 0 || level.bigBlind > 0;
  if (!hasBlinds) return `ante ${formatChipsAbsolute(level.ante)}`;
  const base = `${formatChipsAbsolute(level.smallBlind)}/${formatChipsAbsolute(level.bigBlind)}`;
  return level.ante > 0 ? `${base} (${formatChipsAbsolute(level.ante)})` : base;
}

const FINAL_LEVEL_CLOCK = '--:--';

const CARD_CLASS = 'bg-white rounded-[3cqw] border border-cream-300 shadow-sm p-[3.5cqw]';
const CARD_TITLE_CLASS =
  'text-[2.6cqw] font-bold uppercase tracking-wide text-cream-600';

/** ゾーンは文字では出さず、数値の色だけで示す */
const M_ZONE_TEXT: Record<MZone, string> = {
  green: 'text-forest',
  yellow: 'text-cream-700',
  orange: 'text-amber-600',
  red: 'text-poker-red',
  dead: 'text-poker-red',
};

interface TournamentClockPanelProps {
  tournamentState: ClientTournamentState;
  myChips: number | null;
  /** 自分の odId。観戦モードでは null（ハイライトもスタックカードも出さない） */
  myOdId?: string | null;
  /** 自席テーブルの人数。M レシオの補正に使う */
  tableSize?: number;
  onClose: () => void;
}

export function TournamentClockPanel({
  tournamentState: ts,
  myChips,
  myOdId = null,
  tableSize = 6,
  onClose,
}: TournamentClockPanelProps) {
  const isFinalBlindLevel = ts.nextBlindLevel == null;
  const levelClock = useCountdown(isFinalBlindLevel ? null : ts.nextLevelAt);
  const { standings, loading, error, refetch } = useTournamentStandings(ts.tournamentId, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bl = ts.currentBlindLevel;

  const stackMetrics = useMemo(
    () =>
      myChips == null
        ? null
        : computeStackMetrics({
            chips: myChips,
            level: bl,
            variant: ts.gameVariant,
            tableSize,
            averageStack: ts.averageStack,
          }),
    [myChips, bl, ts.gameVariant, tableSize, ts.averageStack],
  );

  const itm = useMemo(
    () => computeItmInfo(ts.playersRemaining, ts.payoutStructure),
    [ts.playersRemaining, ts.payoutStructure],
  );

  const myRank = myOdId ? standings?.entries.find(e => e.odId === myOdId)?.rank ?? null : null;
  const myBubbleFactor = myOdId ? ts.bubbleFactors?.[myOdId] : undefined;

  // 順位はスタンディング由来なので母数も同じスナップショットから取る。
  // ts.playersRemaining はブロードキャストが先に届く分だけ進んでいることがあり、
  // 混ぜると「#12 / 11」のような表示になる。
  const standingsPlayersRemaining = standings?.playersRemaining ?? ts.playersRemaining;

  if (typeof document === 'undefined') return null;
  const viewport = document.getElementById('plo-viewport');
  if (!viewport) return null;

  const shell = (
    <div
      className="absolute inset-0 z-[285] flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative flex h-[92%] w-[94%] min-h-0 flex-col overflow-hidden rounded-[4cqw] light-bg shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tournament-clock-title"
        onClick={e => e.stopPropagation()}
      >
        {/* —— ヘッダー —— */}
        <header className="shrink-0 flex items-center gap-[2cqw] border-b border-cream-300 bg-white px-[4cqw] py-[3cqw] shadow-sm">
          <div className="min-w-0 flex-1">
            <h2
              id="tournament-clock-title"
              className="truncate text-[3.4cqw] font-bold leading-snug tracking-tight text-cream-900"
            >
              {ts.name}
            </h2>
            <p className="mt-[0.4cqw] truncate text-[2.6cqw] tabular-nums text-cream-600">
              Lv.{bl.level} · {formatBlinds(bl)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[7cqw] w-[7cqw] shrink-0 items-center justify-center rounded-full text-cream-700 active:bg-cream-200"
            aria-label="閉じる"
          >
            <X className="h-[4.5cqw] w-[4.5cqw]" />
          </button>
        </header>

        {/* —— 本体 —— */}
        <div className="light-scrollbar min-h-0 flex-1 space-y-[3cqw] overflow-y-auto overscroll-contain px-[4cqw] py-[3cqw] pb-[4cqw]">
          <ClockCard
            clock={isFinalBlindLevel ? FINAL_LEVEL_CLOCK : levelClock ?? FINAL_LEVEL_CLOCK}
            ts={ts}
          />

          {myChips != null && stackMetrics && (
            <MyStackCard
              myChips={myChips}
              metrics={stackMetrics}
              rank={myRank}
              playersRemaining={standingsPlayersRemaining}
              bubbleFactor={myBubbleFactor}
            />
          )}

          <ItmCard ts={ts} itm={itm} />

          <StandingsCard
            entries={standings?.entries ?? null}
            averageStack={standings?.averageStack ?? ts.averageStack}
            playersRemaining={standingsPlayersRemaining}
            bbUnit={getBigBlindUnit(bl)}
            myOdId={myOdId}
            loading={loading}
            error={error}
            onRetry={refetch}
          />

          <DeadlineCard ts={ts} />
        </div>

        {/* —— フッター —— */}
        <footer className="shrink-0 border-t border-cream-300 bg-white px-[4cqw] py-[1.8cqw] shadow-[0_-4px_12px_rgba(139,126,106,0.08)]">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[2cqw] bg-forest py-[2cqw] text-[3.2cqw] font-bold text-white shadow-sm transition-transform active:scale-[0.99]"
          >
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(shell, viewport);
}

// ============================================
// ① クロック
// ============================================

function ClockCard({ clock, ts }: { clock: string; ts: ClientTournamentState }) {
  const bl = ts.currentBlindLevel;
  const levelDurationMs = bl.durationMinutes * 60_000;
  // 現レベルの開始時刻は nextLevelAt から逆算できるので、サーバーから別途もらう必要はない
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (ts.nextBlindLevel == null || levelDurationMs <= 0) {
      setProgress(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, ts.nextLevelAt - Date.now());
      setProgress(Math.min(1, Math.max(0, 1 - remaining / levelDurationMs)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ts.nextLevelAt, ts.nextBlindLevel, levelDurationMs]);

  return (
    <section className={CARD_CLASS}>
      <h3 className={CARD_TITLE_CLASS}>次のレベルまで</h3>
      <div className="mt-[1cqw] text-center font-mono text-[11cqw] font-black leading-none tabular-nums tracking-tight text-cream-900">
        {clock}
      </div>
      <div className="mt-[2.5cqw] h-[1.2cqw] w-full overflow-hidden rounded-full bg-cream-200">
        <div
          className="h-full rounded-full bg-forest transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="mt-[3cqw] flex gap-[2cqw]">
        <StatTile label="レベル" value={`Lv.${bl.level}`} />
        <StatTile label="現在" value={formatBlinds(bl)} />
        <StatTile label="次" value={ts.nextBlindLevel ? formatBlinds(ts.nextBlindLevel) : '—'} />
      </div>
    </section>
  );
}

// ============================================
// ② 自分のスタック
// ============================================

function MyStackCard({
  myChips,
  metrics,
  rank,
  playersRemaining,
  bubbleFactor,
}: {
  myChips: number;
  metrics: ReturnType<typeof computeStackMetrics>;
  rank: number | null;
  playersRemaining: number;
  bubbleFactor: number | undefined;
}) {
  return (
    <section className={CARD_CLASS}>
      <div className="flex items-end justify-between gap-[2cqw]">
        <div className="min-w-0">
          <h3 className={CARD_TITLE_CLASS}>My Stack</h3>
          <div className="mt-[0.5cqw] text-[6cqw] font-black leading-none tabular-nums text-cream-900">
            {formatChipsAbsolute(myChips)}
          </div>
        </div>
        <div className="shrink-0 rounded-[2cqw] bg-cream-100 px-[2.5cqw] py-[1.4cqw] text-center">
          <div className="text-[2.3cqw] text-cream-600">順位</div>
          <div className="text-[3.6cqw] font-bold tabular-nums text-cream-900">
            {rank != null ? `#${rank}` : '#—'}
            <span className="text-[2.4cqw] font-medium text-cream-600"> / {playersRemaining}</span>
          </div>
        </div>
      </div>

      <div className="mt-[3cqw] flex gap-[2cqw]">
        <StatTile label="残り" value={`${metrics.bigBlinds.toFixed(1)}BB`} />
        <StatTile
          label="Mレシオ"
          value={metrics.m.toFixed(1)}
          valueClass={M_ZONE_TEXT[metrics.zone]}
        />
        <StatTile label="平均比" value={`${metrics.averageStackRatio.toFixed(2)}x`} />
        {bubbleFactor != null && <StatTile label="BF" value={bubbleFactor.toFixed(2)} />}
      </div>
    </section>
  );
}

// ============================================
// ③ ITM / バブル
// ============================================

function ItmCard({
  ts,
  itm,
}: {
  ts: ClientTournamentState;
  itm: ReturnType<typeof computeItmInfo>;
}) {
  const [showPayouts, setShowPayouts] = useState(false);
  const payouts = useMemo(
    () => [...ts.payoutStructure].sort((a, b) => a.position - b.position),
    [ts.payoutStructure],
  );

  return (
    <section className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-[2cqw]">
        <h3 className={CARD_TITLE_CLASS}>賞金圏</h3>
        {itm.paidPlaces > 0 && (
          <span className="shrink-0 text-[2.4cqw] tabular-nums text-cream-600">
            入賞 {itm.paidPlaces}人
          </span>
        )}
      </div>

      {itm.paidPlaces === 0 ? (
        <p className="mt-[2cqw] text-[3cqw] text-cream-600">賞金構造は確定していません</p>
      ) : (
        <>
          <div className="mt-[2cqw]">
            {itm.isInTheMoney ? (
              <span className="inline-block rounded-full bg-forest px-[3cqw] py-[1cqw] text-[3cqw] font-bold text-white">
                ITM 確定
              </span>
            ) : (
              <div className="flex items-baseline gap-[1.5cqw]">
                <span className="text-[3cqw] text-cream-700">インマネまであと</span>
                <span className="text-[6cqw] font-black leading-none tabular-nums text-cream-900">
                  {itm.playersToItm}
                </span>
                <span className="text-[3cqw] text-cream-700">人</span>
              </div>
            )}
          </div>

          <dl className="mt-[2.5cqw] space-y-[1.4cqw] text-[2.9cqw] leading-snug">
            <div className="flex justify-between gap-[2cqw]">
              <dt className="text-cream-600">今飛ぶと</dt>
              <dd className="text-right font-semibold tabular-nums text-cream-900">
                {itm.bustNowPosition}位 ／{' '}
                {itm.bustNowPrize > 0 ? formatChipsAbsolute(itm.bustNowPrize) : '賞金なし'}
              </dd>
            </div>
            <div className="flex justify-between gap-[2cqw]">
              <dt className="text-cream-600">次の賞金アップ</dt>
              <dd className="text-right font-semibold tabular-nums text-cream-900">
                {itm.playersToNextJump != null && itm.nextJumpPrize != null
                  ? `あと${itm.playersToNextJump}人 ／ ${formatChipsAbsolute(itm.nextJumpPrize)}`
                  : '—'}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => setShowPayouts(v => !v)}
            className="mt-[2.5cqw] flex w-full items-center justify-between rounded-[2cqw] bg-cream-100 px-[2.5cqw] py-[1.6cqw] text-[2.8cqw] font-semibold text-cream-700 active:bg-cream-200"
            aria-expanded={showPayouts}
          >
            賞金一覧
            <ChevronDown
              className={`h-[3.5cqw] w-[3.5cqw] transition-transform ${showPayouts ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {showPayouts && (
            <ul className="light-scrollbar mt-[1.5cqw] max-h-[45cqw] space-y-[0.8cqw] overflow-y-auto text-[2.9cqw]">
              {payouts.map(p => (
                <li
                  key={p.position}
                  className="flex justify-between gap-[2cqw] border-b border-cream-200 pb-[0.8cqw] last:border-b-0"
                >
                  <span className="font-medium text-cream-700">{prizeOrdinal(p.position)}</span>
                  <span className="font-semibold tabular-nums text-cream-900">
                    {formatChipsAbsolute(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-[2.5cqw] flex items-baseline justify-between gap-[2cqw] border-t border-cream-200 pt-[2cqw]">
        <span className="text-[2.4cqw] font-medium uppercase tracking-tight text-cream-600">
          Total Prize Pool
        </span>
        <span className="text-[3.8cqw] font-bold tabular-nums text-cream-900">
          {formatChipsAbsolute(ts.prizePool)}
        </span>
      </div>
    </section>
  );
}

// ============================================
// ④ チップスタンディング
// ============================================

function StandingsCard({
  entries,
  averageStack,
  playersRemaining,
  bbUnit,
  myOdId,
  loading,
  error,
  onRetry,
}: {
  entries: TournamentStandingEntry[] | null;
  averageStack: number;
  playersRemaining: number;
  bbUnit: number;
  myOdId: string | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const chipLeader = entries?.[0]?.chips ?? null;
  const shortStack = entries && entries.length > 0 ? entries[entries.length - 1].chips : null;

  return (
    <section className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-[2cqw]">
        <h3 className={CARD_TITLE_CLASS}>チップスタンディング</h3>
        <span className="shrink-0 text-[2.4cqw] tabular-nums text-cream-600">
          残り {playersRemaining}人
        </span>
      </div>

      <div className="mt-[2.5cqw] flex gap-[2cqw]">
        <StatTile
          label="チップリーダー"
          value={chipLeader != null ? formatChipsAbsolute(chipLeader) : '—'}
        />
        <StatTile label="平均" value={formatChipsAbsolute(averageStack)} />
        <StatTile
          label="ショート"
          value={shortStack != null ? formatChipsAbsolute(shortStack) : '—'}
        />
      </div>

      {error && !entries ? (
        <div className="mt-[3cqw] text-center">
          <p className="text-[2.9cqw] text-cream-600">順位を取得できませんでした</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-[1.5cqw] rounded-[2cqw] bg-cream-100 px-[3cqw] py-[1.4cqw] text-[2.8cqw] font-semibold text-cream-700 active:bg-cream-200"
          >
            再試行
          </button>
        </div>
      ) : !entries ? (
        <ul className="mt-[2.5cqw] space-y-[1.2cqw]" aria-busy={loading}>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="h-[7cqw] animate-pulse rounded-[1.5cqw] bg-cream-200" />
          ))}
        </ul>
      ) : (
        <ul className="mt-[2.5cqw]">
          {entries.map(entry => {
            const isMe = myOdId != null && entry.odId === myOdId;
            return (
              <li
                key={entry.odId}
                className={`flex items-center gap-[2cqw] border-b border-cream-200 py-[1.6cqw] last:border-b-0 ${
                  isMe ? 'rounded-[1.5cqw] border-l-[0.8cqw] border-l-forest bg-forest/10 pl-[1.5cqw]' : ''
                }`}
              >
                <span
                  className={`w-[7cqw] shrink-0 text-[3cqw] font-bold tabular-nums ${rankColor(entry.rank)}`}
                >
                  {entry.rank}
                </span>
                <img
                  src={entry.avatarUrl || getAvatarImage(entry.avatarId)}
                  alt=""
                  className="h-[6cqw] w-[6cqw] shrink-0 rounded-full object-cover"
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[3cqw] ${
                    entry.status === 'disconnected' ? 'text-cream-500' : 'text-cream-800'
                  }`}
                >
                  {entry.name}
                  {entry.status === 'disconnected' && (
                    <span className="ml-[1cqw] rounded-[1cqw] bg-cream-200 px-[1cqw] py-[0.2cqw] text-[2.1cqw] text-cream-600">
                      切断
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[3cqw] font-bold tabular-nums text-cream-900">
                    {formatChipsAbsolute(entry.chips)}
                  </span>
                  {bbUnit > 0 && (
                    <span className="block text-[2.2cqw] tabular-nums text-cream-600">
                      {(entry.chips / bbUnit).toFixed(1)}BB
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function rankColor(rank: number): string {
  if (rank === 1) return 'text-poker-gold';
  if (rank === 2) return 'text-cream-500';
  if (rank === 3) return 'text-amber-700';
  return 'text-cream-600';
}

// ============================================
// ⑤ 締切
// ============================================

function DeadlineCard({ ts }: { ts: ClientTournamentState }) {
  const registrationCountdown = useCountdown(ts.isRegistrationOpen ? ts.registrationDeadlineAt : null);
  const reentryCountdown = useCountdown(ts.allowReentry ? ts.reentryDeadlineAt : null);

  const reentryOpen =
    ts.allowReentry && ts.reentryDeadlineAt != null && ts.reentryDeadlineAt > Date.now();

  return (
    <section className={CARD_CLASS}>
      <h3 className={CARD_TITLE_CLASS}>締切</h3>
      <dl className="mt-[2cqw] space-y-[1.6cqw] text-[2.9cqw] leading-snug">
        <div className="flex justify-between gap-[2cqw]">
          <dt className="text-cream-600">レイト登録締切まで</dt>
          <dd
            className={`text-right font-semibold tabular-nums ${
              registrationCountdown ? 'text-cream-900' : 'text-cream-500'
            }`}
          >
            {registrationCountdown ?? '締切済み'}
          </dd>
        </div>
        <div className="flex justify-between gap-[2cqw]">
          <dt className="text-cream-600">リエントリー締切まで</dt>
          <dd
            className={`text-right font-semibold tabular-nums ${
              reentryOpen ? 'text-cream-900' : 'text-cream-500'
            }`}
          >
            {!ts.allowReentry ? 'リエントリー不可' : reentryOpen ? reentryCountdown : '締切済み'}
          </dd>
        </div>
      </dl>
      <p className="mt-[2.5cqw] border-t border-cream-200 pt-[2cqw] text-[2.3cqw] text-cream-600">
        このトーナメントにブレイク（休憩）はありません
      </p>
    </section>
  );
}

// ============================================
// 共通パーツ
// ============================================

function StatTile({
  label,
  value,
  valueClass = 'text-cream-900',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-[2cqw] bg-cream-100 px-[2cqw] py-[1.8cqw] text-center">
      <div className="truncate text-[2.3cqw] text-cream-600">{label}</div>
      <div
        className={`mt-[0.4cqw] truncate text-[3.6cqw] font-bold tabular-nums ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}
