import { useState, useCallback, useEffect, useRef } from 'react';
import { GameState, Action } from '../logic';
import { useGameSettings } from '../contexts/GameSettingsContext';

interface ActionPanelProps {
  state: GameState;
  mySeat: number;
  onAction: (action: Action, amount: number, discardIndices?: number[]) => void;
  isFastFold?: boolean;
  onFastFold?: () => void;
  // Draw用
  isDrawPhase?: boolean;
  selectedCardIndices?: Set<number>;
}

function getDrawLabel(street: string): string {
  switch (street) {
    case 'draw1': return 'First Draw';
    case 'draw2': return 'Second Draw';
    case 'draw3': return 'Final Draw';
    default: return 'Draw';
  }
}

export function ActionPanel({ state, mySeat, onAction, isFastFold, onFastFold, isDrawPhase, selectedCardIndices }: ActionPanelProps) {
  const { formatChips } = useGameSettings();
  const myPlayer = state.players[mySeat];
  const isMyTurn = state.currentPlayerIndex === mySeat && !state.isHandComplete;

  // サーバーから受け取ったvalidActions（信頼する唯一のソース）
  const serverActions = (state.validActions ?? []) as { action: string; minAmount: number; maxAmount: number }[];

  // 各アクションの有無と額をサーバーのvalidActionsから導出
  const foldInfo = serverActions.find(a => a.action === 'fold');
  const checkInfo = serverActions.find(a => a.action === 'check');
  const callInfo = serverActions.find(a => a.action === 'call');
  const betInfo = serverActions.find(a => a.action === 'bet');
  const raiseInfo = serverActions.find(a => a.action === 'raise');
  const allinInfo = serverActions.find(a => a.action === 'allin');
  const drawInfo = serverActions.find(a => a.action === 'draw');

  const canCheck = !!checkInfo;
  const canFold = !!foldInfo && !canCheck;
  const toCall = callInfo?.minAmount ?? 0;
  const raiseOrBet = raiseInfo ?? betInfo;
  const canRaise = !!(raiseOrBet || allinInfo);
  const minRaise = raiseOrBet?.minAmount ?? allinInfo?.minAmount ?? 0;
  const maxRaise = raiseOrBet?.maxAmount ?? allinInfo?.maxAmount ?? myPlayer.chips;
  const isFixedLimit = raiseOrBet ? raiseOrBet.minAmount === raiseOrBet.maxAmount : false;
  const isShortStack = !!allinInfo && !raiseOrBet && !checkInfo;

  // ファストフォールド: ターン前でもフォールド可能
  const isBB = myPlayer.position === 'BB';
  const canFastFold = !!isFastFold && !isMyTurn && !myPlayer.folded && !state.isHandComplete
    && !(isBB && state.currentStreet === 'preflop') && !canCheck;

  const [sliderValue, setSliderValue] = useState(minRaise);
  const [actionSent, setActionSent] = useState(false);
  const [prefoldChecked, setPrefoldChecked] = useState(false);
  const prefoldTriggeredRef = useRef(false);

  useEffect(() => {
    setSliderValue(minRaise);
  }, [minRaise]);

  useEffect(() => {
    setActionSent(false);
  }, [isMyTurn, state.tableId]);

  // フォールド予約
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

  // --- Hooks must be before any early return ---

  const handlePreset = useCallback((preset: number) => {
    const betByPot = Math.round((state.pot + toCall) * preset) + toCall;
    const clampedValue = Math.max(minRaise, Math.min(maxRaise, betByPot));
    setSliderValue(clampedValue);
  }, [state.pot, toCall, minRaise, maxRaise]);

  const handleAction = useCallback((action: Action) => {
    let amount = 0;
    if (action === 'call') {
      amount = callInfo?.minAmount ?? Math.min(toCall, myPlayer.chips);
    } else if (action === 'bet' || action === 'raise') {
      amount = sliderValue;
    } else if (action === 'allin') {
      amount = allinInfo?.minAmount ?? myPlayer.chips;
    }
    setActionSent(true);
    onAction(action, amount);
  }, [toCall, myPlayer.chips, sliderValue, onAction, callInfo, allinInfo]);

  const handleFoldClick = useCallback(() => {
    if (isMyTurn) {
      handleAction('fold');
    } else if (canFastFold && onFastFold) {
      setActionSent(true);
      onFastFold();
    }
  }, [isMyTurn, canFastFold, onFastFold, handleAction]);

  // --- Draw Phase ---
  if (isDrawPhase && drawInfo && selectedCardIndices) {
    const count = selectedCardIndices.size;
    return (
      <div className="px-[2.7cqw] pt-[2.7cqw] pb-[1.8cqw]">
        <div className="text-center text-[2.5cqw] text-gray-400 mb-[1.5cqw] font-bold">
          {getDrawLabel(state.currentStreet)}
        </div>
        <div className="flex justify-center">
          <button
            onClick={() => {
              setActionSent(true);
              onAction('draw', 0, Array.from(selectedCardIndices));
            }}
            disabled={!isMyTurn || actionSent}
            className={`w-[60%] py-[3.2cqw] px-[1.8cqw] rounded-xl text-[3cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
              count === 0
                ? 'bg-gradient-to-b from-blue-500 to-blue-600'
                : 'bg-gradient-to-b from-amber-500 to-amber-600'
            }`}
          >
            {count === 0 ? 'STAND PAT' : `DRAW ${count}`}
          </button>
        </div>
      </div>
    );
  }

  // --- Betting Phase ---

  // 中央ボタン: check or call
  const centerAction: Action = canCheck ? 'check' : 'call';
  const centerLabel = canCheck ? 'CHECK' : `CALL ${formatChips(toCall)}`;
  const centerDisabled = !isMyTurn || actionSent || (!canCheck && !callInfo) || isShortStack;

  // 右ボタン: bet/raise/allin
  const rightAction: Action = isShortStack || sliderValue >= myPlayer.chips ? 'allin'
    : betInfo ? 'bet' : 'raise';
  const rightLabel = isShortStack || sliderValue >= myPlayer.chips
    ? `ALL IN ${formatChips(allinInfo?.minAmount ?? myPlayer.chips)}`
    : isFixedLimit
      ? (betInfo ? `BET ${formatChips(minRaise)}` : `RAISE ${formatChips(minRaise)}`)
      : (betInfo ? `BET ${formatChips(sliderValue)}` : `RAISE ${formatChips(sliderValue)}`);
  const rightDisabled = isShortStack ? (!isMyTurn || actionSent) : (!canRaise || !isMyTurn || actionSent);

  // スライダー表示: 可変額のbet/raiseがある場合のみ（Fixed Limitでは非表示）
  const showSlider = canRaise && !isFixedLimit;

  return (
    <div className={`${showSlider ? 'h-[25cqw]' : ''} px-[2.7cqw] pt-[2.7cqw] pb-[1.8cqw]`}>
      {/* Preset Buttons & Bet Slider */}
      {showSlider && (
        <div className={`flex items-center gap-[1.8cqw] px-[0.9cqw] mb-[2.2cqw] ${(!canRaise || !isMyTurn || actionSent) ? 'brightness-[0.3] pointer-events-none' : ''}`}>
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
                disabled={!canRaise || !isMyTurn || actionSent}
                className="flex-1 py-[1.8cqw] px-[0.9cqw] border-2 border-gray-500 rounded-md bg-gray-700 text-gray-200 text-[2.3cqw] font-bold transition-all active:bg-gray-600 active:border-gray-400 whitespace-nowrap"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="w-1/2 flex items-center gap-[1.8cqw]">
            <span className="text-emerald-400 font-bold text-[2.7cqw] min-w-[10.7cqw] text-right border-2 border-gray-600 rounded px-[1.8cqw] py-[0.9cqw] bg-gray-800">
              {formatChips(sliderValue)}
            </span>
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              value={sliderValue}
              step={1}
              onChange={(e) => setSliderValue(parseInt(e.target.value, 10))}
              disabled={!canRaise || !isMyTurn || actionSent}
              className="flex-1 h-[1.8cqw] rounded bg-gradient-to-r from-gray-600 to-emerald-600 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[5.4cqw] [&::-webkit-slider-thumb]:h-[5.4cqw] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-emerald-400 [&::-webkit-slider-thumb]:to-emerald-600 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-[1.8cqw]">
        <div className="flex items-center gap-[1.2cqw]">
          {/* プリフォールドチェックボックス: FF時はファストフォールドボタンがあるので非表示 */}
          {!isFastFold && (
            <label className={`flex items-center shrink-0 ${(canCheck || !canFold) ? 'brightness-[0.3] cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={prefoldChecked}
                onChange={(e) => setPrefoldChecked(e.target.checked)}
                disabled={canCheck || !canFold}
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
          )}
          <button
            onClick={handleFoldClick}
            disabled={!(isMyTurn && !actionSent && canFold) && !(canFastFold && !actionSent)}
            className={`flex-1 py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
              canFastFold && !isMyTurn
                ? 'bg-gradient-to-b from-red-500 to-red-600'
                : 'bg-gradient-to-b from-gray-500 to-gray-600'
            }`}
          >
            FOLD
          </button>
        </div>
        <button
          onClick={() => handleAction(centerAction)}
          disabled={centerDisabled}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
            canCheck
              ? 'bg-gradient-to-b from-blue-500 to-blue-600'
              : 'bg-gradient-to-b from-emerald-500 to-emerald-600'
          }`}
        >
          {centerLabel}
        </button>
        <button
          onClick={() => handleAction(rightAction)}
          disabled={rightDisabled}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
            isShortStack || sliderValue >= myPlayer.chips
              ? 'bg-gradient-to-b from-red-500 to-red-600'
              : 'bg-gradient-to-b from-amber-500 to-amber-600'
          }`}
        >
          {rightLabel}
        </button>
      </div>
    </div>
  );
}
