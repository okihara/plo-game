/**
 * クイズ画像生成（satori + resvg）。
 * 既存の OGP 画像生成パターンを踏襲し、Twitter 推奨 1200x675 の画像を出力する。
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ReactNode } from 'react';
import type { Card } from '../../shared/logic/types.js';
import { cardToString } from '@plo/shared';

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
const HEIGHT = 675;

function h(type: string, props: Record<string, unknown>, ...children: unknown[]): ReactNode {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } } as unknown as ReactNode;
}

const SUIT_SYMBOLS: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
const SUIT_COLORS: Record<string, string> = { h: '#C0392B', d: '#2471A3', c: '#27AE60', s: '#2C3E50' };

function CardEl(card: Card, size: number = 32) {
  const color = SUIT_COLORS[card.suit] || '#333';
  const symbol = SUIT_SYMBOLS[card.suit] || card.suit;
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#fff', border: '2px solid #d0c8bc',
      borderRadius: 8, padding: '4px 8px', marginRight: 6,
      fontSize: size, fontWeight: 700, color, lineHeight: 1,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    },
  }, `${card.rank}${symbol}`);
}

export interface QuizImageData {
  title: string;
  communityCards: Card[];
  holeCards?: Card[];
  holeCardsB?: Card[];
  /** 4択の選択肢（ナッツ問題でハンドを並べる場合に使う） */
  choiceHands?: Card[][];
  pot?: string;
  street?: string;
  drawInfo?: string;
}

function buildElement(data: QuizImageData): ReactNode {
  const PAD = 40;

  // タイトル
  const titleEl = h('div', {
    style: {
      display: 'flex', fontSize: 28, fontWeight: 700, color: '#1a1a1a',
      marginBottom: 16,
    },
  }, data.title);

  // ボード
  const boardEl = h('div', {
    style: { display: 'flex', flexDirection: 'column', marginBottom: 20 },
  },
    h('div', { style: { display: 'flex', fontSize: 16, color: '#666', marginBottom: 8 } },
      data.street ? `Board（${data.street}）` : 'Board'),
    h('div', { style: { display: 'flex', gap: 6 } },
      ...data.communityCards.map(c => CardEl(c, 38)),
    ),
  );

  // ハンド（1つ or 2つ）
  const handElements: ReactNode[] = [];
  if (data.holeCards) {
    handElements.push(
      h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 12 } },
        h('div', { style: { display: 'flex', fontSize: 16, color: '#666', marginBottom: 6 } },
          data.holeCardsB ? 'Hand A' : 'Your Hand'),
        h('div', { style: { display: 'flex', gap: 4 } },
          ...data.holeCards.map(c => CardEl(c, 32)),
        ),
      ),
    );
  }
  if (data.holeCardsB) {
    handElements.push(
      h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 12 } },
        h('div', { style: { display: 'flex', fontSize: 16, color: '#666', marginBottom: 6 } }, 'Hand B'),
        h('div', { style: { display: 'flex', gap: 4 } },
          ...data.holeCardsB.map(c => CardEl(c, 32)),
        ),
      ),
    );
  }

  // 4ハンド選択肢（ナッツ問題）
  if (data.choiceHands) {
    const labels = ['A', 'B', 'C', 'D'];
    handElements.push(
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 } },
        ...data.choiceHands.map((hand, i) =>
          h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 8 } },
            h('div', { style: { display: 'flex', fontSize: 15, color: '#555', marginBottom: 4 } }, `Hand ${labels[i]}`),
            h('div', { style: { display: 'flex', gap: 3 } },
              ...hand.map(c => CardEl(c, 26)),
            ),
          ),
        ),
      ),
    );
  }

  // ドロー情報
  const drawEl = data.drawInfo
    ? h('div', { style: { display: 'flex', fontSize: 18, color: '#2471A3', fontWeight: 700, marginTop: 8 } }, data.drawInfo)
    : null;

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column',
      width: WIDTH, height: HEIGHT,
      backgroundColor: '#1a472a',
      padding: `${PAD}px`,
      fontFamily: 'Noto Sans CJK JP',
    },
  },
    // 上部バー
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
      h('div', { style: { display: 'flex', fontSize: 18, color: '#c8b88a', fontWeight: 700 } }, '🃏 Daily PLO Quiz'),
      h('div', { style: { display: 'flex', fontSize: 16, color: '#999' } }, 'Baby PLO'),
    ),
    // カードエリア（白背景）
    h('div', {
      style: {
        display: 'flex', flexDirection: 'column', flex: 1,
        backgroundColor: '#f5f0e8', borderRadius: 16,
        padding: '24px 32px',
      },
    },
      titleEl,
      boardEl,
      ...handElements,
      ...(drawEl ? [drawEl] : []),
    ),
    // フッター
    h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: 12 } },
      h('div', { style: { display: 'flex', fontSize: 14, color: '#888' } }, 'babyplo.app'),
    ),
  );
}

export async function renderQuizImage(data: QuizImageData): Promise<Buffer> {
  const fonts = await getFonts();
  const element = buildElement(data);

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
