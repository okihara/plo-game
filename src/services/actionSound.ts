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

// --- Web Audio API ベース実装 ---

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<SoundKey, AudioBuffer>();
// 同じキーの再生中ソースを追跡（重複再生で音量が加算されるのを防ぐ）
const activeSources = new Map<SoundKey, AudioBufferSourceNode>();

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioCtx;
}

// ユーザー操作で AudioContext を unlock（iOS Safari 対策）
function unlockAudioContext() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  // 空バッファを再生して完全にunlock
  const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
}

// タッチ/クリックで一度だけunlock
const unlockEvents = ['touchstart', 'touchend', 'click'];
function onUnlockEvent() {
  unlockAudioContext();
  for (const ev of unlockEvents) {
    document.removeEventListener(ev, onUnlockEvent, true);
  }
}
for (const ev of unlockEvents) {
  document.addEventListener(ev, onUnlockEvent, { capture: true, once: false });
}

// 音声データをプリロード（fetch → decodeAudioData）
async function preload() {
  const ctx = getAudioContext();
  const entries = Object.entries(SOUND_FILES) as [SoundKey, string][];
  await Promise.all(
    entries.map(async ([key, src]) => {
      try {
        const resp = await fetch(src);
        const arrayBuf = await resp.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        bufferCache.set(key, audioBuf);
      } catch {
        // ロード失敗は無視（ゲーム進行に影響しない）
      }
    }),
  );
}

preload();

function play(key: SoundKey) {
  if (!enabled) return;
  const buffer = bufferCache.get(key);
  if (!buffer) return;

  const ctx = getAudioContext();
  // suspended なら resume を試みる
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  // 同じキーの前の再生を停止（音量加算を防ぐ）
  const prev = activeSources.get(key);
  if (prev) {
    try { prev.stop(); } catch { /* already stopped */ }
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);

  activeSources.set(key, source);
  source.onended = () => {
    if (activeSources.get(key) === source) {
      activeSources.delete(key);
    }
  };
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
