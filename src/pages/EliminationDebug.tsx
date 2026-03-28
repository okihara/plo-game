import { useState } from 'react';
import { EliminationOverlay } from '../components/EliminationOverlay';

const presets = [
  { label: '優勝', position: 1, totalPlayers: 54, prizeAmount: 50000, name: 'PLO Daily Tournament' },
  { label: '2位', position: 2, totalPlayers: 54, prizeAmount: 30000, name: 'PLO Daily Tournament' },
  { label: '3位', position: 3, totalPlayers: 54, prizeAmount: 15000, name: 'PLO Daily Tournament' },
  { label: '入賞', position: 7, totalPlayers: 120, prizeAmount: 5000, name: 'Weekend PLO Major' },
  { label: '入賞なし', position: 33, totalPlayers: 54, prizeAmount: 0, name: 'PLO Daily Tournament' },
  { label: '大規模', position: 142, totalPlayers: 1000, prizeAmount: 0, name: 'PLO Championship' },
];

export function EliminationDebug() {
  const [current, setCurrent] = useState(presets[0]);

  return (
    <div className="relative w-full h-full">
      {/* プリセットボタン */}
      <div className="absolute top-[2cqw] left-[2cqw] right-[2cqw] z-[60] flex flex-wrap gap-[1.5cqw]">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setCurrent(p)}
            className={`px-[2.5cqw] py-[1cqw] rounded-[1cqw] text-[2.5cqw] font-medium transition-colors ${
              current === p
                ? 'bg-forest text-white'
                : 'bg-white/80 text-cream-800 hover:bg-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* オーバーレイ表示 */}
      <EliminationOverlay
        position={current.position}
        totalPlayers={current.totalPlayers}
        prizeAmount={current.prizeAmount}
        tournamentName={current.name}
        onClose={() => alert('ロビーに戻る')}
      />
    </div>
  );
}
