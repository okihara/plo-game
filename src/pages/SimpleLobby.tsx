interface SimpleLobbyProps {
  onPlayOnline: () => void;
}

export function SimpleLobby({ onPlayOnline }: SimpleLobbyProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-4">
      <div className="text-center">
        {/* Logo */}
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-white mb-2">PLO Poker</h1>
          <p className="text-white/60 text-lg">Pot Limit Omaha</p>
        </div>

        {/* Game mode button */}
        <div className="max-w-sm mx-auto">
          <button
            onClick={onPlayOnline}
            className="w-full py-4 px-6 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-2xl font-bold text-white text-lg hover:from-cyan-600 hover:to-blue-600 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <div className="flex items-center justify-center gap-3">
              <span className="text-2xl">🌐</span>
              <span>プレイ開始</span>
            </div>
            <p className="text-white/70 text-sm font-normal mt-1">ファストフォールド・リアルタイム</p>
          </button>
        </div>

        {/* Game info */}
        <div className="mt-12 text-white/40 text-sm">
          <p>ブラインド: $1/$3 | 6-MAX PLO</p>
          <p className="mt-2">ファストフォールド対応</p>
        </div>
      </div>
    </div>
  );
}
