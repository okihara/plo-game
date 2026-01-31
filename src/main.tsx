import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleLobby } from './pages/SimpleLobby';
import { OnlineGame } from './pages/OnlineGame';
import { GameSettingsProvider } from './contexts/GameSettingsContext';
import './index.css';

function App() {
  const [blinds, setBlinds] = useState<string | null>(null);

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
