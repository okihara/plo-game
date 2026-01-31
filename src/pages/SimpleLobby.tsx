interface SimpleLobbyProps {
  onPlayOnline: (blinds: string) => void;
}

interface TableOption {
  id: string;
  gameType: 'PLO' | 'NLH';
  gameLabel: string;
  blinds: string;
  blindsLabel: string;
  buyIn: number;
  playerCount: number; // TODO: サーバーから取得
}

const TABLE_OPTIONS: TableOption[] = [
  { id: 'plo-1-3', gameType: 'PLO', gameLabel: 'PLO', blinds: '1/3', blindsLabel: '$1/$3', buyIn: 300, playerCount: 0 },
  { id: 'plo-2-5', gameType: 'PLO', gameLabel: 'PLO', blinds: '2/5', blindsLabel: '$2/$5', buyIn: 500, playerCount: 0 },
  { id: 'plo-5-10', gameType: 'PLO', gameLabel: 'PLO', blinds: '5/10', blindsLabel: '$5/$10', buyIn: 1000, playerCount: 0 },
];

export function SimpleLobby({ onPlayOnline }: SimpleLobbyProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Volt Poker Club</h1>
        </div>

        {/* Table selection */}
        <div className="space-y-3">
          {TABLE_OPTIONS.map((table) => (
            <button
              key={table.id}
              onClick={() => onPlayOnline(table.blinds)}
              className="w-full py-4 px-5 bg-white/10 backdrop-blur rounded-xl text-white hover:bg-white/20 transition-all border border-white/10 hover:border-white/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Game type badge */}
                  <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 text-xs font-bold rounded">
                    {table.gameLabel}
                  </span>
                  {/* Blinds */}
                  <span className="text-lg font-bold">{table.blindsLabel}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-white/60">
                  {/* Buy-in */}
                  <span>バイイン ${table.buyIn}</span>
                  {/* Player count */}
                  <span className="text-cyan-400">{table.playerCount}人</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-white/40 text-xs">
          <p>NLH, PLO | リアルタイムマルチプレイヤー</p>
        </div>
      </div>
    </div>
  );
}
