import { Home, Trophy, Clock, BarChart3, User } from 'lucide-react';

export type LobbyTab = 'home' | 'tournament' | 'history' | 'ranking' | 'profile';

interface BottomNavigationProps {
  activeTab: LobbyTab;
  onTabChange: (tab: LobbyTab) => void;
  isLoggedIn: boolean;
}

const TABS: { id: LobbyTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'ホーム', icon: Home },
  { id: 'tournament', label: '大会', icon: Trophy },
  { id: 'history', label: '履歴', icon: Clock },
  { id: 'ranking', label: 'ランキング', icon: BarChart3 },
  { id: 'profile', label: 'プロフィール', icon: User },
];

export function BottomNavigation({ activeTab, onTabChange, isLoggedIn }: BottomNavigationProps) {
  return (
    <nav className="shrink-0 px-[3cqw] pb-[2cqw] pb-[max(2cqw,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-around h-[12cqw] bg-white border border-cream-300 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          const isDisabled = !isLoggedIn && id !== 'home' && id !== 'tournament';

          return (
            <button
              key={id}
              onClick={() => !isDisabled && onTabChange(id)}
              disabled={isDisabled}
              className={`flex flex-col items-center justify-center gap-[0.3cqw] flex-1 h-full transition-colors ${
                isDisabled
                  ? 'opacity-30 cursor-not-allowed'
                  : isActive
                    ? 'text-forest'
                    : 'text-cream-500 active:text-cream-700'
              }`}
            >
              <Icon className="w-[5cqw] h-[5cqw]" strokeWidth={isActive ? 2.5 : 1.8} />
              <span className={`text-[2cqw] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
