import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleLobby } from './pages/SimpleLobby';
import { OnlineGame } from './pages/OnlineGame';
import { PlayerDebug } from './pages/PlayerDebug';
import { GameSettingsProvider } from './contexts/GameSettingsContext';
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

  if (blinds) {
    return <OnlineGame blinds={blinds} onBack={() => setBlinds(null)} />;
  }

  return <SimpleLobby onPlayOnline={(selectedBlinds) => setBlinds(selectedBlinds)} />;
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <GameSettingsProvider>
      <App />
    </GameSettingsProvider>
  </StrictMode>
);
