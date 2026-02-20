import type { Action } from '../logic/types';

type SoundKey = Action | 'win' | 'lose' | 'deal' | 'myturn';

const STORAGE_KEY = 'plo-sound-enabled';

// デフォルトはオフ
let enabled = localStorage.getItem(STORAGE_KEY) === 'true';

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
  localStorage.setItem(STORAGE_KEY, String(value));
}

const SOUND_FILES: Record<SoundKey, string> = {
  check: '/sounds/check.mp3',
  call: '/sounds/call.mp3',
  bet: '/sounds/bet.mp3',
  raise: '/sounds/raise.mp3',
  fold: '/sounds/fold.mp3',
  allin: '/sounds/allin.mp3',
  win: '/sounds/win.mp3',
  lose: '/sounds/lose.mp3',
  deal: '/sounds/deal.mp3',
  myturn: '/sounds/myturn.mp3',
};

// プリロードされた Audio オブジェクトのキャッシュ
const audioCache = new Map<SoundKey, HTMLAudioElement>();

// 起動時にプリロード
function preload() {
  for (const [key, src] of Object.entries(SOUND_FILES)) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audioCache.set(key as SoundKey, audio);
  }
}

preload();

function play(key: SoundKey) {
  if (!enabled) return;
  const cached = audioCache.get(key);
  if (!cached) return;
  cached.currentTime = 0;
  cached.play().catch(() => {});
}

export function playActionSound(action: Action) {
  play(action);
}

export function playResultSound(isWinner: boolean) {
  play(isWinner ? 'win' : 'lose');
}

export function playDealSound() {
  play('deal');
}

export function playMyTurnSound() {
  play('myturn');
}
