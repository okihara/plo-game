import { useState, useCallback, useEffect, useRef } from 'react';
import { GameState, Action } from '../logic';
import { useGameSettings } from '../contexts/GameSettingsContext';

interface StudActionPanelProps {
  state: GameState;
  mySeat: number;
  onAction: (action: Action, amount: number) => void;
}

export function StudActionPanel({ state, mySeat, onAction }: StudActionPanelProps) {
  const { formatChips } = useGameSettings();
  const myPlayer = state.players[mySeat];
  const isMyTurn = state.currentPlayerIndex === mySeat && !state.isHandComplete;

  const toCall = state.currentBet - myPlayer.currentBet;
  const canCheck = toCall === 0;
  const isShortStack = toCall > 0 && myPlayer.chips < toCall;

  const canRaise = isMyTurn && myPlayer.chips > toCall && !myPlayer.isAllIn;

  // Fixed Limit: 3rd/4th = Small Bet, 5th/6th/7th = Big Bet
  const fixedBetSize = ['third', 'fourth'].includes(state.currentStreet)
    ? state.smallBlind
    : state.bigBlind;

  // 3rd streetのブリングイン後コンプリート判定
  const isBringInOnly = state.currentStreet === 'third' && state.betCount === 0 && state.currentBet === state.bringIn;

  const [actionSent, setActionSent] = useState(false);
  const [prefoldChecked, setPrefoldChecked] = useState(false);
  const prefoldTriggeredRef = useRef(false);

  useEffect(() => {
    setActionSent(false);
  }, [isMyTurn]);

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

  const handleAction = useCallback((action: Action) => {
    let amount = 0;
    if (action === 'call') {
      amount = Math.min(toCall, myPlayer.chips);
    } else if (action === 'bet') {
      amount = fixedBetSize - myPlayer.currentBet;
    } else if (action === 'raise') {
      amount = (state.currentBet + fixedBetSize) - myPlayer.currentBet;
    } else if (action === 'allin') {
      amount = myPlayer.chips;
    }
    setActionSent(true);
    onAction(action, amount);
  }, [toCall, myPlayer.chips, myPlayer.currentBet, state.currentBet, fixedBetSize, onAction]);

  // bet or raise 判定（ブリングインのみの状態も bet 扱い）
  const isBetAction = state.currentBet === 0 || isBringInOnly;

  // Raise/Bet ボタンラベル
  const raiseLabel = (() => {
    if (isShortStack || myPlayer.chips <= fixedBetSize) return `ALL IN ${formatChips(myPlayer.chips)}`;
    if (isBetAction) return `BET ${formatChips(fixedBetSize)}`;
    return `RAISE ${formatChips(fixedBetSize)}`;
  })();

  const isAllIn = isShortStack || myPlayer.chips <= fixedBetSize;

  return (
    <div className="px-[2.7cqw] pt-[2.7cqw] pb-[1.8cqw]">
      {/* Fixed Limit: スライダーなし、3ボタンのみ */}
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
            className="flex-1 py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md bg-gradient-to-b from-gray-500 to-gray-600"
          >
            FOLD
          </button>
        </div>
        <button
          onClick={() => handleAction(toCall === 0 ? 'check' : 'call')}
          disabled={!isMyTurn || actionSent || isShortStack}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
            toCall === 0
              ? 'bg-gradient-to-b from-blue-500 to-blue-600'
              : 'bg-gradient-to-b from-emerald-500 to-emerald-600'
          }`}
        >
          {toCall === 0 ? 'CHECK' : `CALL ${formatChips(toCall)}`}
        </button>
        <button
          onClick={() => handleAction(isAllIn ? 'allin' : isBetAction ? 'bet' : 'raise')}
          disabled={isShortStack ? (!isMyTurn || actionSent) : (!canRaise || !isMyTurn || actionSent)}
          className={`py-[3.2cqw] px-[1.8cqw] rounded-xl text-[2.7cqw] font-bold uppercase tracking-wide transition-all active:scale-95 disabled:brightness-[0.3] disabled:cursor-not-allowed text-white shadow-md ${
            isAllIn
              ? 'bg-gradient-to-b from-red-500 to-red-600'
              : 'bg-gradient-to-b from-amber-500 to-amber-600'
          }`}
        >
          {raiseLabel}
        </button>
      </div>
    </div>
  );
}
