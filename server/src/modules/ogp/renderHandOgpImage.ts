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
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '2px solid #d8d2c8',
            paddingBottom: 3, paddingTop: prevStreet ? 8 : 0,
            marginBottom: 3,
          },
        },
          h('div', { style: { display: 'flex', fontSize: 22, fontWeight: 700, color: '#1a1a1a' } },
            STREET_LABELS[street] || street),
          ...(cards && cards.length > 0
            ? cards.map(c => CardElement(c, 18))
            : []),
          ...(pot > 0
            ? [h('div', { style: { display: 'flex', fontSize: 17, color: '#555', marginLeft: 2 } }, `Pot ${pot}`)]
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
          padding: '2px 0',
        },
      },
        h('div', { style: { display: 'flex', width: 48, fontSize: 19, fontWeight: 700, color: '#555' } },
          a.position),
        h('div', { style: { display: 'flex', width: 96, fontSize: 20, color: '#444', overflow: 'hidden' } },
          truncName(a.playerName, 6)),
        ...(holeCards.length > 0
          ? [h('div', { style: { display: 'flex', alignItems: 'center', gap: 1, marginRight: 6 } },
              ...holeCards.map(c => CardElement(c, 16)))]
          : []),
        h('div', { style: { display: 'flex', width: 68, fontSize: 20, fontWeight: 600, color: actionColor } },
          actionLabel),
        h('div', { style: { display: 'flex', fontSize: 20, fontWeight: 600, color: amountColor } },
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
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '2px solid #d8d2c8',
            paddingBottom: 3, paddingTop: 8, marginBottom: 3,
          },
        },
          h('div', { style: { display: 'flex', fontSize: 22, fontWeight: 700, color: '#1a1a1a' } },
            STREET_LABELS[s]),
          ...streetCards[s].map(c => CardElement(c, 18)),
          ...(runningPot > 0
            ? [h('div', { style: { display: 'flex', fontSize: 17, color: '#555', marginLeft: 2 } }, `Pot ${runningPot}`)]
            : []),
        ),
      );
    }
  }

  // Result セクション: コミュニティカード + Pot + 各プレイヤーの結果
  elements.push(
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '2px solid #d8d2c8',
        paddingBottom: 3, paddingTop: 8, marginBottom: 3,
      },
    },
      h('div', { style: { display: 'flex', fontSize: 22, fontWeight: 700, color: '#1a1a1a' } }, 'Result'),
      ...data.communityCards.map(c => CardElement(c, 18)),
      h('div', { style: { display: 'flex', fontSize: 17, color: '#555', marginLeft: 2 } },
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
        style: { display: 'flex', alignItems: 'center', padding: '2px 0' },
      },
        h('div', { style: { display: 'flex', width: 48, fontSize: 19, fontWeight: 700, color: '#555' } },
          p.position || ''),
        h('div', { style: { display: 'flex', width: 96, fontSize: 20, color: '#444', overflow: 'hidden' } },
          truncName(p.username, 6)),
        h('div', { style: { display: 'flex', flex: 1, fontSize: 18, color: '#555', overflow: 'hidden' } },
          p.finalHand || ''),
        h('div', { style: { display: 'flex', fontSize: 20, fontWeight: 700, color: profitColor } },
          profitStr),
      ),
    );
  }

  return elements;
}

// 要素の種類ごとの推定高さ（px）— CSS値から算出、余裕を持たせて切れ防止
// ストリートヘッダー: paddingTop(8) + content(~26) + paddingBottom(3) + border(2) + marginBottom(3) = 42
const STREET_HEADER_HEIGHT = 42;
// アクション行: padding(2*2) + content(~24) + ホールカード考慮 = 30
const ACTION_ROW_HEIGHT = 30;
// カラム利用可能高さ: 画像630 - コンテナpadding(16+12) - カラムpadding(10*2) - カラムborder(1*2) = 580
const COL_MAX_HEIGHT = 580;

function estimateRowHeight(el: ReactNode): number {
  const props = (el as unknown as Record<string, unknown>)?.props as Record<string, unknown> | undefined;
  const style = props?.style as Record<string, unknown> | undefined;
  const isHeader = style?.borderBottom != null;
  return isHeader ? STREET_HEADER_HEIGHT : ACTION_ROW_HEIGHT;
}

function buildActionColumns(data: HandOgpData): ReactNode {
  const elements = buildActionElements(data);

  // ストリート単位のグループに分割（ヘッダー→次のヘッダーまでが1グループ）
  const groups: { elements: ReactNode[]; height: number }[] = [];
  for (const el of elements) {
    const isHeader = estimateRowHeight(el) === STREET_HEADER_HEIGHT;
    if (isHeader || groups.length === 0) {
      groups.push({ elements: [el], height: estimateRowHeight(el) });
    } else {
      const last = groups[groups.length - 1];
      last.elements.push(el);
      last.height += estimateRowHeight(el);
    }
  }

  // 左カラムにストリート単位で詰めて、溢れたら右カラムへ
  const leftElements: ReactNode[] = [];
  const rightElements: ReactNode[] = [];
  let leftHeight = 0;

  let overflowed = false;
  for (const g of groups) {
    if (!overflowed && leftHeight + g.height <= COL_MAX_HEIGHT) {
      leftElements.push(...g.elements);
      leftHeight += g.height;
    } else {
      overflowed = true;
      rightElements.push(...g.elements);
    }
  }

  const colStyle = {
    display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0,
    backgroundColor: '#f5f1ec', borderRadius: 8,
    border: '1px solid #d8d2c8', padding: '10px 14px',
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
  const SIDE_PAD = 24;

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column',
      width: WIDTH, height: HEIGHT,
      backgroundColor: '#faf8f5',
      padding: `16px ${SIDE_PAD}px 12px`,
      fontFamily: 'Noto Sans CJK JP',
    },
  },
    // Actions (full height)
    buildActionColumns(data),
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
