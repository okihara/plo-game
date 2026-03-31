import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GameState, Action, getVariantConfig } from '../logic';
import { useGameSettings } from '../contexts/GameSettingsContext';
import {
  betSliderAmountToNearestIndex,
  betSliderChipStepFromSmallBlind,
  betSliderIndexToAmount,
  betSliderMaxIndex,
} from '../utils/betSliderRange';

function ActionButton({ onClick, disabled, colorFrom, colorTo, borderColor, label, className = '' }: {
  onClick: () => void;
  disabled: boolean;
  colorFrom: string;
  colorTo: string;
  borderColor: string;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-[11cqw] rounded-[1cqw] text-[3.5cqw] font-bold tracking-wide transition-all active:scale-95 active:shadow-none active:border-b-0 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-lg bg-gradient-to-b ${colorFrom} ${colorTo} border-b-[0.8cqw] ${borderColor} ${className}`}
    >
      {label}
    </button>
  );
}

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
  const isFixedLimit = getVariantConfig(state.variant).betting === 'fixed_limit';
  const isShortStack = !!allinInfo && !raiseOrBet && !checkInfo && toCall >= myPlayer.chips;

  // ファストフォールド: ターン前でもフォールド可能
  const isBB = myPlayer.position === 'BB';
  const canFastFold = !!isFastFold && !isMyTurn && !myPlayer.folded && !state.isHandComplete
    && !(isBB && state.currentStreet === 'preflop' && state.currentBet <= myPlayer.currentBet) && !canCheck && state.currentStreet !== 'showdown'&& !myPlayer.hasActed;

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
    setSliderIndex(betSliderAmountToNearestIndex(clampedValue, minRaise, maxRaise, chipStep));
  }, [state.pot, toCall, minRaise, maxRaise, chipStep]);

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
        <div className="flex justify-center">
          <ActionButton
            onClick={() => {
              setActionSent(true);
              onAction('draw', 0, Array.from(selectedCardIndices));
            }}
            disabled={!isMyTurn || actionSent}
            colorFrom={count === 0 ? 'from-blue-500' : 'from-amber-500'}
            colorTo={count === 0 ? 'to-blue-600' : 'to-amber-600'}
            borderColor={count === 0 ? 'border-blue-800' : 'border-amber-800'}
            label={count === 0 ? 'STAND PAT' : `DRAW ${count}`}
            className="w-[60%] rounded-[3cqw]"
          />
        </div>
      </div>
    );
  }

  // --- Betting Phase ---

  // 中央ボタン: check or call
  const centerAction: Action = canCheck ? 'check' : 'call';
  const centerLabel = canCheck ? 'CHECK' : `CALL ${formatChips(myPlayer.currentBet + toCall)}`;
  const centerDisabled = !isMyTurn || actionSent || (!canCheck && !callInfo) || isShortStack;

  // 右ボタン: bet/raise/allin
  const rightAction: Action = isShortStack || sliderValue >= myPlayer.chips ? 'allin'
    : betInfo ? 'bet' : 'raise';
  const raiseToChips = myPlayer.currentBet + (isFixedLimit ? minRaise : sliderValue);
  /** スライダー・BET/RAISE 表記: このストリートでの自分の合計ベット（currentBet + 増分） */
  const sliderTotalChips = myPlayer.currentBet + sliderValue;
  const rightLabel = isShortStack || sliderValue >= myPlayer.chips
    ? `ALL IN ${formatChips(allinInfo?.minAmount ?? myPlayer.chips)}`
    : isFixedLimit
      ? (betInfo ? `BET ${formatChips(minRaise)}` : `RAISE ${formatChips(raiseToChips)}`)
      : (betInfo ? `BET ${formatChips(sliderTotalChips)}` : `RAISE ${formatChips(sliderTotalChips)}`);
  const rightDisabled = isShortStack ? (!isMyTurn || actionSent) : (!canRaise || !isMyTurn || actionSent);

  // スライダー表示: 可変額のbet/raiseがある場合のみ（Fixed Limitでは非表示）
  const showSlider = !isFixedLimit;

  return (
    <div className={`h-[25cqw] px-[1cqw] pt-[2.7cqw] pb-[1.8cqw] relative overflow-visible`}>
      {/* Vertical Bet Slider (absolute, extends above ActionPanel) */}
      {showSlider && (
        <div className={`absolute right-[4cqw] bottom-[25cqw] h-[40cqw] w-[13cqw] flex flex-col items-center gap-[0.8cqw] ${(!canRaise || !isMyTurn || actionSent) ? 'brightness-[0.3] pointer-events-none' : ''}`}>
          <span className="text-emerald-400 text-[3cqw] text-center border-[0.3cqw] border-gray-600 rounded-[0.5cqw] px-[1.2cqw] py-[0.4cqw] bg-gray-800/90 backdrop-blur-sm w-full">
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
            className="flex-1 w-[3cqw] rounded bg-gradient-to-b from-emerald-600 to-gray-600 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[12cqw] [&::-webkit-slider-thumb]:h-[8cqw] [&::-webkit-slider-thumb]:rounded-[3cqw] [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-emerald-400 [&::-webkit-slider-thumb]:to-emerald-600 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-[0.4cqw] [&::-webkit-slider-thumb]:border-emerald-300/50 [&::-moz-range-thumb]:w-[12cqw] [&::-moz-range-thumb]:h-[8cqw] [&::-moz-range-thumb]:rounded-[3cqw] [&::-moz-range-thumb]:border-[0.4cqw] [&::-moz-range-thumb]:border-emerald-300/50 [&::-moz-range-thumb]:bg-gradient-to-br [&::-moz-range-thumb]:from-emerald-400 [&::-moz-range-thumb]:to-emerald-600 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-lg"
          />
        </div>
      )}

      {/* Preset Buttons */}
      {showSlider && (
        <div className={`flex gap-[0.9cqw] mb-[2.2cqw] ${(!canRaise || !isMyTurn || actionSent) ? 'brightness-[0.3] pointer-events-none' : ''}`}>
          {[
            { label: '33%', value: 0.33 },
            { label: '50%', value: 0.5 },
            { label: '75%', value: 0.75 },
            { label: 'Pot', value: 1 },
          ].map(({ label, value }) => (
            <button
              key={label}
              onClick={() => handlePreset(value)}
              disabled={!canRaise || !isMyTurn || actionSent}
              className="flex-1 py-[0.8cqw] px-[0.9cqw] border-[0.3cqw] border-gray-500 rounded-[1cqw] bg-gray-700 text-gray-200 text-[4cqw] transition-all active:bg-gray-600 active:border-gray-400 whitespace-nowrap"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className={"grid grid-cols-3 gap-[1.8cqw]"}>
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
          <ActionButton
            onClick={handleFoldClick}
            disabled={!(isMyTurn && !actionSent && canFold) && !(canFastFold && !actionSent)}
            colorFrom={canFastFold && !isMyTurn ? 'from-red-500' : 'from-gray-500'}
            colorTo={canFastFold && !isMyTurn ? 'to-red-600' : 'to-gray-600'}
            borderColor={canFastFold && !isMyTurn ? 'border-red-800' : 'border-gray-800'}
            label="FOLD"
            className="flex-1"
          />
        </div>
        <ActionButton
          onClick={() => handleAction(centerAction)}
          disabled={centerDisabled}
          colorFrom={canCheck ? 'from-blue-500' : 'from-emerald-500'}
          colorTo={canCheck ? 'to-blue-600' : 'to-emerald-600'}
          borderColor={canCheck ? 'border-blue-800' : 'border-emerald-800'}
          label={centerLabel}
        />
        <ActionButton
          onClick={() => handleAction(rightAction)}
          disabled={rightDisabled}
          colorFrom={isShortStack || sliderValue >= myPlayer.chips ? 'from-red-500' : 'from-amber-500'}
          colorTo={isShortStack || sliderValue >= myPlayer.chips ? 'to-red-600' : 'to-amber-600'}
          borderColor={isShortStack || sliderValue >= myPlayer.chips ? 'border-red-800' : 'border-amber-800'}
          label={rightLabel}
        />
      </div>
    </div>
  );
}
