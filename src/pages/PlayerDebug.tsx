import { useState } from 'react';
import { Player } from '../components/Player';
import { Player as PlayerType, Card as CardType, Action } from '../logic/types';
import { GameSettingsProvider } from '../contexts/GameSettingsContext';

const sampleCards: CardType[] = [
  { suit: 'h', rank: 'A' },
  { suit: 's', rank: 'K' },
  { suit: 'd', rank: 'Q' },
  { suit: 'c', rank: 'J' },
];

const createPlayer = (name: string, overrides: Partial<PlayerType> = {}): PlayerType => ({
  id: 0,
  name,
  position: 'BTN',
  chips: 1000,
  holeCards: sampleCards,
  currentBet: 0,
  totalBetThisRound: 0,
  folded: false,
  isAllIn: false,
  hasActed: false,
  avatarId: 1,
  ...overrides,
});

type PlayerState = 'normal' | 'current' | 'winner' | 'folded' | 'allin';
type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export function PlayerDebug() {
  const [playerState, setPlayerState] = useState<PlayerState>('normal');
  const [showCards, setShowCards] = useState(true);
  const [showBet, setShowBet] = useState(false);
  const [betAmount, setBetAmount] = useState(250);

  // Animation states
  const [isDealing, setIsDealing] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType | null>(null);
  const [actionTimestamp, setActionTimestamp] = useState<number | null>(null);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [timerStartTime, setTimerStartTime] = useState<number | null>(null);
  const [showHandName, setShowHandName] = useState(false);

  // Create player based on state
  const player = createPlayer('Player', {
    folded: playerState === 'folded',
    isAllIn: playerState === 'allin',
    currentBet: showBet ? betAmount : 0,
  });

  // Determine props based on state
  const isCurrentPlayer = playerState === 'current' || isTimerActive;
  const isWinner = playerState === 'winner';

  // Get last action
  const lastAction = actionTimestamp && currentAction
    ? {
        action: currentAction as Action,
        amount: currentAction === 'call' ? 100 :
                currentAction === 'bet' ? 200 :
                currentAction === 'raise' ? 300 :
                currentAction === 'allin' ? 1000 : 0,
        timestamp: actionTimestamp,
      }
    : null;

  // Animation triggers
  const triggerDealing = () => {
    setIsDealing(true);
    setTimeout(() => setIsDealing(false), 2000);
  };

  const triggerAction = (action: ActionType) => {
    // まずクリアしてから新しいアクションを設定（連続再生を可能にする）
    setCurrentAction(null);
    setActionTimestamp(null);

    // 次のフレームで新しいアクションを設定
    setTimeout(() => {
      setCurrentAction(action);
      setActionTimestamp(Date.now());
    }, 0);
  };

  const startTimer = () => {
    const now = Date.now();
    setTimerStartTime(now);
    setIsTimerActive(true);
    setTimeout(() => {
      setIsTimerActive(false);
      setTimerStartTime(null);
    }, 15000);
  };

  return (
    <GameSettingsProvider>
      <div className="fixed inset-0 bg-cream-100 text-cream-900 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          <h1 className="text-4xl font-bold mb-8">Player Component Debug</h1>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Control Panel */}
            <div className="lg:col-span-1 space-y-6">
              {/* Player State */}
              <div className="bg-white border border-cream-300 rounded-lg p-6 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
                <h3 className="text-xl font-semibold mb-4">プレイヤー状態</h3>
                <div className="space-y-2">
                  {[
                    { value: 'normal', label: 'Normal - 通常状態' },
                    { value: 'current', label: 'Current - 行動中（黄色グロー）' },
                    { value: 'winner', label: 'Winner - 勝利（緑グロー）' },
                    { value: 'folded', label: 'Folded - フォールド（グレースケール）' },
                    { value: 'allin', label: 'All-in - オールイン' },
                  ].map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-3 cursor-pointer hover:bg-cream-100 p-2 rounded">
                      <input
                        type="radio"
                        name="playerState"
                        value={value}
                        checked={playerState === value}
                        onChange={(e) => setPlayerState(e.target.value as PlayerState)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="bg-white border border-cream-300 rounded-lg p-6 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
                <h3 className="text-xl font-semibold mb-4">アクション再生</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => triggerAction('fold')}
                    className="w-full px-4 py-3 bg-cream-500 text-white hover:bg-cream-600 rounded font-semibold transition text-sm"
                  >
                    Fold - フォールド
                  </button>
                  <button
                    onClick={() => triggerAction('check')}
                    className="w-full px-4 py-3 bg-[#2874A6] text-white hover:opacity-90 rounded font-semibold transition text-sm"
                  >
                    Check - チェック
                  </button>
                  <button
                    onClick={() => triggerAction('call')}
                    className="w-full px-4 py-3 bg-forest text-white hover:bg-forest-light rounded font-semibold transition text-sm"
                  >
                    Call - コール
                  </button>
                  <button
                    onClick={() => triggerAction('bet')}
                    className="w-full px-4 py-3 bg-amber-600 text-white hover:bg-amber-700 rounded font-semibold transition text-sm"
                  >
                    Bet - ベット
                  </button>
                  <button
                    onClick={() => triggerAction('raise')}
                    className="w-full px-4 py-3 bg-amber-600 text-white hover:bg-amber-700 rounded font-semibold transition text-sm"
                  >
                    Raise - レイズ
                  </button>
                  <button
                    onClick={() => triggerAction('allin')}
                    className="w-full px-4 py-3 bg-[#C0392B] text-white hover:opacity-90 rounded font-semibold transition text-sm"
                  >
                    All-in - オールイン
                  </button>
                </div>
              </div>

              {/* Display Options */}
              <div className="bg-white border border-cream-300 rounded-lg p-6 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
                <h3 className="text-xl font-semibold mb-4">表示オプション</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCards}
                      onChange={(e) => setShowCards(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">カードを表示</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showBet}
                      onChange={(e) => setShowBet(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">ベット額を表示</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHandName}
                      onChange={(e) => setShowHandName(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">役名を表示</span>
                  </label>

                  {showBet && (
                    <div className="ml-7 mt-2">
                      <label className="text-sm text-cream-600 block mb-1">ベット額</label>
                      <input
                        type="number"
                        value={betAmount}
                        onChange={(e) => setBetAmount(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-cream-100 border border-cream-300 rounded text-sm"
                        min="0"
                        step="50"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Other Animations */}
              <div className="bg-white border border-cream-300 rounded-lg p-6 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
                <h3 className="text-xl font-semibold mb-4">その他アニメーション</h3>
                <div className="space-y-3">
                  <button
                    onClick={triggerDealing}
                    disabled={isDealing}
                    className={`w-full px-4 py-3 rounded font-semibold transition ${
                      isDealing
                        ? 'bg-cream-400 text-white cursor-not-allowed'
                        : 'bg-forest text-white hover:bg-forest-light'
                    }`}
                  >
                    {isDealing ? '配布中...' : '🃏 カード配布'}
                  </button>

                  <button
                    onClick={startTimer}
                    disabled={isTimerActive}
                    className={`w-full px-4 py-3 rounded font-semibold transition ${
                      isTimerActive
                        ? 'bg-cream-400 text-white cursor-not-allowed'
                        : 'bg-[#2874A6] text-white hover:opacity-90'
                    }`}
                  >
                    {isTimerActive ? '⏱ タイマー実行中...' : '⏱ タイマー開始（15秒）'}
                  </button>
                </div>
              </div>

              {/* Back Button */}
              <div className="text-center">
                <a
                  href="/"
                  className="inline-block px-6 py-3 bg-white border border-cream-300 rounded-lg hover:bg-cream-50 transition"
                >
                  ← ロビーに戻る
                </a>
              </div>
            </div>

            {/* Player Display */}
            <div className="lg:col-span-2">
              <div className="bg-white border border-cream-300 rounded-lg p-8 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
                <h3 className="text-2xl font-semibold mb-6 text-center">プレビュー</h3>
                <div className="relative w-full max-w-md mx-auto aspect-[4/5] bg-[radial-gradient(ellipse_at_center,#1a5a3a_0%,#0f4028_50%,#0a2a1a_100%)] rounded-[45%] border-[3px] border-[#2a2520] overflow-visible">
                  <div className="@container w-full h-full relative">
                    {[0, 1, 2, 3, 4, 5].map((posIndex) => (
                      <Player
                        key={posIndex}
                        player={player}
                        positionIndex={posIndex}
                        isCurrentPlayer={isCurrentPlayer}
                        isWinner={isWinner}
                        winAmount={isWinner ? 500 : undefined}
                        winHandName={isWinner ? 'フルハウス' : undefined}
                        showdownHandName={showHandName ? 'フルハウス' : undefined}
                        lastAction={lastAction}
                        showCards={showCards}
                        isDealing={isDealing}
                        dealOrder={posIndex}
                        actionTimeoutAt={isTimerActive && timerStartTime ? timerStartTime + 15000 : null}
                        actionTimeoutMs={isTimerActive ? 15000 : null}
                        isSpectator={posIndex === 0}
                      />
                    ))}
                  </div>
                </div>

                {/* Current State Info */}
                <div className="mt-6 p-4 bg-cream-200 rounded text-sm space-y-2">
                  <div className="font-semibold text-cream-700 mb-3">現在の状態:</div>
                  <div className="grid grid-cols-2 gap-2 text-cream-600">
                    <div>プレイヤー状態:</div>
                    <div className="text-cream-900 font-mono">{playerState}</div>

                    <div>最後のアクション:</div>
                    <div className="text-cream-900 font-mono">{currentAction || 'なし'}</div>

                    <div>カード表示:</div>
                    <div className="text-cream-900 font-mono">{showCards ? 'ON' : 'OFF'}</div>

                    <div>ベット額:</div>
                    <div className="text-cream-900 font-mono">{showBet ? `${betAmount}` : 'なし'}</div>

                    <div>現在のターン:</div>
                    <div className="text-cream-900 font-mono">{isCurrentPlayer ? 'YES' : 'NO'}</div>

                    <div>勝者:</div>
                    <div className="text-cream-900 font-mono">{isWinner ? 'YES' : 'NO'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </GameSettingsProvider>
  );
}
