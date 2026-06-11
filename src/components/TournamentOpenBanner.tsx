import { Trophy } from 'lucide-react';

interface TournamentOpenBannerProps {
  /** レイトレジ締切時刻（HH:MM）。未定なら省略 */
  deadlineTime?: string;
  /** タップ時の遷移（トーナメントタブへ） */
  onClick: () => void;
}

/**
 * ロビー（ホームタブ）上部に表示する「トーナメント開催中」バナー。
 * 参加受付中（レイトレジ含む）のトーナメントがあるときだけ親側で表示する。
 */
export function TournamentOpenBanner({ deadlineTime, onClick }: TournamentOpenBannerProps) {
  return (
    <button
      onClick={onClick}
      className="mt-[2cqw] w-full flex items-center gap-[2cqw] px-[3cqw] py-[2.5cqw] rounded-[2.5cqw] border-[0.4cqw] bg-gradient-to-b from-amber-500 to-amber-600 border-amber-700/40 text-white shadow-[0_4px_12px_rgba(180,120,30,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_6px_20px_rgba(180,120,30,0.5),inset_0_1px_0_rgba(255,255,255,0.3)] active:scale-[0.98] transition-all"
    >
      <div className="relative shrink-0">
        <Trophy className="w-[6cqw] h-[6cqw]" />
        <span className="absolute -top-[0.8cqw] -right-[0.8cqw] w-[2.2cqw] h-[2.2cqw] rounded-full bg-[#C0392B] border-[0.3cqw] border-white animate-pulse" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[3.5cqw] font-bold leading-tight">トーナメント開催中！</p>
        <p className="text-[2.8cqw] font-bold text-white">
          {deadlineTime ? `エントリー受付中（${deadlineTime} まで）` : 'エントリー受付中'}
        </p>
      </div>
      <svg className="w-[3.5cqw] h-[3.5cqw] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  );
}
