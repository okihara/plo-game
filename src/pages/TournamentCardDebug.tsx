import { useState } from 'react';
import { TournamentCard } from '../components/TournamentList';
import type { TournamentLobbyInfo } from '@plo/shared';

type Preset = {
  label: string;
  tournament: TournamentLobbyInfo;
  winner?: { displayName: string; avatarUrl?: string | null } | null;
  isRegistered?: boolean;
  canReenter?: boolean;
  isLoggedIn?: boolean;
  hasParticipated?: boolean;
  isEliminated?: boolean;
};

const baseTournament: TournamentLobbyInfo = {
  id: 't-debug',
  name: 'PLO Daily Tournament',
  status: 'waiting',
  buyIn: 1000,
  startingChips: 10000,
  registeredPlayers: 12,
  maxPlayers: 54,
  currentBlindLevel: 1,
  prizePool: 120000,
  scheduledStartTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  isRegistrationOpen: true,
  allowReentry: true,
  maxReentries: 2,
  totalReentries: 0,
  reentryDeadlineLevel: 6,
};

const presets: Preset[] = [
  {
    label: 'waiting / 未登録',
    tournament: { ...baseTournament },
    isLoggedIn: true,
  },
  {
    label: 'waiting / 登録済み',
    tournament: { ...baseTournament, registeredPlayers: 13 },
    isLoggedIn: true,
    isRegistered: true,
  },
  {
    label: 'waiting / 未ログイン',
    tournament: { ...baseTournament },
    isLoggedIn: false,
  },
  {
    label: 'running / 進行中',
    tournament: {
      ...baseTournament,
      status: 'running',
      currentBlindLevel: 4,
      registeredPlayers: 38,
      totalReentries: 6,
      startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      isRegistrationOpen: true,
      registrationDeadlineAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    },
    isLoggedIn: true,
    isRegistered: true,
  },
  {
    label: 'running / リエントリー可',
    tournament: {
      ...baseTournament,
      status: 'running',
      currentBlindLevel: 3,
      registeredPlayers: 42,
      totalReentries: 4,
      startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      isRegistrationOpen: true,
      registrationDeadlineAt: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
    },
    isLoggedIn: true,
    canReenter: true,
  },
  {
    label: 'running / 脱落済み',
    tournament: {
      ...baseTournament,
      status: 'running',
      currentBlindLevel: 7,
      registeredPlayers: 18,
      totalReentries: 8,
      startedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      isRegistrationOpen: false,
    },
    isLoggedIn: true,
    isEliminated: true,
    hasParticipated: true,
  },
  {
    label: 'final_table',
    tournament: {
      ...baseTournament,
      status: 'final_table',
      currentBlindLevel: 10,
      registeredPlayers: 9,
      totalReentries: 10,
      startedAt: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
      isRegistrationOpen: false,
      finalTableId: 'debug-ft-table',
    },
    isLoggedIn: true,
  },
  {
    label: 'completed / 自分参加',
    tournament: {
      ...baseTournament,
      status: 'completed',
      currentBlindLevel: 14,
      registeredPlayers: 54,
      totalReentries: 12,
      startedAt: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
      isRegistrationOpen: false,
    },
    winner: {
      displayName: 'たろ***',
      avatarUrl: 'https://i.pravatar.cc/200?img=12',
    },
    isLoggedIn: true,
    hasParticipated: true,
  },
  {
    label: 'completed / 未参加',
    tournament: {
      ...baseTournament,
      id: 't-debug-2',
      status: 'completed',
      currentBlindLevel: 14,
      registeredPlayers: 54,
      totalReentries: 12,
      startedAt: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
      isRegistrationOpen: false,
    },
    winner: {
      displayName: 'Poker***',
      avatarUrl: null,
    },
    isLoggedIn: true,
  },
  {
    label: 'cancelled',
    tournament: {
      ...baseTournament,
      status: 'cancelled',
      registeredPlayers: 3,
      isRegistrationOpen: false,
    },
    isLoggedIn: true,
  },
];

export function TournamentCardDebug() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const current = presets[currentIndex];

  return (
    <div className="h-full flex flex-col min-h-0 bg-cream-100">
      <div className="shrink-0 px-[3cqw] py-[2cqw] border-b border-cream-300 flex flex-wrap gap-[1.2cqw]">
        {presets.map((p, i) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setCurrentIndex(i)}
            className={`px-[2cqw] py-[0.8cqw] rounded-[1cqw] text-[2.2cqw] font-medium transition-colors ${
              i === currentIndex
                ? 'bg-forest text-white'
                : 'bg-white text-cream-800 hover:bg-cream-50 border border-cream-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[4cqw] py-[4cqw]">
        <TournamentCard
          tournament={current.tournament}
          winner={current.winner}
          isRegistered={current.isRegistered ?? false}
          isRegistering={false}
          canReenter={current.canReenter ?? false}
          isReentering={false}
          isLoggedIn={current.isLoggedIn ?? true}
          hasParticipated={current.hasParticipated ?? false}
          isEliminated={current.isEliminated ?? false}
          onRegister={() => console.log('[debug] onRegister')}
          onReenter={() => console.log('[debug] onReenter')}
          onEnter={() => console.log('[debug] onEnter')}
          onViewMyResult={() => console.log('[debug] onViewMyResult')}
          onViewResults={() => console.log('[debug] onViewResults')}
          evalEligibleMeta={null}
          evalQuota={null}
          isEvalGenerating={false}
          evalGenerateBlockedElsewhere={false}
          evalErrorMessage={null}
          onEvalGenerate={() => console.log('[debug] onEvalGenerate')}
          onEvalViewResult={() => console.log('[debug] onEvalViewResult')}
          onWatchFinalTable={current.tournament.finalTableId ? () => console.log('[debug] onWatchFinalTable') : undefined}
        />
      </div>
    </div>
  );
}
