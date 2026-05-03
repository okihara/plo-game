import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface GameSettings {
  useBBNotation: boolean;
  bigBlind: number;
  /** チップ表示倍率。トナメ=100、キャッシュ=1。
   *  内部 chip 値は raw (1 単位整数) のまま流通させ、formatChips の出力時に
   *  この値を掛けて「見かけ上のチップ数」に変換する。 */
  chipUnit: number;
  showHandName: boolean;
  analysisEnabled: boolean;
}

interface GameSettingsContextValue {
  settings: GameSettings;
  setUseBBNotation: (value: boolean) => void;
  setBigBlind: (value: number) => void;
  setChipUnit: (value: number) => void;
  setShowHandName: (value: boolean) => void;
  setAnalysisEnabled: (value: boolean) => void;
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
  const [showHandName, setShowHandNameState] = useState(() => {
    const loaded = loadSettings();
    return loaded.showHandName ?? true;
  });
  const [analysisEnabled, setAnalysisEnabledState] = useState(() => {
    const loaded = loadSettings();
    return loaded.analysisEnabled ?? false;
  });
  const [bigBlind, setBigBlind] = useState(100);
  const [chipUnit, setChipUnit] = useState(1);

  useEffect(() => {
    saveSettings({ useBBNotation, showHandName, analysisEnabled });
  }, [useBBNotation, showHandName, analysisEnabled]);

  const setUseBBNotation = (value: boolean) => {
    setUseBBNotationState(value);
  };

  const setShowHandName = (value: boolean) => {
    setShowHandNameState(value);
  };

  const setAnalysisEnabled = (value: boolean) => {
    setAnalysisEnabledState(value);
  };

  const formatChips = (amount: number): string => {
    // BB 表記は raw 同士の比なので chipUnit を掛けない (300/200 = 1500/1000 = 1.5bb)
    if (useBBNotation && bigBlind > 0) {
      const bbAmount = amount / bigBlind;
      if (bbAmount === Math.floor(bbAmount)) {
        return `${bbAmount}bb`;
      }
      return `${bbAmount.toFixed(1)}bb`;
    }

    // 絶対チップ数表示は raw に chipUnit を掛けて display 値にする
    const display = amount * chipUnit;
    if (display >= 1000000) {
      return `${(display / 1000000).toFixed(1)}M`;
    } else if (display >= 1000) {
      return `${(display / 1000).toFixed(1)}K`;
    }
    return `${display}`;
  };

  const value: GameSettingsContextValue = {
    settings: { useBBNotation, bigBlind, chipUnit, showHandName, analysisEnabled },
    setUseBBNotation,
    setBigBlind,
    setChipUnit,
    setShowHandName,
    setAnalysisEnabled,
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
