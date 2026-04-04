import { describe, it, expect } from 'vitest';
import type { Card } from '../../../../shared/logic/types.js';
import { findOutCards } from '../boardQuiz.js';

/** カード文字列をCardオブジェクトに変換 (例: "Ah" → { rank: 'A', suit: 'h' }) */
function c(str: string): Card {
  return { rank: str[0] as Card['rank'], suit: str[1] as Card['suit'] };
}

describe('findOutCards', () => {
  it('フロップでAがストレートのアウツに誤カウントされない', () => {
    // ボード: 4♣ K♥ 7♦  ハンド: 8♦ 3♦ 5♦ 6♣
    // ストレートドロー(3-4-5-6-7-8)があるが、Aは関係ない
    // パディングで2が補われてA-2-3-4-5ホイールが偶然成立するのは誤り
    const holeCards = [c('8d'), c('3d'), c('5d'), c('6c')];
    const community = [c('4c'), c('Kh'), c('7d')];
    const currentHandRank = 1; // ハイカード

    const outs = findOutCards(holeCards, community, currentHandRank);
    const outRanks = outs.map(o => o.card.rank);

    // Aはアウツに含まれるべきでない
    // ボード4枚(4c,Kh,7d,A?)ではホール2枚+ボード3枚でストレートは作れない
    expect(outRanks).not.toContain('A');
  });

  it('フロップで正当なストレートドローのアウツは検出される', () => {
    // ボード: 4♣ K♥ 7♦  ハンド: 8♦ 3♦ 5♦ 6♣
    // 3-4-5-6-7 や 4-5-6-7-8 のストレートドロー
    const holeCards = [c('8d'), c('3d'), c('5d'), c('6c')];
    const community = [c('4c'), c('Kh'), c('7d')];
    const currentHandRank = 1;

    const outs = findOutCards(holeCards, community, currentHandRank);
    const outRanks = new Set(outs.map(o => o.card.rank));

    // ストレート完成に必要なカード（ほとんどのリバーで改善する）
    // 3: (5,6)+4,7,3 → 3-4-5-6-7  ← ターンで3が来ればどのリバーでもストレート
    // 但し3dはハンドにある
    expect(outRanks.has('3')).toBe(true);
  });

  it('ターンでAがホイールのアウツとして正しく検出される', () => {
    // ボード: 4♣ K♥ 7♦ 2♠  ハンド: 8♦ 3♦ 5♦ 6♣
    // ホール(3d,5d) + ボード(Ah,2s,4c) → A-2-3-4-5 ストレート（ホイール）
    const holeCards = [c('8d'), c('3d'), c('5d'), c('6c')];
    const community = [c('4c'), c('Kh'), c('7d'), c('2s')];
    const currentHandRank = 1;

    const outs = findOutCards(holeCards, community, currentHandRank);
    const aceOuts = outs.filter(o => o.card.rank === 'A');

    // ターンでは5枚揃うのでAは正当なアウツ
    expect(aceOuts.length).toBeGreaterThan(0);
    expect(aceOuts[0].handName).toBe('ストレート');
  });

  it('ターンでストレートのアウツが正しく検出される', () => {
    // ボード: 4♣ K♥ 7♦ 2♠  ハンド: 8♦ 3♦ 5♦ 6♣
    const holeCards = [c('8d'), c('3d'), c('5d'), c('6c')];
    const community = [c('4c'), c('Kh'), c('7d'), c('2s')];
    const currentHandRank = 1;

    const outs = findOutCards(holeCards, community, currentHandRank);
    const outRanks = new Set(outs.map(o => o.card.rank));

    expect(outRanks.has('3')).toBe(true);
    expect(outRanks.has('5')).toBe(true);
    expect(outRanks.has('6')).toBe(true);
    expect(outRanks.has('8')).toBe(true);
  });

  it('各アウツカードに正しい役名が付与される', () => {
    // ボード: 4♣ K♥ 7♦ 9♠  ハンド: 8♦ 3♦ 5♦ 6♣
    // 5,6 + 7,8,9 → 5-6-7-8-9 ストレート
    const holeCards = [c('8d'), c('3d'), c('5d'), c('6c')];
    const community = [c('4c'), c('Kh'), c('7d'), c('9s')];
    const currentHandRank = 1;

    const outs = findOutCards(holeCards, community, currentHandRank);

    // 5を引いた場合 → 5-6-7-8-9 ストレート
    const fiveOuts = outs.filter(o => o.card.rank === '5');
    expect(fiveOuts.length).toBeGreaterThan(0);
    expect(fiveOuts[0].handName).toBe('ストレート');
  });
});
