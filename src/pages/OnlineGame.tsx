import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOnlineGameState, PrivateMode } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { Player as PlayerType, evaluateRazzHand, getVariantConfig, isDrawStreet } from '../logic';
import { evaluateCurrentHand, evaluateCurrentHoldemHand, evaluateStudHand, evaluateCurrentOmahaHiLoHand, evaluateStudHiLoHand } from '../logic/handEvaluator';
import { DoorOpen, Settings, History, Volume2, VolumeOff, Copy, Check } from 'lucide-react';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  HandAnalysisOverlay,
} from '../components';
import { ProfilePopup } from '../components/ProfilePopup';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { ConnectingScreen } from '../components/ConnectingScreen';
import { ConnectionErrorScreen } from '../components/ConnectionErrorScreen';
import { SearchingTableScreen } from '../components/SearchingTableScreen';
import { BustedScreen } from '../components/BustedScreen';

import { isSoundEnabled, setSoundEnabled } from '../services/actionSound';

interface OnlineGameProps {
  blinds: string;
  isFastFold?: boolean;
  privateMode?: PrivateMode;
  variant?: string;
  onBack: () => void;
}

export function OnlineGame({ blinds, isFastFold, privateMode, variant, onBack }: OnlineGameProps) {
  const {
    isConnecting,
    connectionError,
    isDisplaced,
    gameState,
    mySeat,
    myHoleCards,
    lastActions,
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    isWaitingForPlayers,
    seatedPlayerCount,
    actionTimeoutAt,
    actionTimeoutMs,
    showdownHandNames,
    maintenanceStatus,
    announcementStatus,
    bustedMessage,
    privateTableInfo,
    connect,
    disconnect,
    joinMatchmaking,
    handleAction,
    handleFastFold,
  } = useOnlineGameState(blinds, isFastFold, privateMode, variant);

  const { settings, setUseBBNotation, setBigBlind } = useGameSettings();
  const { user } = useAuth();

  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [showHandName, setShowHandName] = useState(true);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerType | null>(null);
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showInvitePopover, setShowInvitePopover] = useState(false);
  const [selectedCardIndices, setSelectedCardIndices] = useState<Set<number>>(new Set());
  const [variantNotice, setVariantNotice] = useState<string | null>(null);
  const prevVariantRef = React.useRef<string | undefined>(undefined);

  // バリアント変更通知
  useEffect(() => {
    if (!gameState) return;
    const currentVariant = gameState.variant;
    if (prevVariantRef.current !== undefined && prevVariantRef.current !== currentVariant) {
      const name = variantDisplayName[currentVariant] || currentVariant;
      setVariantNotice(name);
      const timer = setTimeout(() => setVariantNotice(null), 1000);
      return () => clearTimeout(timer);
    }
    prevVariantRef.current = currentVariant;
  }, [gameState?.variant]);

  // Draw: ストリート変更時にカード選択リセット
  const currentStreet = gameState?.currentStreet;
  useEffect(() => {
    setSelectedCardIndices(new Set());
  }, [currentStreet]);

  const handleCardToggle = useCallback((index: number) => {
    setSelectedCardIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Draw判定
  const isDraw = gameState ? getVariantConfig(gameState.variant).family === 'draw' : false;
  const isCurrentDrawStreet = gameState ? isDrawStreet(gameState.currentStreet) : false;

  // gameStateが変わったらbigBlindを設定
  useEffect(() => {
    if (gameState) {
      setBigBlind(gameState.bigBlind);
    }
  }, [gameState, setBigBlind]);

  // 接続と参加
  useEffect(() => {
    connect().then(() => {
      joinMatchmaking();
    });

    return () => {
      disconnect();
    };
  }, [connect, disconnect, joinMatchmaking]);

  // バスト時にロビーへ戻す
  useEffect(() => {
    if (bustedMessage) {
      const timer = setTimeout(() => {
        onBack();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [bustedMessage, onBack]);

  // ブラインド表示用
  const blindsLabel = blinds;

  // バリアント表示名
  const variantDisplayName: Record<string, string> = {
    plo: 'PLO',
    limit_holdem: 'LHE',
    stud: 'Stud',
    razz: 'Razz',
    'limit_2-7_triple_draw': '2-7 TD',
    'no_limit_2-7_single_draw': 'NL 2-7 SD',
    omaha_hilo: 'O8',
    stud_hilo: 'Stud8',
  };

  const myPlayer = mySeat !== null && gameState ? gameState.players[mySeat] : null;

  const myCurrentHandName = useMemo(() => {
    if (!gameState) return undefined;
    const variantConfig = getVariantConfig(gameState.variant);
    if (variantConfig.family === 'stud') {
      if (myHoleCards.length < 5) {
        return undefined;
      }
      switch(gameState.variant) {
        case 'stud':
          return evaluateStudHand(myHoleCards).name;
        case 'razz':
          return evaluateRazzHand(myHoleCards).name;
        case 'stud_hilo': {
          const { high, low } = evaluateStudHiLoHand(myHoleCards);
          return low ? `${high.name} / ${low.name}` : high.name;
        }
        default:
          return undefined;
      }
    }
    if (gameState.variant === 'omaha_hilo') {
      const result = evaluateCurrentOmahaHiLoHand(myHoleCards, gameState.communityCards);
      if (!result) return undefined;
      return result.low ? `${result.high.name} / ${result.low.name}` : result.high.name;
    }
    if (variantConfig.family === 'holdem') {
      return evaluateCurrentHoldemHand(myHoleCards, gameState.communityCards)?.name;
    }
    return evaluateCurrentHand(myHoleCards, gameState.communityCards)?.name;
  }, [myHoleCards, gameState?.communityCards, gameState?.variant]);

  if (isConnecting) {
    return <ConnectingScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  // 別タブで接続された
  if (isDisplaced) {
    return (
      <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/90">
        <div className="text-center px-[8%]">
          <p className="text-white font-bold mb-4" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
            別のタブで接続されました
          </p>
          <p className="text-white/70 mb-6" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
            このタブでの接続は切断されました
          </p>
          <button
            onClick={onBack}
            className="px-6 py-3 rounded-lg border border-white/30 text-white/80 hover:bg-white/10 active:bg-white/20 transition-colors"
            style={{ fontSize: 'min(2vh, 3.5vw)' }}
          >
            ロビーに戻る
          </button>
        </div>
      </div>
    );
  }

  // 接続エラー
  if (connectionError) {
    return (
      <ConnectionErrorScreen
        error={connectionError}
        onBack={onBack}
      />
    );
  }

  // テーブル待機中
  if (!gameState) {
    // バスト中はバストスクリーンを表示
    if (bustedMessage) {
      return <BustedScreen message={bustedMessage} />;
    }
    return <SearchingTableScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  // ゲーム画面
  const myPlayerIdx = mySeat ?? 0;
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (myPlayerIdx - sbPlayerIdx + 6) % 6;

  return (
    <>
      {/* メンテナンス通知バナー */}
      {maintenanceStatus?.isActive && (
        <div className="absolute top-[4%] left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-red-600/90 text-white text-center py-[0.5cqw] px-[3cqw] rounded-b-[1.5cqw]"
               style={{ fontSize: 'min(1.4vh, 2.3vw)' }}>
            メンテナンス予定 - 現在のハンド終了後、新しいハンドは開始されません
            {maintenanceStatus.message && ` (${maintenanceStatus.message})`}
          </div>
        </div>
      )}
      {/* お知らせバナー */}
      {announcementStatus?.isActive && !maintenanceStatus?.isActive && (
        <div className="absolute top-[3%] left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-blue-600/85 text-white text-center py-[0.5cqw] px-[3cqw] rounded-[1.5cqw] whitespace-pre-line text-[2.3cqw]">
            {announcementStatus.message}
          </div>
        </div>
      )}
      {/* ゲーム情報ヘッダー */}
          <div className="absolute top-0 left-0 right-0 z-50 h-[6%] bg-transparent px-[4%] pt-[2%] flex items-center gap-[4cqw]">
            <button
              onClick={onBack}
              className="flex items-center justify-center w-[8cqw] h-[8cqw] text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
            >
              <DoorOpen className="w-[5cqw] h-[5cqw]" />
            </button>
            {/* ハンド履歴ボタン */}
            <button
              onClick={() => setShowHandHistory(true)}
              className="flex items-center justify-center w-[8cqw] h-[8cqw] text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
            >
              <History className="w-[5cqw] h-[5cqw]" />
            </button>

            {/* バリアント + ブラインド（中央） */}
            <div className="flex-1 flex justify-center">
              <span className="bg-black/70 rounded-full px-[3cqw] py-[0.5cqw] text-white/90 text-[5cqw] font-medium tracking-wide">
                {gameState ? variantDisplayName[gameState.variant] || gameState.variant : ''} {blindsLabel}
              </span>
            </div>

            {/* サウンドトグル */}
            <button
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setSoundEnabled(next);
              }}
              className="flex items-center justify-center w-[8cqw] h-[8cqw] text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
            >
              {soundOn
                ? <Volume2 className="w-[5cqw] h-[5cqw]" />
                : <VolumeOff className="w-[5cqw] h-[5cqw]" />}
            </button>
            {/* 設定ボタン */}
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="flex items-center justify-center w-[8cqw] h-[8cqw] text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
              >
                <Settings className="w-[5cqw] h-[5cqw]" />
              </button>
              {showSettingsMenu && (
                <div className="absolute top-full right-0 mt-1 bg-gray-800 rounded-lg shadow-lg py-2 z-50 whitespace-nowrap">
                  <button
                    onClick={() => {
                      setAnalysisEnabled(!analysisEnabled);
                      setShowSettingsMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                    style={{ fontSize: 'min(1.6vh, 2.8vw)' }}
                  >
                    <span>オープンハンド評価</span>
                    <span className={analysisEnabled ? 'text-emerald-400' : 'text-gray-500'}>
                      {analysisEnabled ? '✓' : ''}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setShowHandName(!showHandName);
                      setShowSettingsMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                    style={{ fontSize: 'min(1.6vh, 2.8vw)' }}
                  >
                    <span>役名表示</span>
                    <span className={showHandName ? 'text-emerald-400' : 'text-gray-500'}>
                      {showHandName ? '✓' : ''}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setUseBBNotation(!settings.useBBNotation);
                      setShowSettingsMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                    style={{ fontSize: 'min(1.6vh, 2.8vw)' }}
                  >
                    <span>BB表記</span>
                    <span className={settings.useBBNotation ? 'text-emerald-400' : 'text-gray-500'}>
                      {settings.useBBNotation ? '✓' : ''}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
      {/* 招待コードボタン（プライベートテーブル） */}
      {privateTableInfo && (
        <div className="absolute top-[9%] right-[4%] z-[160]">
          <div className="relative">
            <button
              onClick={() => setShowInvitePopover(!showInvitePopover)}
              className="flex items-center gap-[1cqw] px-[2.5cqw] py-[1cqw] bg-white/90 rounded-full shadow-md text-cream-800 transition-all active:scale-[0.97]"
              style={{ fontSize: '2.5cqw' }}
            >
              <span className="font-mono font-bold tracking-wider">招待コード</span>
            </button>
            {showInvitePopover && (
              <>
                <div className="fixed inset-0 z-[159]" onClick={() => setShowInvitePopover(false)} />
                <div className="absolute top-full right-0 mt-1 z-[160] bg-white rounded-[2cqw] shadow-lg p-[4cqw] whitespace-nowrap min-w-[45cqw]">
                  <p className="text-cream-600 mb-[1cqw]" style={{ fontSize: '2.5cqw' }}>招待コード</p>
                  <p className="font-bold text-cream-900 tracking-[0.3em] font-mono text-center mb-[2cqw]" style={{ fontSize: '6cqw' }}>
                    {privateTableInfo.inviteCode}
                  </p>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/private/${privateTableInfo.inviteCode}`;
                      navigator.clipboard.writeText(url).then(() => {
                        setInviteCopied(true);
                        setTimeout(() => setInviteCopied(false), 2000);
                      });
                    }}
                    className="w-full px-[4cqw] py-[2cqw] bg-forest text-white rounded-[2cqw] font-bold flex items-center justify-center gap-[1cqw] transition-all active:scale-[0.97]"
                    style={{ fontSize: '2.8cqw' }}
                  >
                    {inviteCopied
                      ? <><Check style={{ width: '3cqw', height: '3cqw' }} /> コピー済み</>
                      : <><Copy style={{ width: '3cqw', height: '3cqw' }} /> 招待リンクをコピー</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

          {/* バリアント変更通知 */}
          {variantNotice && (
            <div className="absolute inset-0 z-[180] flex items-center justify-center pointer-events-none">
              <div className="bg-black/80 text-white font-bold px-[6cqw] py-[3cqw] rounded-[2cqw] text-[8cqw] animate-fade-in">
                {variantNotice}
              </div>
            </div>
          )}

          <PokerTable
            state={gameState}
            lastActions={lastActions}
            isDealingCards={isDealingCards}
            newCommunityCardsCount={newCommunityCardsCount}
            humanIndex={myPlayerIdx}
            actionTimeoutAt={actionTimeoutAt}
            actionTimeoutMs={actionTimeoutMs}
            onPlayerClick={setSelectedPlayer}
            showdownHandNames={showdownHandNames}
          />

          <MyCards
            cards={myHoleCards}
            isDealing={isDealingCards}
            dealOrder={humanDealOrder}
            folded={myPlayer?.folded}
            handName={showHandName ? (showdownHandNames.get(myPlayerIdx) || myCurrentHandName) : showdownHandNames.get(myPlayerIdx)}
            variant={gameState.variant}
            isDrawPhase={isDraw && isCurrentDrawStreet}
            selectedCardIndices={selectedCardIndices}
            onCardToggle={handleCardToggle}
          />

          <ActionPanel
            state={gameState}
            mySeat={myPlayerIdx}
            onAction={handleAction}
            isFastFold={isFastFold}
            onFastFold={handleFastFold}
            isDrawPhase={isDraw && isCurrentDrawStreet}
            selectedCardIndices={selectedCardIndices}
          />

          {myPlayer && (
            <HandAnalysisOverlay
              holeCards={myHoleCards}
              communityCards={gameState.communityCards}
              isVisible={analysisEnabled && gameState.currentStreet === 'preflop'}
              onClose={() => setAnalysisEnabled(false)}
            />
          )}

          {/* バスト通知オーバーレイ */}
          {bustedMessage && (
            <div className="absolute inset-0 z-[200]">
              <BustedScreen message={bustedMessage} />
            </div>
          )}

          {/* テーブル検索・待機中オーバーレイ */}
          {(isChangingTable || isWaitingForPlayers) && (
            <div className="absolute inset-0 z-[150] flex items-center justify-center bg-black/70">
              <div className="text-center">
                <div className="animate-spin w-12 h-12 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4"></div>
                <p className="text-white font-bold" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
                  {false ? 'テーブル移動中...' : '他のプレイヤーを待っています...'}
                </p>
                {true && (
                  <p className="text-white/70 mt-2" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
                    {seatedPlayerCount}/6 人着席中
                  </p>
                )}
                <button
                  onClick={onBack}
                  className="mt-6 px-6 py-3 rounded-lg bg-white text-cream-800 font-bold hover:bg-white/90 active:bg-white/80 transition-colors shadow-md"
                  style={{ fontSize: 'min(2vh, 3.5vw)' }}
                >
                  ロビーに戻る
                </button>
              </div>
            </div>
          )}

          {/* Profile Popup */}
          {selectedPlayer && (
            <ProfilePopup
              name={selectedPlayer.name}
              avatarUrl={selectedPlayer.avatarUrl}
              avatarId={selectedPlayer.avatarId}
              userId={selectedPlayer.odId}
              isSelf={selectedPlayer.id === myPlayerIdx}
              onClose={() => setSelectedPlayer(null)}
              twitterAvatarUrl={selectedPlayer.id === myPlayerIdx ? user?.twitterAvatarUrl : undefined}
              useTwitterAvatar={selectedPlayer.id === myPlayerIdx ? user?.useTwitterAvatar : undefined}
            />
          )}

          {/* ハンド履歴オーバーレイ */}
          {showHandHistory && (
            <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={() => setShowHandHistory(false)}>
              <div className="absolute inset-0 bg-black/50" />
              <div
                className="relative w-[92%] h-[80%] bg-white rounded-2xl shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <HandHistoryPanel onClose={() => setShowHandHistory(false)} />
              </div>
            </div>
          )}
    </>
  );
}
