import { useState, useEffect, useMemo } from 'react';
import { useOnlineGameState, PrivateMode } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { Player as PlayerType } from '../logic';
import { evaluateCurrentHand } from '../logic/handEvaluator';
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
  onBack: () => void;
}

export function OnlineGame({ blinds, isFastFold, privateMode, onBack }: OnlineGameProps) {
  const {
    isConnecting,
    connectionError,
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
  } = useOnlineGameState(blinds, isFastFold, privateMode);

  const { settings, setUseBBNotation, setBigBlind } = useGameSettings();
  const { user } = useAuth();

  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [showHandName, setShowHandName] = useState(true);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerType | null>(null);
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [inviteCopied, setInviteCopied] = useState(false);

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

  const myCurrentHandName = useMemo(
    () => gameState ? evaluateCurrentHand(myHoleCards, gameState.communityCards)?.name : undefined,
    [myHoleCards, gameState?.communityCards]
  );

  if (isConnecting) {
    return <ConnectingScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  // 接続エラー
  if (connectionError) {
    return (
      <ConnectionErrorScreen
        error={connectionError}
        onRetry={() => connect().then(() => joinMatchmaking())}
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
  const humanPlayer = mySeat !== null ? gameState.players[mySeat] : null;
  const humanPlayerIdx = mySeat ?? 0;
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (humanPlayerIdx - sbPlayerIdx + 6) % 6;

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
      {/* 招待コード共有パネル（プライベートテーブル作成時） */}
      {privateTableInfo && (
        <div className="absolute top-[6%] left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-white/95 rounded-[3cqw] shadow-lg px-[5cqw] py-[3cqw] text-center mx-[4cqw] pointer-events-auto">
            <p className="text-cream-600 mb-[1cqw]" style={{ fontSize: 'min(1.4vh, 2.3vw)' }}>招待コード</p>
            <p className="font-bold text-cream-900 tracking-[0.3em] font-mono" style={{ fontSize: 'min(4vh, 7vw)' }}>{privateTableInfo.inviteCode}</p>
            <button
              onClick={() => {
                const url = `${window.location.origin}/private/${privateTableInfo.inviteCode}`;
                navigator.clipboard.writeText(url).then(() => {
                  setInviteCopied(true);
                  setTimeout(() => setInviteCopied(false), 2000);
                });
              }}
              className="mt-[2cqw] px-[4cqw] py-[1.5cqw] bg-forest text-white rounded-[2cqw] font-bold flex items-center justify-center gap-[1cqw] mx-auto transition-all active:scale-[0.97]"
              style={{ fontSize: 'min(1.4vh, 2.3vw)' }}
            >
              {inviteCopied ? <><Check style={{ width: 'min(2vh, 3.5vw)', height: 'min(2vh, 3.5vw)' }} /> コピー済み</> : <><Copy style={{ width: 'min(2vh, 3.5vw)', height: 'min(2vh, 3.5vw)' }} /> 招待リンクをコピー</>}
            </button>
          </div>
        </div>
      )}
      {/* お知らせバナー */}
      {announcementStatus?.isActive && !maintenanceStatus?.isActive && (
        <div className="absolute top-[3%] left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-blue-600/85 text-white text-center py-[0.5cqw] px-[3cqw] rounded-[1.5cqw] whitespace-pre-line"
               style={{ fontSize: '2.3vw' }}>
            {announcementStatus.message}
          </div>
        </div>
      )}
      {/* ゲーム情報ヘッダー */}
          <div className="absolute top-0 left-0 right-0 z-40 h-[6%] bg-transparent px-[4%] pt-[2%] flex items-center gap-[3vw]">
            <button
              onClick={onBack}
              className="flex items-center justify-center text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
              style={{ width: 'min(6vh, 10vw)', height: 'min(6vh, 10vw)' }}
            >
              <DoorOpen style={{ width: 'min(3.8vh, 6.3vw)', height: 'min(3.8vh, 6.3vw)' }} />
            </button>
            {/* ハンド履歴ボタン */}
            <button
              onClick={() => setShowHandHistory(true)}
              className="flex items-center justify-center text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
              style={{ width: 'min(6vh, 10vw)', height: 'min(6vh, 10vw)' }}
            >
              <History style={{ width: 'min(3.8vh, 6.3vw)', height: 'min(3.8vh, 6.3vw)' }} />
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-[3vw]">
            {/* サウンドトグル */}
            <button
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setSoundEnabled(next);
              }}
              className="flex items-center justify-center text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
              style={{ width: 'min(6vh, 10vw)', height: 'min(6vh, 10vw)' }}
            >
              {soundOn
                ? <Volume2 style={{ width: 'min(3.8vh, 6.3vw)', height: 'min(3.8vh, 6.3vw)' }} />
                : <VolumeOff style={{ width: 'min(3.8vh, 6.3vw)', height: 'min(3.8vh, 6.3vw)' }} />}
            </button>
            {/* 設定ボタン */}
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="flex items-center justify-center text-white/80 hover:text-white transition-colors rounded-full bg-white/20"
                style={{ width: 'min(6vh, 10vw)', height: 'min(6vh, 10vw)' }}
              >
                <Settings style={{ width: 'min(3.8vh, 6.3vw)', height: 'min(3.8vh, 6.3vw)' }} />
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
          </div>

          <PokerTable
            state={gameState}
            lastActions={lastActions}
            isDealingCards={isDealingCards}
            newCommunityCardsCount={newCommunityCardsCount}
            humanIndex={humanPlayerIdx}
            actionTimeoutAt={actionTimeoutAt}
            actionTimeoutMs={actionTimeoutMs}
            onPlayerClick={setSelectedPlayer}
            showdownHandNames={showdownHandNames}
          />

          <MyCards
            cards={myHoleCards}
            communityCards={gameState.communityCards}
            isDealing={isDealingCards}
            dealOrder={humanDealOrder}
            folded={humanPlayer?.folded}
            handName={showHandName ? (showdownHandNames.get(humanPlayerIdx) || myCurrentHandName) : showdownHandNames.get(humanPlayerIdx)}
          />

          <ActionPanel state={gameState} mySeat={humanPlayerIdx} onAction={handleAction} isFastFold={isFastFold} onFastFold={handleFastFold} />

          {humanPlayer && (
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
              <div className="text-center pointer-events-none">
                <div className="animate-spin w-12 h-12 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4"></div>
                <p className="text-white font-bold" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
                  {false ? 'テーブル移動中...' : '他のプレイヤーを待っています...'}
                </p>
                {true && (
                  <p className="text-white/70 mt-2" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
                    {seatedPlayerCount}/6 人着席中
                  </p>
                )}
              </div>
              <button
                onClick={onBack}
                className="absolute bottom-[20%] px-6 py-3 rounded-lg border border-white/30 text-white/80 hover:bg-white/10 active:bg-white/20 transition-colors"
                style={{ fontSize: 'min(2vh, 3.5vw)' }}
              >
                ロビーに戻る
              </button>
            </div>
          )}

          {/* Profile Popup */}
          {selectedPlayer && (
            <ProfilePopup
              name={selectedPlayer.name}
              avatarUrl={selectedPlayer.avatarUrl}
              avatarId={selectedPlayer.avatarId}
              userId={selectedPlayer.odId}
              isSelf={selectedPlayer.id === humanPlayerIdx}
              onClose={() => setSelectedPlayer(null)}
              twitterAvatarUrl={selectedPlayer.id === humanPlayerIdx ? user?.twitterAvatarUrl : undefined}
              useTwitterAvatar={selectedPlayer.id === humanPlayerIdx ? user?.useTwitterAvatar : undefined}
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
