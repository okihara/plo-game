import { useState, useCallback, useEffect } from 'react';
import { GameState, Action } from '../logic';
import { useGameSettings } from '../contexts/GameSettingsContext';

interface ActionPanelProps {
  state: GameState;
  mySeat: number;
  onAction: (action: Action, amount: number) => void;
}

export function ActionPanel({ state, mySeat, onAction }: ActionPanelProps) {
  const { formatChips } = useGameSettings();
  const myPlayer = state.players[mySeat];
  const isMyTurn = state.currentPlayerIndex === mySeat && !state.isHandComplete;

  const toCall = state.currentBet - myPlayer.currentBet;

  // オンラインモード用のシンプルなレイズ判定
  // サーバー側でバリデーションするので、クライアントは基本的な条件のみチェック
  const canRaise = isMyTurn && myPlayer.chips > toCall && !myPlayer.isAllIn;

  // Pot Limit の最大レイズ額を計算
  // PLOのポットリミット: コール額 + (現在のポット + コール額)
  // 例: ポット100、コール額20 → 最大レイズ = 20 + (100 + 20) = 140
  const potAfterCall = state.pot + toCall;
  const maxPotRaise = toCall + potAfterCall;

  // サーバーと同じ計算方法でminRaiseを算出
  const minRaiseTotal = state.currentBet + state.minRaise;
  const minRaise = Math.max(minRaiseTotal - myPlayer.currentBet, state.bigBlind);
  const maxRaise = Math.min(myPlayer.chips, maxPotRaise);

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
      amount = Math.min(toCall, myPlayer.chips);
    } else if (action === 'bet' || action === 'raise') {
      amount = sliderValue;
    } else if (action === 'allin') {
      amount = myPlayer.chips;
    }
    onAction(action, amount);
  }, [toCall, myPlayer.chips, sliderValue, onAction]);

  return (
    <div className="bg-gradient-to-b from-white/90 to-white/80 px-[2.7cqw] pt-[2.7cqw] pb-[1.8cqw] border-t-2 border-pink-300 backdrop-blur-sm">
      {/* Preset Buttons & Bet Slider */}
      <div className={`flex items-center gap-[1.8cqw] px-[0.9cqw] mb-[2.2cqw] ${(!canRaise || !isMyTurn) ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="w-1/2 flex gap-[0.9cqw]">
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
              className="flex-1 py-[1.8cqw] px-[0.9cqw] border-2 border-pink-400 rounded-md bg-pink-100 text-pink-700 text-[2.3cqw] font-bold transition-all active:bg-pink-300 active:border-pink-500 whitespace-nowrap"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="w-1/2 flex items-center gap-[1.8cqw]">
          <span className="text-orange-600 font-bold text-[2.7cqw] min-w-[10.7cqw] text-right border-2 border-orange-300 rounded px-[1.8cqw] py-[0.9cqw] bg-orange-50">
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
            className="flex-1 h-[1.8cqw] rounded bg-gradient-to-r from-pink-300 to-orange-300 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[5.4cqw] [&::-webkit-slider-thumb]:h-[5.4cqw] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-orange-400 [&::-webkit-slider-thumb]:to-pink-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-[1.8cqw]">
        <button
          onClick={() => handleAction('fold')}
          disabled={!isMyTurn}
          className="py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-md bg-gradient-to-b from-gray-400 to-gray-500"
        >
          フォールド
        </button>
        <button
          onClick={() => handleAction(toCall === 0 ? 'check' : 'call')}
          disabled={!isMyTurn}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-md ${
            toCall === 0
              ? 'bg-gradient-to-b from-cyan-400 to-blue-500'
              : 'bg-gradient-to-b from-emerald-400 to-green-500'
          }`}
        >
          {toCall === 0 ? 'チェック' : `コール ${formatChips(toCall)}`}
        </button>
        <button
          onClick={() => handleAction(state.currentBet === 0 ? 'bet' : 'raise')}
          disabled={!canRaise || !isMyTurn}
          className="py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-b from-orange-400 to-pink-500 text-white shadow-md"
        >
          {state.currentBet === 0 ? `ベット ${formatChips(sliderValue)}` : `レイズ ${formatChips(sliderValue)}`}
        </button>
      </div>
    </div>
  );
}
