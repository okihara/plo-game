import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlayerTest } from './pages/PlayerTest';
import { SimpleLobby } from './pages/SimpleLobby';
import { OnlineGame } from './pages/OnlineGame';
import './index.css';

type Page = 'lobby' | 'offline' | 'online' | 'test';

function AppRouter() {
  const [page, setPage] = useState<Page>('lobby');

  // Check URL hash for special pages
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#player-test') {
      setPage('test');
      return;
    }
    if (hash === '#offline' || hash === '#game') {
      setPage('offline');
      return;
    }
    if (hash === '#online') {
      setPage('online');
      return;
    }
  }, []);

  // Render based on current page
  switch (page) {
    case 'lobby':
      return (
        <SimpleLobby
          onPlayOffline={() => setPage('offline')}
          onPlayOnline={() => setPage('online')}
        />
      );

    case 'offline':
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="w-full h-screen flex items-center justify-center bg-gray-100 relative">
            <button
              onClick={() => setPage('lobby')}
              className="absolute top-4 left-4 z-50 px-4 py-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-colors text-sm"
            >
              ← 戻る
            </button>
            <App />
          </div>
        </div>
      );

    case 'online':
      return <OnlineGame onBack={() => setPage('lobby')} />;

    case 'test':
      return <PlayerTest />;

    default:
      return null;
  }
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>
);
