import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlayerTest } from './pages/PlayerTest';
import './index.css';

// URLハッシュでテストページに切り替え可能
// 例: http://localhost:5173/#player-test
const getPage = () => {
  const hash = window.location.hash;
  if (hash === '#player-test') return <PlayerTest />;
  return <App />;
};

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {getPage()}
  </StrictMode>
);
