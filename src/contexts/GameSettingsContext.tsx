import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface GameSettings {
  useBBNotation: boolean;
  bigBlind: number;
}

interface GameSettingsContextValue {
  settings: GameSettings;
  setUseBBNotation: (value: boolean) => void;
  setBigBlind: (value: number) => void;
  formatChips: (amount: number) => string;
}

const GameSettingsContext = createContext<GameSettingsContextValue | null>(null);

const STORAGE_KEY = 'plo-game-settings';

function loadSettings(): Partial<GameSettings> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveSettings(settings: Partial<GameSettings>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function GameSettingsProvider({ children }: { children: ReactNode }) {
  const [useBBNotation, setUseBBNotationState] = useState(() => {
    const loaded = loadSettings();
    return loaded.useBBNotation ?? false;
  });
  const [bigBlind, setBigBlind] = useState(100);

  useEffect(() => {
    saveSettings({ useBBNotation });
  }, [useBBNotation]);

  const setUseBBNotation = (value: boolean) => {
    setUseBBNotationState(value);
  };

  const formatChips = (amount: number): string => {
    if (useBBNotation && bigBlind > 0) {
      const bbAmount = amount / bigBlind;
      if (bbAmount === Math.floor(bbAmount)) {
        return `${bbAmount}bb`;
      }
      return `${bbAmount.toFixed(1)}bb`;
    }

    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    } else if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return `${amount}`;
  };

  const value: GameSettingsContextValue = {
    settings: { useBBNotation, bigBlind },
    setUseBBNotation,
    setBigBlind,
    formatChips,
  };


  return (
    <GameSettingsContext.Provider value={value}>
      {children}
    </GameSettingsContext.Provider>
  );
}

export function useGameSettings() {
  const context = useContext(GameSettingsContext);
  if (!context) {
    throw new Error('useGameSettings must be used within a GameSettingsProvider');
  }
  return context;
}
