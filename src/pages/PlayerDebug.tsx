import { useState } from 'react';
import { Player } from '../components/Player';
import { Player as PlayerType, Card as CardType, Action, GameVariant, getVariantConfig } from '../logic/types';
import { GameSettingsProvider } from '../contexts/GameSettingsContext';

const sampleCardsOmaha: CardType[] = [
  { suit: 'h', rank: 'A' },
  { suit: 's', rank: 'K' },
  { suit: 'd', rank: 'Q' },
  { suit: 'c', rank: 'J' },
];

const sampleCardsHoldem: CardType[] = [
  { suit: 'h', rank: 'A' },
  { suit: 's', rank: 'K' },
];

const sampleCardsStud: CardType[] = [
  { suit: 'h', rank: 'A', isUp: false },
  { suit: 's', rank: 'K', isUp: false },
  { suit: 'd', rank: 'Q', isUp: true },
  { suit: 'c', rank: 'J', isUp: true },
  { suit: 'h', rank: 'T', isUp: true },
  { suit: 's', rank: '9', isUp: true },
  { suit: 'd', rank: '8', isUp: false },
];

const sampleCardsDraw: CardType[] = [
  { suit: 'h', rank: 'A' },
  { suit: 's', rank: 'K' },
  { suit: 'd', rank: 'Q' },
  { suit: 'c', rank: 'J' },
  { suit: 'h', rank: 'T' },
];

const variantOptions: { value: GameVariant; label: string }[] = [
  { value: 'plo', label: 'PLO (Omaha)' },
  { value: 'limit_holdem', label: "Limit Hold'em" },
  { value: 'stud', label: '7 Card Stud' },
  { value: 'razz', label: 'Razz (Stud)' },
  { value: 'limit_2-7_triple_draw', label: '2-7 Triple Draw' },
  { value: 'no_limit_2-7_single_draw', label: '2-7 Single Draw' },
];

function getSampleCards(variant: GameVariant): CardType[] {
  const family = getVariantConfig(variant).family;
  switch (family) {
    case 'stud': return sampleCardsStud;
    case 'draw': return sampleCardsDraw;
    case 'holdem': return sampleCardsHoldem;
    default: return sampleCardsOmaha;
  }
}

const createPlayer = (name: string, overrides: Partial<PlayerType> = {}): PlayerType => ({
  id: 0,
  name,
  position: 'BTN',
  chips: 1000,
  holeCards: sampleCardsOmaha,
  currentBet: 0,
  totalBetThisRound: 0,
  folded: false,
  isAllIn: false,
  hasActed: false,
  isSittingOut: false,
  avatarId: 1,
  ...overrides,
});

type PlayerState = 'normal' | 'current' | 'winner' | 'folded' | 'allin';
type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export function PlayerDebug() {
  const [variant, setVariant] = useState<GameVariant>('plo');
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
  const [handNameOption, setHandNameOption] = useState<string>('');

  // Create player based on state
  const player = createPlayer('Player', {
    holeCards: getSampleCards(variant),
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
          <h1 className="text-4xl font-bold mb-4">Player Component Debug</h1>

          {/* Variant Selector */}
          <div className="flex flex-wrap gap-2 mb-8">
            {variantOptions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setVariant(value)}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${
                  variant === value
                    ? 'bg-cream-900 text-white'
                    : 'bg-white border border-cream-300 text-cream-700 hover:bg-cream-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

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

                  <div>
                    <label className="text-sm text-cream-600 block mb-1">役名を表示</label>
                    <select
                      value={handNameOption}
                      onChange={(e) => setHandNameOption(e.target.value)}
                      className="w-full px-3 py-2 bg-cream-100 border border-cream-300 rounded text-sm"
                    >
                      <option value="">なし</option>
                      <optgroup label="Hi ハンド">
                        <option value="ワンペア">ワンペア（4文字）</option>
                        <option value="ツーペア">ツーペア（4文字）</option>
                        <option value="フラッシュ">フラッシュ（5文字）</option>
                        <option value="フルハウス">フルハウス（5文字）</option>
                        <option value="ハイカード">ハイカード（5文字）</option>
                        <option value="ストレート">ストレート（5文字）</option>
                        <option value="スリーカード">スリーカード（6文字）</option>
                        <option value="フォーカード">フォーカード（6文字）</option>
                        <option value="ストレートフラッシュ">ストレートフラッシュ（10文字）</option>
                      </optgroup>
                      <optgroup label="Lo / Razz">
                        <option value="Wheel">Wheel（5文字）</option>
                        <option value="8-low">8-low（5文字）</option>
                        <option value="6-low">6-low（5文字）</option>
                        <option value="Number One">Number One（10文字）</option>
                        <option value="7-5 low">7-5 low（7文字）</option>
                        <option value="T-8 low">T-8 low（7文字）</option>
                      </optgroup>
                      <optgroup label="Hi-Lo（スクープ）">
                        <option value="フルハウス / 8-low">フルハウス / 8-low</option>
                        <option value="フラッシュ / Wheel">フラッシュ / Wheel</option>
                        <option value="ストレートフラッシュ / 6-low">ストレートフラッシュ / 6-low</option>
                      </optgroup>
                    </select>
                  </div>

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

            {/* Player Display - 実機サイズ再現 (9:16) */}
            <div className="lg:col-span-2">
              <div className="bg-black rounded-lg shadow-[0_2px_8px_rgba(139,126,106,0.12)] flex items-center justify-center p-4">
                {/* 実機と同じ9:16コンテナ */}
                <div className="@container flex flex-col w-full max-w-[600px] aspect-[9/16] bg-[#1a1510] overflow-hidden relative">
                  {/* PokerTableと同じ構造: h-[129cqw] */}
                  <div className="h-[129cqw] relative flex items-center justify-center p-2.5 min-h-0">
                    <div className="@container h-[85%] aspect-[0.7] bg-[radial-gradient(ellipse_at_center,#1a5a3a_0%,#0f4028_50%,#0a2a1a_100%)] rounded-[45%] border-[1.4cqw] border-[#8B7E6A] shadow-[0_0_0_0.8cqw_#6B5E4A,0_0_3cqw_rgba(0,0,0,0.5),inset_0_0_6cqw_rgba(255,255,255,0.05)] relative">
                      {[0, 1, 2, 3, 4, 5].map((posIndex) => (
                        <Player
                          key={posIndex}
                          player={player}
                          positionIndex={posIndex}
                          isCurrentPlayer={isCurrentPlayer}
                          isWinner={isWinner}
                          winAmount={isWinner ? 500 : undefined}
                          winHandName={isWinner ? 'フルハウス' : undefined}
                          showdownHandName={handNameOption || undefined}
                          lastAction={lastAction}
                          showCards={showCards}
                          isDealing={isDealing}
                          dealOrder={posIndex}
                          actionTimeoutAt={isTimerActive && timerStartTime ? timerStartTime + 15000 : null}
                          actionTimeoutMs={isTimerActive ? 15000 : null}
                          variant={variant}
                        />
                      ))}
                    </div>
                  </div>
                  {/* MyCards相当のスペース: h-[24cqw] */}
                  <div className="h-[24cqw] bg-transparent" />
                  {/* ActionPanel相当のスペース */}
                  <div className="flex-1 bg-gradient-to-b from-gray-800/95 to-gray-900/95 border-t-2 border-gray-600" />
                </div>
              </div>

                {/* Current State Info */}
                <div className="mt-6 p-4 bg-cream-200 rounded text-sm space-y-2">
                  <div className="font-semibold text-cream-700 mb-3">現在の状態:</div>
                  <div className="grid grid-cols-2 gap-2 text-cream-600">
                    <div>バリアント:</div>
                    <div className="text-cream-900 font-mono">{variant} ({getVariantConfig(variant).family})</div>

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
    </GameSettingsProvider>
  );
}
