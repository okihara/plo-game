import { GameState, Player as PlayerType, getVariantConfig } from '../logic';
import { LastAction, ActionTimeoutAt } from '../hooks/useOnlineGameState';
import { Player } from './Player';
import { CommunityCards } from './CommunityCards';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { LABEL_COLORS } from '../hooks/usePlayerLabels';

interface PokerTableProps {
  state: GameState;
  lastActions: Map<number, LastAction>;
  isDealingCards: boolean;
  newCommunityCardsCount: number;
  humanIndex?: number;
  actionTimeoutAt?: ActionTimeoutAt | null;
  actionTimeoutMs?: number | null;
  onPlayerClick?: (player: PlayerType) => void;
  showdownHandNames?: Map<number, string>;
  getLabel?: (targetUserId: string) => { color: string } | undefined;
}

function getStreetLabel(street: string): string {
  switch (street) {
    case 'preflop': return 'Preflop';
    case 'flop': return 'Flop';
    case 'turn': return 'Turn';
    case 'river': return 'River';
    case 'showdown': return 'Showdown';
    case 'third': return '3rd';
    case 'fourth': return '4th';
    case 'fifth': return '5th';
    case 'sixth': return '6th';
    case 'seventh': return '7th';
    case 'predraw': return '1st Bet';
    case 'postdraw1': return '2nd Bet';
    case 'postdraw2': return '3rd Bet';
    case 'draw1': return '1st Draw';
    case 'draw2': return '2nd Draw';
    case 'draw3': return 'Final Draw';
    case 'final': return 'Final';
    default: return street;
  }
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
  showdownHandNames,
  getLabel,
}: PokerTableProps) {
  const { formatChips } = useGameSettings();

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
    <div className="h-[129cqw] relative flex items-center justify-center p-2.5 min-h-0">
      <div className="@container top-[4cqw] h-[85%] aspect-[0.7] relative">
        {/* Pot Display - above community cards */}
        <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 px-[3cqw] py-[0cqw] rounded-lg text-yellow-400 z-10">
          <div className="flex flex-col items-center gap-[0.5cqw]">
            <span className="text-[5cqw]">Total: {formatChips(state.pot)}</span>
            {state.sidePots.length > 1 && (
              <div className="flex gap-[2cqw] text-[3.5cqw] text-yellow-300/80">
                {state.sidePots.map((sp, i) => (
                  <span key={i}>{i === 0 ? 'Main' : `Side${state.sidePots.length > 2 ? i : ''}`}: {formatChips(sp.amount)}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Community Cards (PLO/Holdem) / Stud Info */}
        {getVariantConfig(state.variant).usesCommunityCards ? (
          state.variant === 'plo_double_board_bomb' ? (
            <>
              <CommunityCards
                cards={state.boards?.[0] ?? []}
                newCardsCount={newCommunityCardsCount}
                topClass="top-[47%]"
                label="B1"
                cardSize="xs"
              />
              <CommunityCards
                cards={state.boards?.[1] ?? []}
                newCardsCount={newCommunityCardsCount}
                topClass="top-[55%]"
                label="B2"
                cardSize="xs"
              />
            </>
          ) : (
            <CommunityCards cards={state.communityCards} newCardsCount={newCommunityCardsCount} />
          )
        ) : (
          <div className="absolute top-[52%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 text-center">
            <div className="flex gap-[2cqw] text-[6cqw] text-white/60 justify-center whitespace-nowrap">
              {[
                state.ante ? `Ante ${formatChips(state.ante)}` : null,
                state.bringIn ? `BI ${formatChips(state.bringIn)}` : null,
                `SB ${formatChips(state.smallBlind)}`,
                `bb ${formatChips(state.bigBlind)}`,
              ].filter(Boolean).map((text, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-white/30 mr-[2cqw]">|</span>}
                  {text}
                </span>
              ))}
            </div>
            <span className={`text-[6cqw] text-white/70 uppercase tracking-wider mt-[1cqw] inline-block border-2 border-white/70 px-[2cqw] py-[0.5cqw]`}>
              {getStreetLabel(state.currentStreet)}
            </span>
          </div>
        )}

        {/* Carried Pot - below community cards, after first street */}
        {(() => {
          const currentStreetBets = state.players.reduce((sum, p) => sum + p.currentBet, 0);
          const carriedPot = state.pot - currentStreetBets;
          const isFirstStreet = state.currentStreet === 'preflop' || state.currentStreet === 'third';
          if (isFirstStreet || carriedPot <= 0) return null;
          // bomb pot: 2ボードを top-[50%]/[60%] に表示するため carried pot は下にずらす
          const isBombPot = state.variant === 'plo_double_board_bomb';
          const topClass = isBombPot
            ? 'top-[62%]'
            : (!getVariantConfig(state.variant).usesCommunityCards ? 'top-[50%]' : 'top-[62%]');
          return (
            <div className={`absolute ${topClass} left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/50 px-[3cqw] rounded-[15cqw] text-[5cqw] text-white-80 z-10`}>
              {formatChips(carriedPot)}
            </div>
          );
        })()}

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
              winAmount={state.winners.find(w => w.playerId === player.id)?.amount}
              winHandName={state.winners.find(w => w.playerId === player.id)?.handName}
              showdownHandName={showdownHandNames?.get(playerIdx)}
              lastAction={lastActions.get(player.id) || null}
              showCards={player.isShowdown ?? false}
              isDealing={isDealingCards}
              dealOrder={getDealOrder(playerIdx)}
              actionTimeoutAt={isCurrentPlayer ? actionTimeoutAt : null}
              actionTimeoutMs={isCurrentPlayer ? actionTimeoutMs : null}
              onAvatarClick={() => onPlayerClick?.(player)}
              variant={state.variant}
              labelColor={player.odId ? LABEL_COLORS.find(c => c.id === getLabel?.(player.odId!)?.color)?.hex : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
