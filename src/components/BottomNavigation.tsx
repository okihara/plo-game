import { Home, Trophy, Clock, BarChart3, User } from 'lucide-react';

export type LobbyTab = 'home' | 'tournament' | 'history' | 'ranking' | 'profile';

interface BottomNavigationProps {
  activeTab: LobbyTab;
  onTabChange: (tab: LobbyTab) => void;
  isLoggedIn: boolean;
}

const TABS: { id: LobbyTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'ホーム', icon: Home },
  { id: 'ranking', label: 'ランキング', icon: BarChart3 },
  { id: 'tournament', label: 'トナメ', icon: Trophy },
  { id: 'history', label: 'ハンド履歴', icon: Clock },
  { id: 'profile', label: 'Stats', icon: User },
];

export function BottomNavigation({ activeTab, onTabChange, isLoggedIn }: BottomNavigationProps) {
  return (
    <nav className="absolute bottom-0 left-0 right-0 z-50 px-[3cqw] pb-[max(2cqw,env(safe-area-inset-bottom))] pointer-events-none">
      <div className="relative flex items-center justify-around h-[12cqw] bg-white border border-cream-300 rounded-full shadow-[0_4px_50px_rgba(0,0,0,1)] pointer-events-auto">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          const isDisabled = !isLoggedIn && id !== 'home' && id !== 'tournament';
          const isCenter = id === 'tournament';

          if (isCenter) {
            return (
              <div key={id} className="relative flex-1 flex items-center justify-center h-full">
                {/* 白いサークル背景 */}
                <div className="absolute -top-[4cqw] w-[14cqw] h-[14cqw] bg-white rounded-full border border-cream-300 shadow-[0_2px_12px_rgba(0,0,0,0.25)] pointer-events-none" />
                <button
                  onClick={() => !isDisabled && onTabChange(id)}
                  disabled={isDisabled}
                  className={`absolute -top-[4cqw] z-10 w-[14cqw] h-[14cqw] rounded-full flex flex-col items-center justify-center transition-colors ${
                    isDisabled
                      ? 'opacity-30 cursor-not-allowed'
                      : isActive
                        ? 'text-forest'
                        : 'text-cream-700 active:text-cream-800'
                  }`}
                >
                  <Icon className="w-[6.5cqw] h-[6.5cqw]" strokeWidth={isActive ? 2.5 : 2} />
                  <span className={`text-[2.4cqw] leading-none mt-[0.5cqw] ${isActive ? 'font-bold' : 'font-semibold'}`}>
                    {label}
                  </span>
                  {isActive && <span className="absolute bottom-[0.5cqw] w-[1.2cqw] h-[1.2cqw] rounded-full bg-forest" />}
                </button>
              </div>
            );
          }

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
                    : 'text-cream-700 active:text-cream-800'
              }`}
            >
              <Icon className="w-[6cqw] h-[6cqw]" strokeWidth={isActive ? 2.5 : 2} />
              <span className={`text-[2.4cqw] leading-none ${isActive ? 'font-bold' : 'font-semibold'}`}>
                {label}
              </span>
              {isActive && <span className="w-[1.2cqw] h-[1.2cqw] rounded-full bg-forest" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
