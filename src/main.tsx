import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleLobby } from './pages/SimpleLobby';
import { NormalGame } from './pages/NormalGame';
import { TournamentLobby } from './pages/TournamentLobby';
import { TournamentGame } from './pages/TournamentGame';
import type { PrivateMode } from './hooks/useOnlineGameState';
import { PlayerDebug } from './pages/PlayerDebug';
import { EliminationDebug } from './pages/EliminationDebug';
import { TournamentMyResult } from './pages/TournamentMyResult';
import { TournamentResults } from './pages/TournamentResults';
import { HandHistory } from './pages/HandHistory';
import { PlayerProfile } from './pages/PlayerProfile';
import { HandDetailPage } from './pages/HandDetailPage';
import { WatchGame } from './pages/WatchGame';
import { GameSettingsProvider } from './contexts/GameSettingsContext';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';



// Debug outline toggle: Ctrl+Shift+D
if (import.meta.env.DEV) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'd') {
      document.documentElement.classList.toggle('debug-outlines');
    }
  });
}

function App() {
  const [blinds, setBlinds] = useState<string | null>(null);
  const [isFastFold, setIsFastFold] = useState(false);
  const [variant, setVariant] = useState<string | undefined>(undefined);
  const [privateMode, setPrivateMode] = useState<PrivateMode | null>(null);
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // PlayerDebug は独自の wide レイアウトのためコンテナ外
  if (currentPath === '/debug/player') {
    return <PlayerDebug />;
  }


  const isGameScreen =
    !!blinds ||
    !!privateMode ||
    !!tournamentId ||
    currentPath.startsWith('/private/') ||
    currentPath.startsWith('/tournament/') ||
    currentPath.startsWith('/watch/');
  const bgClass = isGameScreen ? 'game-bg' : 'bg-cream-200';

  const goBackToLobby = () => {
    setBlinds(null);
    setIsFastFold(false);
    setVariant(undefined);
    setPrivateMode(null);
    setTournamentId(null);
    window.history.pushState({}, '', '/');
    setCurrentPath('/');
  };

  const goToTournaments = () => {
    setTournamentId(null);
    window.history.pushState({}, '', '/tournaments');
    setCurrentPath('/tournaments');
  };

  const navigateWatchTable = (tableId: string, query?: { tournament?: string; invite?: string }) => {
    const params = new URLSearchParams();
    if (query?.tournament) params.set('tournament', query.tournament);
    if (query?.invite) params.set('invite', query.invite);
    const search = params.toString();
    const pathname = `/watch/${encodeURIComponent(tableId)}`;
    const full = search ? `${pathname}?${search}` : pathname;
    window.history.pushState({}, '', full);
    setCurrentPath(pathname);
  };

  let page;
  if (currentPath === '/debug/elimination') {
    page = <EliminationDebug />;
  } else if (currentPath.startsWith('/hand/')) {
    const handId = currentPath.replace('/hand/', '');
    page = <HandDetailPage handId={handId} onBack={goBackToLobby} />;
  } else if (currentPath.startsWith('/player/')) {
    const playerId = currentPath.replace('/player/', '');
    page = <PlayerProfile userId={playerId} onBack={goBackToLobby} />;
  } else if (currentPath === '/history') {
    page = (
      <HandHistory onBack={goBackToLobby} />
    );
  } else if (currentPath === '/tournaments') {
    page = (
      <TournamentLobby
        onJoinTournament={(id) => { setTournamentId(id); window.history.pushState({}, '', `/tournament/${id}`); setCurrentPath(`/tournament/${id}`); }}
        onViewMyResult={(id) => { window.history.pushState({}, '', `/tournament/${id}/result`); setCurrentPath(`/tournament/${id}/result`); }}
        onViewResults={(id) => { window.history.pushState({}, '', `/tournament/${id}/results`); setCurrentPath(`/tournament/${id}/results`); }}
        onBack={goBackToLobby}
      />
    );
  } else if (currentPath.match(/^\/tournament\/[^/]+\/results$/)) {
    const tId = currentPath.replace('/tournament/', '').replace('/results', '');
    page = <TournamentResults tournamentId={tId} onBack={goToTournaments} />;
  } else if (currentPath.match(/^\/tournament\/[^/]+\/result$/)) {
    const tId = currentPath.replace('/tournament/', '').replace('/result', '');
    page = <TournamentMyResult tournamentId={tId} onBack={goToTournaments} />;
  } else if (currentPath.startsWith('/tournament/') || tournamentId) {
    const tId = tournamentId || currentPath.replace('/tournament/', '');
    page = <TournamentGame tournamentId={tId} onBack={goBackToLobby} />;
  } else if (currentPath.startsWith('/watch/')) {
    const raw = currentPath.slice('/watch/'.length);
    const tableIdForWatch = raw.split('/')[0] || '';
    const inviteFromQuery = new URLSearchParams(window.location.search).get('invite') ?? undefined;
    const tournamentIdFromQuery = new URLSearchParams(window.location.search).get('tournament') ?? undefined;
    page = !tableIdForWatch.trim() ? (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-black text-white px-[8%]">
        <p className="text-center mb-6 text-white/90" style={{ fontSize: 'min(2vh, 3.5vw)' }}>
          テーブルIDが無効です。URL を確認してください。
        </p>
        <button
          type="button"
          onClick={goBackToLobby}
          className="px-6 py-3 rounded-lg border border-white/30 text-white/80 hover:bg-white/10"
          style={{ fontSize: 'min(2vh, 3.5vw)' }}
        >
          ロビーに戻る
        </button>
      </div>
    ) : (
      <WatchGame
        tableId={tableIdForWatch}
        inviteCode={inviteFromQuery}
        tournamentId={tournamentIdFromQuery}
        onNavigateWatchTable={navigateWatchTable}
        onBack={goBackToLobby}
      />
    );
  } else if (currentPath.startsWith('/private/')) {
    const code = currentPath.replace('/private/', '');
    page = <NormalGame blinds="1/3" privateMode={{ type: 'join', inviteCode: code }} onBack={goBackToLobby} />;
  } else if (privateMode) {
    page = <NormalGame blinds={blinds || '1/3'} isFastFold={false} privateMode={privateMode} onBack={goBackToLobby} />;
  } else if (blinds) {
    page = <NormalGame blinds={blinds} isFastFold={isFastFold} variant={variant} onBack={goBackToLobby} />;
  } else {
    page = (
      <SimpleLobby
        onPlayOnline={(selectedBlinds, fastFold, selectedVariant) => { setBlinds(selectedBlinds); setIsFastFold(fastFold ?? false); setVariant(selectedVariant); }}
        onCreatePrivate={(selectedBlinds) => { setBlinds(selectedBlinds); setPrivateMode({ type: 'create', blinds: selectedBlinds }); }}
        onJoinPrivate={(inviteCode) => { setPrivateMode({ type: 'join', inviteCode }); }}
        onJoinTournament={(id) => { setTournamentId(id); window.history.pushState({}, '', `/tournament/${id}`); setCurrentPath(`/tournament/${id}`); }}
        onViewMyResult={(id) => { window.history.pushState({}, '', `/tournament/${id}/result`); setCurrentPath(`/tournament/${id}/result`); }}
        onViewResults={(id) => { window.history.pushState({}, '', `/tournament/${id}/results`); setCurrentPath(`/tournament/${id}/results`); }}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center">
      <div className="w-full h-[100dvh] flex items-center justify-center bg-black relative">
        <div
          id="plo-viewport"
          className={`@container flex flex-col w-full h-full max-w-[calc(100dvh*9/16)] max-h-[calc(100vw*16/9)] aspect-[9/16] overflow-hidden relative ${bgClass}`}
        >
          {page}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <AuthProvider>
      <GameSettingsProvider>
        <App />
      </GameSettingsProvider>
    </AuthProvider>
  </StrictMode>
);
