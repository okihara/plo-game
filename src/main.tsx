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

  // Debug pages
  if (currentPath === '/debug/player') {
    return <PlayerDebug />;
  }

  if (currentPath.startsWith('/spectate/')) {
    const tableId = currentPath.replace('/spectate/', '');
    return (
      <SpectatorView
        tableId={tableId}
        onBack={() => {
          window.history.pushState({}, '', '/');
          setCurrentPath('/');
        }}
      />
    );
  }

  if (currentPath === '/history') {
    return (
      <HandHistory onBack={() => {
        window.history.pushState({}, '', '/');
        setCurrentPath('/');
      }} />
    );
  }

  if (blinds) {
    return <OnlineGame blinds={blinds} onBack={() => setBlinds(null)} />;
  }

  return <SimpleLobby onPlayOnline={(selectedBlinds) => setBlinds(selectedBlinds)} />;
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
