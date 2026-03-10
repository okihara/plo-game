import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ReactNode } from 'react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_CACHE_DIR = join(__dirname, 'fonts');
const FONT_BOLD_PATH = join(FONT_CACHE_DIR, 'NotoSansCJKjp-Bold.otf');
const FONT_REGULAR_PATH = join(FONT_CACHE_DIR, 'NotoSansCJKjp-Regular.otf');

const FONT_URLS = {
  bold: 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf',
  regular: 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',
};

async function downloadFont(url: string, path: string): Promise<Buffer> {
  if (existsSync(path)) {
    return readFileSync(path);
  }
  console.log(`Downloading font: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Font download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!existsSync(FONT_CACHE_DIR)) mkdirSync(FONT_CACHE_DIR, { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

let fontsPromise: Promise<{ regular: Buffer; bold: Buffer }> | null = null;
function getFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      downloadFont(FONT_URLS.regular, FONT_REGULAR_PATH),
      downloadFont(FONT_URLS.bold, FONT_BOLD_PATH),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  return fontsPromise;
}

const WIDTH = 1200;
const HEIGHT = 630;

function h(type: string, props: Record<string, unknown>, ...children: unknown[]): ReactNode {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } } as unknown as ReactNode;
}

const SUIT_SYMBOLS: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
const SUIT_COLORS: Record<string, string> = { h: '#C0392B', d: '#2471A3', c: '#27AE60', s: '#2C3E50' };

function CardElement(cardStr: string, size: number = 20) {
  const rank = cardStr.slice(0, -1);
  const suit = cardStr.slice(-1);
  const color = SUIT_COLORS[suit] || '#333';
  const symbol = SUIT_SYMBOLS[suit] || suit;
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#fff', border: '1px solid #d0c8bc',
      borderRadius: 3, padding: '1px 3px', marginRight: 2,
      fontSize: size, fontWeight: 700, color, lineHeight: 1,
    },
  }, `${rank}${symbol}`);
}

interface HandOgpPlayer {
  username: string;
  seatPosition: number;
  holeCards: string[];
  finalHand: string | null;
  profit: number;
  position: string | null;
}

interface HandOgpAction {
  position: string;
  playerName: string;
  action: string;
  amount: number;
  street?: string;
}

interface HandOgpData {
  handId: string;
  blinds: string;
  communityCards: string[];
  potSize: number;
  rakeAmount: number;
  players: HandOgpPlayer[];
  actions: HandOgpAction[];
  dealerPosition: number;
  createdAt: string;
}

function getPositionName(seatPosition: number, dealerPosition: number, allSeats: number[]): string | null {
  const sorted = [...allSeats].sort((a, b) => ((a - dealerPosition + 6) % 6) - ((b - dealerPosition + 6) % 6));
  const n = sorted.length;
  const posNames: Record<number, string[]> = {
    2: ['SB', 'BB'],
    3: ['BTN', 'SB', 'BB'],
    4: ['BTN', 'SB', 'BB', 'CO'],
    5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  };
  const names = posNames[n];
  if (!names) return null;
  const idx = sorted.indexOf(seatPosition);
  return idx >= 0 ? names[idx] : null;
}

const ACTION_LABELS: Record<string, string> = {
  fold: 'Fold', check: 'Check', call: 'Call',
  bet: 'Bet', raise: 'Raise', allin: 'All-in',
};

const STREET_LABELS: Record<string, string> = {
  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
};

function truncName(name: string, max: number): string {
  return name.length > max ? name.slice(0, max) + '…' : name;
}

// ── アクション要素を構築（ストリートヘッダー + ホールカード + アクション行） ──

function buildActionElements(data: HandOgpData): ReactNode[] {
  const streetCards: Record<string, string[]> = {
    flop: data.communityCards.slice(0, 3),
    turn: data.communityCards.slice(3, 4),
    river: data.communityCards.slice(4, 5),
  };

  // ストリート開始時のポットを事前計算（SB+BBを初期値に）
  const blindParts = data.blinds.split('/').map(s => Number(s.trim()));
  const blindTotal = blindParts.reduce((sum, v) => sum + (v || 0), 0);
  const streetPot: Record<string, number> = {};
  let runningPot = blindTotal;
  let calcPrevStreet = '';
  for (const a of data.actions) {
    const s = a.street || 'preflop';
    if (s !== calcPrevStreet) {
      streetPot[s] = runningPot;
      calcPrevStreet = s;
    }
    runningPot += a.amount;
  }

  // playerName → プレイヤー情報のマップ（アクションからホールカードを引く用）
  const playerByName = new Map(data.players.map(p => [p.username, p]));

  const elements: ReactNode[] = [];
  let prevStreet = '';

  for (const a of data.actions) {
    const street = a.street || 'preflop';
    if (street !== prevStreet) {
      // ストリートヘッダー
      const cards = streetCards[street];
      const pot = streetPot[street] || 0;
      elements.push(
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: '1px solid #d8d2c8',
            paddingBottom: 2, paddingTop: prevStreet ? 6 : 0,
            marginBottom: 2,
          },
        },
          h('div', { style: { display: 'flex', fontSize: 12, fontWeight: 700, color: '#1a1a1a' } },
            STREET_LABELS[street] || street),
          ...(cards && cards.length > 0
            ? cards.map(c => CardElement(c, 12))
            : []),
          ...(pot > 0
            ? [h('div', { style: { display: 'flex', fontSize: 10, color: '#888', marginLeft: 2 } }, `Pot ${pot}`)]
            : []),
        ),
      );
      prevStreet = street;
    }

    const isPreflop = street === 'preflop';
    const actionLabel = ACTION_LABELS[a.action] || a.action;
    const actionColor = a.action === 'fold' ? '#999' : '#1a1a1a';
    const amountColor = a.action === 'allin' ? '#2d6a4f' : '#1a1a1a';
    const player = playerByName.get(a.playerName);
    const holeCards = isPreflop && player ? player.holeCards : [];

    elements.push(
      h('div', {
        style: {
          display: 'flex', alignItems: 'center',
          padding: '1px 0',
        },
      },
        h('div', { style: { display: 'flex', width: 30, fontSize: 10, fontWeight: 700, color: '#888' } },
          a.position),
        h('div', { style: { display: 'flex', width: 58, fontSize: 11, color: '#666', overflow: 'hidden' } },
          truncName(a.playerName, 6)),
        ...(holeCards.length > 0
          ? [h('div', { style: { display: 'flex', alignItems: 'center', gap: 1, marginRight: 4 } },
              ...holeCards.map(c => CardElement(c, 9)))]
          : []),
        h('div', { style: { display: 'flex', width: 42, fontSize: 11, fontWeight: 600, color: actionColor } },
          actionLabel),
        h('div', { style: { display: 'flex', fontSize: 11, fontWeight: 600, color: amountColor } },
          a.amount > 0 ? `${a.amount}` : ''),
      ),
    );
  }

  // アクションのないストリートのランアウトカード
  const streetsInActions = new Set(data.actions.map(a => a.street || 'preflop'));
  for (const s of ['flop', 'turn', 'river'] as const) {
    if (!streetsInActions.has(s) && streetCards[s]?.length > 0) {
      elements.push(
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: '1px solid #d8d2c8',
            paddingBottom: 2, paddingTop: 6, marginBottom: 2,
          },
        },
          h('div', { style: { display: 'flex', fontSize: 12, fontWeight: 700, color: '#1a1a1a' } },
            STREET_LABELS[s]),
          ...streetCards[s].map(c => CardElement(c, 12)),
          ...(runningPot > 0
            ? [h('div', { style: { display: 'flex', fontSize: 10, color: '#888', marginLeft: 2 } }, `Pot ${runningPot}`)]
            : []),
        ),
      );
    }
  }

  return elements;
}

function buildActionColumns(data: HandOgpData): ReactNode {
  const elements = buildActionElements(data);

  // 要素を左右2カラムに分割（おおよそ半分で）
  const mid = Math.ceil(elements.length / 2);
  const leftElements = elements.slice(0, mid);
  const rightElements = elements.slice(mid);

  const colStyle = {
    display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0,
    backgroundColor: '#f5f1ec', borderRadius: 8,
    border: '1px solid #d8d2c8', padding: '8px 10px',
    overflow: 'hidden',
  };

  return h('div', {
    style: { display: 'flex', flex: 1, gap: 12, overflow: 'hidden' },
  },
    h('div', { style: colStyle }, ...leftElements),
    h('div', { style: colStyle }, ...rightElements),
  );
}

// ── メインレイアウト ──

function buildHandElement(data: HandOgpData): ReactNode {
  const SIDE_PAD = 36;

  const dateStr = new Date(data.createdAt).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column',
      width: WIDTH, height: HEIGHT,
      backgroundColor: '#faf8f5',
      padding: `0 ${SIDE_PAD}px`,
      fontFamily: 'Noto Sans CJK JP',
    },
  },
    // Top accent line
    h('div', { style: { display: 'flex', position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: '#1a1a1a' } }),

    // Header
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 22, marginBottom: 8,
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12 } },
        h('div', { style: { display: 'flex', fontSize: 24, fontWeight: 700, color: '#1a1a1a' } },
          `Hand #${data.handId.slice(-6)}`),
        h('div', { style: { display: 'flex', fontSize: 18, fontWeight: 600, color: '#666' } },
          data.blinds),
        h('div', { style: { display: 'flex', fontSize: 14, color: '#888' } }, dateStr),
      ),
      h('div', { style: { display: 'flex', fontSize: 16, color: '#1a1a1a', fontWeight: 700 } }, 'Baby PLO'),
    ),

    // Divider
    h('div', { style: { display: 'flex', width: '100%', height: 1, backgroundColor: '#d8d2c8', marginBottom: 10 } }),

    // Community cards + Pot
    h('div', {
      style: {
        display: 'flex', alignItems: 'center',
        gap: 12, marginBottom: 10,
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        ...data.communityCards.map(c => CardElement(c, 18))),
      h('div', { style: { display: 'flex', fontSize: 14, fontWeight: 700, color: '#1a1a1a' } },
        `Pot ${data.potSize}`),
      ...(data.rakeAmount > 0
        ? [h('div', { style: { display: 'flex', fontSize: 11, color: '#888' } }, `Rake ${data.rakeAmount}`)]
        : []),
    ),

    // 2-column actions
    buildActionColumns(data),

    // Footer
    h('div', {
      style: {
        display: 'flex', justifyContent: 'center',
        paddingBottom: 12, paddingTop: 8,
      },
    },
      h('div', { style: { display: 'flex', fontSize: 14, color: '#888' } }, 'baby-plo.up.railway.app'),
    ),
  );
}

export async function renderHandOgpImage(data: HandOgpData): Promise<Buffer> {
  const fonts = await getFonts();
  const element = buildHandElement(data);

  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Noto Sans CJK JP', data: fonts.regular, weight: 400, style: 'normal' as const },
      { name: 'Noto Sans CJK JP', data: fonts.bold, weight: 700, style: 'normal' as const },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

export { getPositionName };
