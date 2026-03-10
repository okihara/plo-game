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
          h('div', { style: { display: 'flex', fontSize: 16, fontWeight: 700, color: '#1a1a1a' } },
            STREET_LABELS[street] || street),
          ...(cards && cards.length > 0
            ? cards.map(c => CardElement(c, 14))
            : []),
          ...(pot > 0
            ? [h('div', { style: { display: 'flex', fontSize: 13, color: '#555', marginLeft: 2 } }, `Pot ${pot}`)]
            : []),
        ),
      );
      prevStreet = street;
    }

    const isPreflop = street === 'preflop';
    const actionLabel = ACTION_LABELS[a.action] || a.action;
    const actionColor = a.action === 'fold' ? '#777' : '#1a1a1a';
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
        h('div', { style: { display: 'flex', width: 38, fontSize: 14, fontWeight: 700, color: '#555' } },
          a.position),
        h('div', { style: { display: 'flex', width: 76, fontSize: 15, color: '#444', overflow: 'hidden' } },
          truncName(a.playerName, 6)),
        ...(holeCards.length > 0
          ? [h('div', { style: { display: 'flex', alignItems: 'center', gap: 1, marginRight: 4 } },
              ...holeCards.map(c => CardElement(c, 12)))]
          : []),
        h('div', { style: { display: 'flex', width: 54, fontSize: 15, fontWeight: 600, color: actionColor } },
          actionLabel),
        h('div', { style: { display: 'flex', fontSize: 15, fontWeight: 600, color: amountColor } },
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
          h('div', { style: { display: 'flex', fontSize: 16, fontWeight: 700, color: '#1a1a1a' } },
            STREET_LABELS[s]),
          ...streetCards[s].map(c => CardElement(c, 14)),
          ...(runningPot > 0
            ? [h('div', { style: { display: 'flex', fontSize: 13, color: '#555', marginLeft: 2 } }, `Pot ${runningPot}`)]
            : []),
        ),
      );
    }
  }

  // Result セクション: コミュニティカード + Pot + 各プレイヤーの結果
  elements.push(
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: '1px solid #d8d2c8',
        paddingBottom: 2, paddingTop: 6, marginBottom: 2,
      },
    },
      h('div', { style: { display: 'flex', fontSize: 16, fontWeight: 700, color: '#1a1a1a' } }, 'Result'),
      ...data.communityCards.map(c => CardElement(c, 14)),
      h('div', { style: { display: 'flex', fontSize: 13, color: '#555', marginLeft: 2 } },
        `Pot ${data.potSize}`),
    ),
  );

  // プレイヤーをポジション順（BTN→SB→BB→UTG→HJ→CO）でソート
  const POSITION_ORDER = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
  const sortedPlayers = [...data.players].sort((a, b) => {
    const aIdx = a.position ? POSITION_ORDER.indexOf(a.position) : 99;
    const bIdx = b.position ? POSITION_ORDER.indexOf(b.position) : 99;
    return aIdx - bIdx;
  });

  for (const p of sortedPlayers) {
    const profitColor = p.profit > 0 ? '#2d6a4f' : p.profit < 0 ? '#C0392B' : '#888';
    const profitStr = p.profit > 0 ? `+${p.profit}` : `${p.profit}`;
    elements.push(
      h('div', {
        style: { display: 'flex', alignItems: 'center', padding: '1px 0' },
      },
        h('div', { style: { display: 'flex', width: 38, fontSize: 14, fontWeight: 700, color: '#555' } },
          p.position || ''),
        h('div', { style: { display: 'flex', width: 76, fontSize: 15, color: '#444', overflow: 'hidden' } },
          truncName(p.username, 6)),
        h('div', { style: { display: 'flex', flex: 1, fontSize: 14, color: '#555', overflow: 'hidden' } },
          p.finalHand || ''),
        h('div', { style: { display: 'flex', fontSize: 15, fontWeight: 700, color: profitColor } },
          profitStr),
      ),
    );
  }

  return elements;
}

// 要素の種類ごとの推定高さ（px）
const STREET_HEADER_HEIGHT = 28; // ストリートヘッダー行
const ACTION_ROW_HEIGHT = 20;    // アクション行
const COL_MAX_HEIGHT = 440;      // カラム内利用可能高さ（630 - ヘッダー等 - padding）

function buildActionColumns(data: HandOgpData): ReactNode {
  const elements = buildActionElements(data);

  // 左カラムが埋まったら右カラムに流す
  const leftElements: ReactNode[] = [];
  const rightElements: ReactNode[] = [];
  let leftHeight = 0;
  let overflowed = false;

  for (const el of elements) {
    // ストリートヘッダーかアクション行かを推定（props.style.borderBottomの有無で判定）
    const props = (el as unknown as Record<string, unknown>)?.props as Record<string, unknown> | undefined;
    const style = props?.style as Record<string, unknown> | undefined;
    const isHeader = style?.borderBottom != null;
    const rowH = isHeader ? STREET_HEADER_HEIGHT : ACTION_ROW_HEIGHT;

    if (!overflowed && leftHeight + rowH <= COL_MAX_HEIGHT) {
      leftElements.push(el);
      leftHeight += rowH;
    } else {
      overflowed = true;
      rightElements.push(el);
    }
  }

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
    ...(rightElements.length > 0
      ? [h('div', { style: colStyle }, ...rightElements)]
      : []),
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
        h('div', { style: { display: 'flex', fontSize: 18, fontWeight: 600, color: '#444' } },
          data.blinds),
        h('div', { style: { display: 'flex', fontSize: 14, color: '#555' } }, dateStr),
      ),
      h('div', { style: { display: 'flex', fontSize: 16, color: '#1a1a1a', fontWeight: 700 } }, 'Baby PLO'),
    ),

    // Divider
    h('div', { style: { display: 'flex', width: '100%', height: 1, backgroundColor: '#d8d2c8', marginBottom: 10 } }),

    // 2-column actions
    buildActionColumns(data),

    // Footer
    h('div', {
      style: {
        display: 'flex', justifyContent: 'center',
        paddingBottom: 12, paddingTop: 8,
      },
    },
      h('div', { style: { display: 'flex', fontSize: 14, color: '#555' } }, 'baby-plo.up.railway.app'),
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
