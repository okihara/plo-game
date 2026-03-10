import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleLobby } from './pages/SimpleLobby';
import { OnlineGame } from './pages/OnlineGame';
import type { PrivateMode } from './hooks/useOnlineGameState';
import { PlayerDebug } from './pages/PlayerDebug';
import { HandHistory } from './pages/HandHistory';
import { SpectatorView } from './pages/SpectatorView';
import { PlayerProfile } from './pages/PlayerProfile';
import { HandDetailPage } from './pages/HandDetailPage';
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

  const isGameScreen = (!!blinds || !!privateMode || currentPath.startsWith('/private/'));
  const bgClass = isGameScreen ? 'game-bg' : 'bg-cream-200';

  const goBackToLobby = () => {
    setBlinds(null);
    setIsFastFold(false);
    setVariant(undefined);
    setPrivateMode(null);
    window.history.pushState({}, '', '/');
    setCurrentPath('/');
  };

  let page;
  if (currentPath.startsWith('/hand/')) {
    const handId = currentPath.replace('/hand/', '');
    page = <HandDetailPage handId={handId} onBack={goBackToLobby} />;
  } else if (currentPath.startsWith('/player/')) {
    const playerId = currentPath.replace('/player/', '');
    page = <PlayerProfile userId={playerId} onBack={goBackToLobby} />;
  } else if (currentPath.startsWith('/spectate/')) {
    const tableId = currentPath.replace('/spectate/', '');
    page = (
      <SpectatorView
        tableId={tableId}
        onBack={goBackToLobby}
      />
    );
  } else if (currentPath === '/history') {
    page = (
      <HandHistory onBack={goBackToLobby} />
    );
  } else if (currentPath.startsWith('/private/')) {
    const code = currentPath.replace('/private/', '');
    page = <OnlineGame blinds="1/3" privateMode={{ type: 'join', inviteCode: code }} onBack={goBackToLobby} />;
  } else if (privateMode) {
    page = <OnlineGame blinds={blinds || '1/3'} isFastFold={false} privateMode={privateMode} onBack={goBackToLobby} />;
  } else if (blinds) {
    page = <OnlineGame blinds={blinds} isFastFold={isFastFold} variant={variant} onBack={goBackToLobby} />;
  } else {
    page = (
      <SimpleLobby
        onPlayOnline={(selectedBlinds, fastFold, selectedVariant) => { setBlinds(selectedBlinds); setIsFastFold(fastFold ?? false); setVariant(selectedVariant); }}
        onCreatePrivate={(selectedBlinds) => { setBlinds(selectedBlinds); setPrivateMode({ type: 'create', blinds: selectedBlinds }); }}
        onJoinPrivate={(inviteCode) => { setPrivateMode({ type: 'join', inviteCode }); }}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center">
      <div className="w-full h-[100dvh] flex items-center justify-center bg-black relative">
        <div className={`@container flex flex-col w-full h-full max-w-[calc(100dvh*9/16)] max-h-[calc(100vw*16/9)] aspect-[9/16] overflow-hidden relative ${bgClass}`}>
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
