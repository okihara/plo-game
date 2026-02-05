import { GameState, Player as PlayerType } from '../logic';
import { LastAction, ActionTimeoutAt } from '../hooks/useOnlineGameState';
import { Player } from './Player';
import { CommunityCards } from './CommunityCards';
import { useGameSettings } from '../contexts/GameSettingsContext';

interface PokerTableProps {
  state: GameState;
  lastActions: Map<number, LastAction>;
  isDealingCards: boolean;
  newCommunityCardsCount: number;
  humanIndex?: number;
  actionTimeoutAt?: ActionTimeoutAt | null;
  actionTimeoutMs?: number | null;
  onPlayerClick?: (player: PlayerType) => void;
}

export function PokerTable({
  state,
  lastActions,
  isDealingCards,
  newCommunityCardsCount,
  humanIndex = 0,
  actionTimeoutAt,
  actionTimeoutMs,
  onPlayerClick,
}: PokerTableProps) {
  const { formatChips } = useGameSettings();
  const isShowdown = state.currentStreet === 'showdown' || state.isHandComplete;
  const orderedPlayers = [];
  for (let i = 0; i < 6; i++) {
    const idx = (humanIndex + i) % 6;
    orderedPlayers.push({ player: state.players[idx], playerIdx: idx, posIndex: i });
  }

  // SBから時計回りに配る順序を計算
  // SBのプレイヤーインデックスを見つける
  const sbPlayerIdx = state.players.findIndex(p => p.position === 'SB');
  // 各プレイヤーの配布順序（SBから時計回り）を計算
  const getDealOrder = (playerIdx: number): number => {
    // playerIdxからSBまでの距離を計算（時計回り）
    return (playerIdx - sbPlayerIdx + 6) % 6;
  };

  return (
    <div className="flex-1 relative flex items-center justify-center p-2.5 min-h-0">
      <div className="@container h-[85%] aspect-[0.7] bg-[radial-gradient(ellipse_at_center,#1a5a3a_0%,#0f4028_50%,#0a2a1a_100%)] rounded-[45%] border-[1.4cqw] border-[#2a2520] shadow-[0_0_0_0.8cqw_#1a1815,0_0_3cqw_rgba(0,0,0,0.5),inset_0_0_6cqw_rgba(255,255,255,0.05)] relative">
        {/* Pot Display */}
        <div className="absolute top-[65%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 px-[4cqw] py-[2cqw] rounded-lg text-[5cqw] font-bold text-yellow-400 z-10">
          Pot: {formatChips(state.pot)}
        </div>

        {/* Community Cards */}
        <CommunityCards cards={state.communityCards} newCardsCount={newCommunityCardsCount} />

        {/* Players */}
        {orderedPlayers.map(({ player, playerIdx, posIndex }) => {
          const isCurrentPlayer = state.currentPlayerIndex === playerIdx && !state.isHandComplete;
          return (
            <Player
              key={player.id}
              player={player}
              positionIndex={posIndex}
              isCurrentPlayer={isCurrentPlayer}
              isWinner={state.winners.some(w => w.playerId === player.id)}
              lastAction={lastActions.get(player.id) || null}
              showCards={isShowdown}
              isDealing={isDealingCards}
              dealOrder={getDealOrder(playerIdx)}
              actionTimeoutAt={isCurrentPlayer ? actionTimeoutAt : null}
              actionTimeoutMs={isCurrentPlayer ? actionTimeoutMs : null}
              onAvatarClick={() => onPlayerClick?.(player)}
            />
          );
        })}
      </div>
    </div>
  );
}
