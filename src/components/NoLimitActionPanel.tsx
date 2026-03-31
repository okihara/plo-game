import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GameState, Action } from '../logic';
import { useGameSettings } from '../contexts/GameSettingsContext';
import {
  betSliderAmountToNearestIndex,
  betSliderChipStepFromSmallBlind,
  betSliderIndexToAmount,
  betSliderMaxIndex,
} from '../utils/betSliderRange';

interface NoLimitActionPanelProps {
  state: GameState;
  mySeat: number;
  onAction: (action: Action, amount: number) => void;
}

export function NoLimitActionPanel({ state, mySeat, onAction }: NoLimitActionPanelProps) {
  const { formatChips } = useGameSettings();
  const myPlayer = state.players[mySeat];
  const isMyTurn = state.currentPlayerIndex === mySeat && !state.isHandComplete;

  const toCall = state.currentBet - myPlayer.currentBet;
  const canCheck = toCall === 0;
  const isShortStack = toCall > 0 && myPlayer.chips < toCall;
  const canRaise = isMyTurn && myPlayer.chips > toCall && !myPlayer.isAllIn;

  const minRaiseTotal = state.currentBet + state.minRaise;
  const minRaise = Math.max(minRaiseTotal - myPlayer.currentBet, state.bigBlind);
  const maxRaise = myPlayer.chips;

  const chipStep = betSliderChipStepFromSmallBlind(state.smallBlind);
  const maxSliderIndex = betSliderMaxIndex(minRaise, maxRaise, chipStep);

  const [sliderIndex, setSliderIndex] = useState(0);
  const [actionSent, setActionSent] = useState(false);
  const [prefoldChecked, setPrefoldChecked] = useState(false);
  const prefoldTriggeredRef = useRef(false);

  const sliderValue = useMemo(
    () => betSliderIndexToAmount(sliderIndex, minRaise, maxRaise, chipStep),
    [sliderIndex, minRaise, maxRaise, chipStep],
  );
  const sliderTotalChips = myPlayer.currentBet + sliderValue;

  const prevMinRaiseRef = useRef(minRaise);
  useEffect(() => {
    if (prevMinRaiseRef.current !== minRaise) {
      prevMinRaiseRef.current = minRaise;
      setSliderIndex(0);
      return;
    }
    setSliderIndex((i) => Math.min(i, betSliderMaxIndex(minRaise, maxRaise, chipStep)));
  }, [minRaise, maxRaise, chipStep]);

  useEffect(() => {
    setActionSent(false);
  }, [isMyTurn, state.tableId]);

  useEffect(() => {
    if (isMyTurn && prefoldChecked && !actionSent && !prefoldTriggeredRef.current && !canCheck) {
      prefoldTriggeredRef.current = true;
      setActionSent(true);
      setPrefoldChecked(false);
      onAction('fold', 0);
    }
    if (!isMyTurn) {
      prefoldTriggeredRef.current = false;
    }
  }, [isMyTurn, prefoldChecked, actionSent, onAction, canCheck]);

  useEffect(() => {
    if (state.isHandComplete) {
      setPrefoldChecked(false);
    }
  }, [state.isHandComplete]);

  const handlePreset = useCallback((preset: number) => {
    const betByPot = Math.round((state.pot + toCall) * preset) + toCall;
    const clampedValue = Math.max(minRaise, Math.min(maxRaise, betByPot));
    setSliderIndex(betSliderAmountToNearestIndex(clampedValue, minRaise, maxRaise, chipStep));
  }, [state.pot, toCall, minRaise, maxRaise, chipStep]);

  const handleAction = useCallback((action: Action) => {
    let amount = 0;
    if (action === 'call') {
      amount = Math.min(toCall, myPlayer.chips);
    } else if (action === 'bet' || action === 'raise') {
      amount = sliderValue;
    } else if (action === 'allin') {
      amount = myPlayer.chips;
    }
    setActionSent(true);
    onAction(action, amount);
  }, [toCall, myPlayer.chips, sliderValue, onAction]);

  return (
    <div className="h-[25cqw] px-[2.7cqw] pt-[2.7cqw] pb-[1.8cqw] relative overflow-visible">
      {/* Vertical Bet Slider (absolute, extends above) */}
      <div className={`absolute right-[4cqw] bottom-[15cqw] h-[50cqw] w-[17cqw] flex flex-col items-center gap-[0.8cqw] ${(!canRaise || !isMyTurn || actionSent) ? 'brightness-[0.3] pointer-events-none' : ''}`}>
        <span className="text-white text-[3cqw] text-center border-[0.3cqw] border-gray-600 rounded-[3cqw] px-[1.2cqw] py-[0.4cqw] bg-gray-800/90 backdrop-blur-sm w-full">
          {formatChips(sliderTotalChips)}
        </span>
        <input
          type="range"
          min={0}
          max={maxSliderIndex}
          value={sliderIndex}
          step={1}
          onChange={(e) => setSliderIndex(parseInt(e.target.value, 10))}
          disabled={!canRaise || !isMyTurn || actionSent}
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          className="bet-slider-vertical flex-1 w-[3cqw] rounded bg-gradient-to-b from-amber-500 to-gray-600 appearance-none cursor-pointer"
        />
      </div>

      {/* Preset Buttons */}
      <div className={`flex gap-[0.9cqw] mb-[2.2cqw] pr-[22cqw] ${(!canRaise || !isMyTurn || actionSent) ? 'brightness-[0.3] pointer-events-none' : ''}`}>
        {[
          { label: '1/3', value: 0.33 },
          { label: '1/2', value: 0.5 },
          { label: '3/4', value: 0.75 },
          { label: 'ポット', value: 1 },
        ].map(({ label, value }) => (
          <button
            key={label}
            onClick={() => handlePreset(value)}
            disabled={!canRaise || !isMyTurn || actionSent}
            className="flex-1 py-[1.8cqw] px-[0.9cqw] border-2 border-gray-500 rounded-md bg-gray-700 text-gray-200 text-[2.3cqw] font-bold transition-all active:bg-gray-600 active:border-gray-400 whitespace-nowrap"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-[1.8cqw]">
        <div className="flex items-center gap-[1.2cqw]">
          <label className={`flex items-center shrink-0 ${canCheck ? 'brightness-[0.3] cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={prefoldChecked}
              onChange={(e) => setPrefoldChecked(e.target.checked)}
              disabled={canCheck}
              className="sr-only"
            />
            <div className={`w-[4.5cqw] h-[4.5cqw] rounded border-2 flex items-center justify-center transition-all ${
              prefoldChecked
                ? 'bg-red-500 border-red-400'
                : 'bg-gray-700 border-gray-500'
            }`}>
              {prefoldChecked && (
                <svg className="w-[3cqw] h-[3cqw] text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          </label>
          <button
            onClick={() => handleAction('fold')}
            disabled={!(isMyTurn && !actionSent && !canCheck)}
            className="flex-1 py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md bg-gradient-to-b from-gray-500 to-gray-600"
          >
            FOLD
          </button>
        </div>
        <button
          onClick={() => handleAction(toCall === 0 ? 'check' : 'call')}
          disabled={!isMyTurn || actionSent || isShortStack}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
            toCall === 0
              ? 'bg-gradient-to-b from-blue-500 to-blue-600'
              : 'bg-gradient-to-b from-emerald-500 to-emerald-600'
          }`}
        >
          {toCall === 0 ? 'CHECK' : `CALL ${formatChips(myPlayer.currentBet + toCall)}`}
        </button>
        <button
          onClick={() => handleAction(isShortStack ? 'allin' : sliderValue >= myPlayer.chips ? 'allin' : state.currentBet === 0 ? 'bet' : 'raise')}
          disabled={isShortStack ? (!isMyTurn || actionSent) : (!canRaise || !isMyTurn || actionSent)}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
            isShortStack || sliderValue >= myPlayer.chips
              ? 'bg-gradient-to-b from-red-500 to-red-600'
              : 'bg-gradient-to-b from-amber-500 to-amber-600'
          }`}
        >
          {isShortStack || sliderValue >= myPlayer.chips ? `ALL IN ${formatChips(myPlayer.chips)}` : state.currentBet === 0 ? `BET ${formatChips(sliderTotalChips)}` : `RAISE ${formatChips(sliderTotalChips)}`}
        </button>
      </div>
    </div>
  );
}
