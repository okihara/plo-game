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

function App() {
  const [blinds, setBlinds] = useState<string | null>(null);
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
    page = <OnlineGame blinds={blinds} onBack={() => setBlinds(null)} />;
  } else {
    page = <SimpleLobby onPlayOnline={(selectedBlinds) => setBlinds(selectedBlinds)} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="w-full h-screen flex items-center justify-center bg-gray-900 relative">
        <div className="@container flex flex-col w-full h-full max-w-[calc(100vh*9/16)] max-h-[calc(100vw*16/9)] aspect-[9/16] overflow-hidden relative bg-gray-900">
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
