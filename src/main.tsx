import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleLobby } from './pages/SimpleLobby';
import { OnlineGame } from './pages/OnlineGame';
import { PlayerDebug } from './pages/PlayerDebug';
import { HandHistory } from './pages/HandHistory';
import { SpectatorView } from './pages/SpectatorView';
import { GameSettingsProvider } from './contexts/GameSettingsContext';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';

// 開発環境のみ: ブラウザコンソールからデバッグ用チップ設定を呼べるようにする
if (import.meta.env.DEV) {
  import('./services/websocket').then(({ wsService }) => {
    (window as any).__debug = {
      setChips: (chips: number) => {
        wsService.debugSetChips(chips);
        console.log(`[debug] Requesting chip set to ${chips}`);
      },
    };
    console.log('[debug] Available commands: __debug.setChips(amount)');
  });
}

function App() {
  const [blinds, setBlinds] = useState<string | null>(null);
  const [isFastFold, setIsFastFold] = useState(false);
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

  const isGameScreen = !!blinds && currentPath === '/' ;
  const bgClass = isGameScreen ? 'game-bg' : 'bg-cream-200';

  let page;
  if (currentPath.startsWith('/spectate/')) {
    const tableId = currentPath.replace('/spectate/', '');
    page = (
      <SpectatorView
        tableId={tableId}
        onBack={() => {
          window.history.pushState({}, '', '/');
          setCurrentPath('/');
        }}
      />
    );
  } else if (currentPath === '/history') {
    page = (
      <HandHistory onBack={() => {
        window.history.pushState({}, '', '/');
        setCurrentPath('/');
      }} />
    );
  } else if (blinds) {
    page = <OnlineGame blinds={blinds} isFastFold={isFastFold} onBack={() => { setBlinds(null); setIsFastFold(false); }} />;
  } else {
    page = <SimpleLobby onPlayOnline={(selectedBlinds, fastFold) => { setBlinds(selectedBlinds); setIsFastFold(fastFold ?? false); }} />;
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
