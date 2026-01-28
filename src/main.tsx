import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SimpleLobby } from './pages/SimpleLobby';
import { OnlineGame } from './pages/OnlineGame';
import './index.css';

function App() {
  const [isPlaying, setIsPlaying] = useState(false);

  if (isPlaying) {
    return <OnlineGame onBack={() => setIsPlaying(false)} />;
  }

  return <SimpleLobby onPlayOnline={() => setIsPlaying(true)} />;
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
