import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface Providers {
  twitter: boolean;
  google: boolean;
}

// /api/auth/providers が取れないときのフォールバック（従来どおり Twitter のみ表示）
const DEFAULT_PROVIDERS: Providers = { twitter: true, google: false };

function GoogleIcon() {
  return (
    <svg className="w-[4.5cqw] h-[4.5cqw] shrink-0" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function Login() {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [error] = useState(() => new URLSearchParams(window.location.search).get('error'));
  const [devUsername, setDevUsername] = useState('');
  const [devLoggingIn, setDevLoggingIn] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/providers`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProviders(data ?? DEFAULT_PROVIDERS))
      .catch(() => setProviders(DEFAULT_PROVIDERS));
  }, []);

  const loginWith = (provider: 'twitter' | 'google') => {
    window.location.href = `${API_BASE}/api/auth/${provider}`;
  };

  const handleDevLogin = async () => {
    const username = devUsername.trim();
    if (!username || devLoggingIn) return;
    setDevLoggingIn(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username }),
      });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
    } catch (err) {
      console.error('Dev login failed:', err);
    }
    setDevLoggingIn(false);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-0 px-[8cqw]">
      {/* Logo & Title */}
      <div className="flex flex-col items-center mb-[8cqw]">
        <div className="w-[24cqw] h-[24cqw] rounded-full overflow-hidden border-[0.8cqw] border-forest/20 shadow-[0_8px_30px_rgba(29,58,39,0.25)] mb-[4cqw]">
          <img
            src="/images/plo_baby.png"
            alt="Baby PLO"
            className="w-full h-full object-cover scale-125"
          />
        </div>
        <h1 className="text-[9cqw] font-bold text-cream-900 tracking-tight leading-none">BabyPLO</h1>
        <p className="mt-[2cqw] text-[3.5cqw] text-cream-700">スマホで遊べる PLO ポーカー</p>
      </div>

      {/* Error */}
      {error === 'oauth_failed' && (
        <div className="w-full mb-[3cqw] px-[3cqw] py-[2.5cqw] bg-cream-50 border border-cream-400 rounded-[2cqw] text-center">
          <p className="text-[3.2cqw] text-[#C0392B] font-bold">ログインに失敗しました</p>
          <p className="mt-[0.5cqw] text-[2.8cqw] text-cream-800">時間をおいてもう一度お試しください。</p>
        </div>
      )}

      {/* Login Card */}
      <div className="w-full bg-white border border-cream-300 rounded-[3cqw] p-[5cqw] shadow-[0_8px_40px_rgba(139,126,106,0.2)]">
        <p className="text-[4cqw] text-cream-700 text-center mb-[4cqw]">ログインしてプレイ</p>

        {providers === null ? (
          <div className="text-center text-cream-500 text-[3.5cqw] py-[3cqw]">読み込み中...</div>
        ) : (
          <div className="flex flex-col gap-[2.5cqw]">
            {providers.twitter && (
              <button
                onClick={() => loginWith('twitter')}
                className="w-full py-[3cqw] px-[3cqw] text-[4cqw] bg-forest text-white rounded-[2cqw] hover:bg-forest-light transition-all font-bold flex items-center justify-center gap-[2cqw] shadow-[0_4px_20px_rgba(45,90,61,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_28px_rgba(45,90,61,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.97] active:shadow-[0_2px_10px_rgba(45,90,61,0.3)]"
              >
                Twitterでログイン
              </button>
            )}
            {providers.google && (
              <button
                onClick={() => loginWith('google')}
                className="w-full py-[3cqw] px-[3cqw] text-[4cqw] bg-white text-cream-900 border border-cream-300 rounded-[2cqw] hover:bg-cream-50 hover:border-cream-400 transition-all font-bold flex items-center justify-center gap-[2cqw] shadow-[0_2px_8px_rgba(139,126,106,0.12)] active:scale-[0.97]"
              >
                <GoogleIcon />
                Googleでログイン
              </button>
            )}
            {!providers.twitter && !providers.google && (
              <p className="text-center text-[3.2cqw] text-cream-600 py-[2cqw]">
                現在利用できるログイン方法がありません。
              </p>
            )}
          </div>
        )}
      </div>

      {/* Dev quick login（開発環境のみ） */}
      {import.meta.env.DEV && (
        <div className="w-full mt-[4cqw] bg-cream-100 border border-cream-300 rounded-[3cqw] p-[4cqw]">
          <p className="text-[3cqw] text-cream-600 mb-[2cqw]">開発用クイックログイン</p>
          <div className="flex gap-[2cqw]">
            <input
              type="text"
              value={devUsername}
              onChange={(e) => setDevUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDevLogin()}
              placeholder="ユーザー名"
              className="flex-1 min-w-0 px-[2.5cqw] py-[1.8cqw] text-[3.5cqw] bg-cream-50 border border-cream-300 rounded-[1.5cqw] text-cream-900 placeholder-cream-500 focus:outline-none focus:border-cream-400"
            />
            <button
              onClick={handleDevLogin}
              disabled={!devUsername.trim() || devLoggingIn}
              className="px-[3cqw] py-[1.8cqw] text-[3.5cqw] bg-cream-900 text-white font-bold rounded-[1.5cqw] disabled:opacity-40 shrink-0"
            >
              {devLoggingIn ? '...' : 'ログイン'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
