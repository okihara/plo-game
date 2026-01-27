import { useState, useCallback, useEffect } from 'react';
import { GameState, Action, getValidActions } from '../logic';

interface ActionPanelProps {
  state: GameState;
  onAction: (action: Action, amount: number) => void;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
}

export function ActionPanel({ state, onAction }: ActionPanelProps) {
  const humanPlayer = state.players.find(p => p.isHuman)!;
  const isMyTurn = state.players[state.currentPlayerIndex]?.isHuman && !state.isHandComplete;
  const validActions = isMyTurn ? getValidActions(state, state.currentPlayerIndex) : [];

  const toCall = state.currentBet - humanPlayer.currentBet;
  const canRaise = validActions.some(a => a.action === 'raise' || a.action === 'bet');
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');

  const minRaise = raiseAction?.minAmount || state.bigBlind;
  const maxRaise = raiseAction?.maxAmount || humanPlayer.chips;

  const [sliderValue, setSliderValue] = useState(minRaise);

  useEffect(() => {
    setSliderValue(minRaise);
  }, [minRaise]);

  const handlePreset = useCallback((preset: number) => {
    const potAfterCall = state.pot + toCall;
    const raiseAmount = Math.round(potAfterCall * preset) + toCall;
    const clampedValue = Math.max(minRaise, Math.min(maxRaise, raiseAmount));
    setSliderValue(clampedValue);
  }, [state.pot, toCall, minRaise, maxRaise]);

  const handleAction = useCallback((action: Action) => {
    let amount = 0;
    if (action === 'call') {
      amount = Math.min(toCall, humanPlayer.chips);
    } else if (action === 'bet' || action === 'raise') {
      amount = sliderValue;
    } else if (action === 'allin') {
      amount = humanPlayer.chips;
    }
    onAction(action, amount);
  }, [toCall, humanPlayer.chips, sliderValue, onAction]);

  return (
    <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1e] px-[1.5vh] pt-[1.5vh] pb-[1vh] border-t border-gray-700">
      {/* Preset Buttons & Bet Slider */}
      <div className={`flex items-center gap-[1vh] px-[0.5vh] mb-[1.2vh] ${(!canRaise || !isMyTurn) ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="w-1/2 flex gap-[0.5vh]">
          {[
            { label: '1/3', value: 0.33 },
            { label: '1/2', value: 0.5 },
            { label: '3/4', value: 0.75 },
            { label: 'ポット', value: 1 },
          ].map(({ label, value }) => (
            <button
              key={label}
              onClick={() => handlePreset(value)}
              disabled={!canRaise || !isMyTurn}
              className="flex-1 py-[1vh] px-[0.5vh] border border-gray-600 rounded-md bg-white/10 text-white text-[1.3vh] font-bold transition-all active:bg-yellow-500/30 active:border-yellow-400"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="w-1/2 flex items-center gap-[1vh]">
          <span className="text-yellow-400 font-bold text-[1.5vh] min-w-[6vh] text-right border border-gray-600 rounded px-[1vh] py-[0.5vh]">
            {formatChips(sliderValue)}
          </span>
          <input
            type="range"
            min={minRaise}
            max={maxRaise}
            value={sliderValue}
            step={1}
            onChange={(e) => setSliderValue(parseInt(e.target.value, 10))}
            disabled={!canRaise || !isMyTurn}
            className="flex-1 h-[1vh] rounded bg-gradient-to-r from-gray-600 to-gray-500 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[3vh] [&::-webkit-slider-thumb]:h-[3vh] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-yellow-400 [&::-webkit-slider-thumb]:to-yellow-600 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-[1vh]">
        <button
          onClick={() => handleAction('fold')}
          disabled={!isMyTurn}
          className="py-[1.8vh] px-[1vh] rounded-lg text-[1.5vh] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-b from-gray-500 to-gray-700 text-white"
        >
          フォールド
        </button>
        <button
          onClick={() => handleAction(toCall === 0 ? 'check' : 'call')}
          disabled={!isMyTurn}
          className={`py-[1.8vh] px-[1vh] rounded-lg text-[1.5vh] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white ${
            toCall === 0
              ? 'bg-gradient-to-b from-blue-500 to-blue-700'
              : 'bg-gradient-to-b from-green-500 to-green-700'
          }`}
        >
          {toCall === 0 ? 'チェック' : `コール ${formatChips(toCall)}`}
        </button>
        <button
          onClick={() => handleAction(state.currentBet === 0 ? 'bet' : 'raise')}
          disabled={!canRaise || !isMyTurn}
          className="py-[1.8vh] px-[1vh] rounded-lg text-[1.5vh] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-b from-orange-500 to-orange-700 text-white"
        >
          {state.currentBet === 0 ? `ベット ${formatChips(sliderValue)}` : `レイズ ${formatChips(sliderValue)}`}
        </button>
      </div>
    </div>
  );
}
