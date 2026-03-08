import { useState, useCallback, useEffect } from 'react';
import { GameState, Action } from '../logic';

interface DrawPhasePanelProps {
  state: GameState;
  mySeat: number;
  selectedCardIndices: Set<number>;
  onAction: (action: Action, amount: number, discardIndices?: number[]) => void;
}

function getDrawLabel(street: string): string {
  switch (street) {
    case 'draw1': return 'First Draw';
    case 'draw2': return 'Second Draw';
    case 'draw3': return 'Final Draw';
    default: return 'Draw';
  }
}

export function DrawPhasePanel({ state, mySeat, selectedCardIndices, onAction }: DrawPhasePanelProps) {
  const isMyTurn = state.currentPlayerIndex === mySeat && !state.isHandComplete;
  const [actionSent, setActionSent] = useState(false);
  const count = selectedCardIndices.size;

  useEffect(() => {
    setActionSent(false);
  }, [isMyTurn]);

  const handleDraw = useCallback(() => {
    setActionSent(true);
    onAction('draw', 0, Array.from(selectedCardIndices));
  }, [selectedCardIndices, onAction]);

  return (
    <div className="px-[2.7cqw] pt-[2.7cqw] pb-[1.8cqw]">
      <div className="text-center text-[2.5cqw] text-gray-400 mb-[1.5cqw] font-bold">
        {getDrawLabel(state.currentStreet)}
      </div>
      <div className="flex justify-center">
        <button
          onClick={handleDraw}
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
