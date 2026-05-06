import { describe, it, expect } from 'vitest';
import { createInitialGameState, startNewHand } from '../gameEngine.js';
import { evaluatePLOHand, evaluateCurrentHand, compareHands } from '../handEvaluator.js';
import type { Card } from '../types.js';
import { evaluatePreflopPLO5 } from '../ai/preflopEvaluatorPLO5.js';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('PLO5: gameEngine.startNewHand', () => {
  it('variant=plo5 で各プレイヤーに 5 枚のホールカードが配られる', () => {
    const state = createInitialGameState();
    state.variant = 'plo5';
    const newState = startNewHand(state);
    for (const p of newState.players) {
      if (p.isSittingOut) continue;
      expect(p.holeCards).toHaveLength(5);
    }
  });

  it('variant=plo5 で 6 人 × 5 枚 = 30 枚がデッキから配られる', () => {
    const state = createInitialGameState();
    state.variant = 'plo5';
    const newState = startNewHand(state);
    // 52 - 30 = 22 枚残り
    expect(newState.deck).toHaveLength(22);
  });

  it('variant=plo (デフォルト) は引き続き 4 枚配り (回帰チェック)', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);
    for (const p of newState.players) {
      expect(p.holeCards).toHaveLength(4);
    }
    expect(newState.deck).toHaveLength(28);
  });
});

describe('PLO5: evaluatePLOHand (5 枚ホール)', () => {
  it('5 枚ホール × 5 枚ボードでフルハウスを正しく検出する', () => {
    // ホール: AA + KKQ
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c'), card('Q','s')];
    // ボード: AcKsKd で AAA+KK のフルハウスが組める (ホール AhAd + ボード AcKsKd)
    const board = [card('A','c'), card('K','s'), card('K','d'), card('Q','h'), card('J','h')];
    const result = evaluatePLOHand(hole, board);
    // ベスト: AAA / KK のフルハウス (rank=7)
    expect(result.rank).toBeGreaterThanOrEqual(7);
  });

  it('5 枚ホールで 100 通り (C(5,2)*C(5,3)) の組合せが評価され、ベストが選ばれる', () => {
    // ホール: 4枚は弱、1枚だけが強 (Ah)
    const hole = [card('2','c'), card('3','d'), card('4','s'), card('5','h'), card('A','h')];
    // ボード: AAA でクワッズ完成 (Ah + ボード3枚のA で 4 of a kind)
    const board = [card('A','c'), card('A','d'), card('A','s'), card('7','d'), card('2','h')];
    const result = evaluatePLOHand(hole, board);
    // 必ずホール 2 枚を使うルールなので、Ah を含む 2 枚 + ボード 3 枚 = AAAA + kicker のフォーカード
    expect(result.rank).toBe(8);  // フォーカード
  });

  it('4 枚ホールで動作することを引き続き保証 (回帰チェック)', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c')];
    // ボードにペアがあって AAA+KK が組めるケース
    const board = [card('A','c'), card('K','s'), card('K','d'), card('Q','h'), card('J','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBeGreaterThanOrEqual(7);  // フルハウス以上
  });

  it('3 枚ホールはエラー', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h')];
    const board = [card('5','c'), card('5','d'), card('5','h'), card('7','d'), card('2','c')];
    expect(() => evaluatePLOHand(hole, board)).toThrow();
  });

  it('6 枚ホールはエラー', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c'), card('Q','s'), card('J','d')];
    const board = [card('5','c'), card('5','d'), card('5','h'), card('7','d'), card('2','c')];
    expect(() => evaluatePLOHand(hole, board)).toThrow();
  });
});

describe('PLO5: evaluateCurrentHand (フロップ・ターン)', () => {
  it('5 枚ホール × 3 枚ボード (フロップ) で評価できる', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c'), card('Q','s')];
    // ボード AcKdKs: ホール AhAd + ボード3枚 で AAA+KK のフルハウス
    const board = [card('A','c'), card('K','d'), card('K','s')];
    const result = evaluateCurrentHand(hole, board);
    expect(result).not.toBeNull();
    expect(result!.rank).toBeGreaterThanOrEqual(7);
  });
});

describe('PLO5: evaluatePreflopPLO5', () => {
  it('5 枚以外は score=0 を返す', () => {
    const result = evaluatePreflopPLO5([card('A','h'), card('A','d'), card('K','h'), card('K','c')]);
    expect(result.score).toBe(0);
  });

  it('AAKKQ ds 級の強ハンドは高スコア (>= 0.6)', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','d'), card('Q','c')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.hasPair).toBe(true);
    expect(result.pairRank).toBe('A');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('ガベージ (2c 5d 8s Jh 4c) は強ハンドより低スコア', () => {
    const garbage = evaluatePreflopPLO5([card('2','c'), card('5','d'), card('8','s'), card('J','h'), card('4','c')]);
    const premium = evaluatePreflopPLO5([card('A','h'), card('A','d'), card('K','h'), card('K','d'), card('Q','c')]);
    expect(garbage.score).toBeLessThan(premium.score);
  });

  it('5 枚ランダウン (T9876) は isRundown=true', () => {
    const hole = [card('T','h'), card('9','d'), card('8','c'), card('7','s'), card('6','h')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.isRundown).toBe(true);
  });

  it('ダブルスーテッド (♠♠♥♥x) は isDoubleSuited=true', () => {
    const hole = [card('A','s'), card('K','s'), card('Q','h'), card('J','h'), card('5','c')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.isDoubleSuited).toBe(true);
  });

  it('ダングラー検出 (AAKK + 2)', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','d'), card('2','c')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.hasDangler).toBe(true);
  });

  it('スコアは 0〜1 の範囲に収まる', () => {
    const hands: Card[][] = [
      [card('A','s'), card('A','h'), card('A','d'), card('A','c'), card('K','s')],  // AAAA + K
      [card('2','c'), card('3','d'), card('4','s'), card('5','h'), card('6','c')],  // low rundown
      [card('K','d'), card('K','c'), card('K','s'), card('Q','h'), card('Q','d')],  // KKKQQ
    ];
    for (const hole of hands) {
      const result = evaluatePreflopPLO5(hole);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('PLO5: 全役の判定 (rank 1〜9)', () => {
  it('ロイヤルフラッシュ: AhKh ホール + QhJhTh ボード', () => {
    const hole = [card('A','h'), card('K','h'), card('2','c'), card('3','d'), card('4','s')];
    const board = [card('Q','h'), card('J','h'), card('T','h'), card('5','c'), card('6','d')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(9);
    expect(result.highCards[0]).toBe(14); // A-high straight flush
  });

  it('ストレートフラッシュ: 9-K of hearts', () => {
    const hole = [card('K','h'), card('Q','h'), card('2','c'), card('3','d'), card('4','s')];
    const board = [card('J','h'), card('T','h'), card('9','h'), card('5','c'), card('6','d')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(9);
    expect(result.highCards[0]).toBe(13); // K-high straight flush
  });

  it('ホイールストレートフラッシュ (steel wheel): A-2-3-4-5 of hearts', () => {
    const hole = [card('A','h'), card('2','h'), card('K','c'), card('Q','d'), card('J','s')];
    const board = [card('3','h'), card('4','h'), card('5','h'), card('9','c'), card('T','d')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(9);
    expect(result.highCards[0]).toBe(5); // wheel high = 5
  });

  it('フォーカード: ホールAA + ボードAA でクワッズ', () => {
    const hole = [card('A','h'), card('A','d'), card('K','c'), card('Q','d'), card('J','s')];
    const board = [card('A','c'), card('A','s'), card('5','d'), card('7','c'), card('9','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(8);
    expect(result.highCards[0]).toBe(14); // quad Aces
  });

  it('フルハウス: AAA-KK', () => {
    const hole = [card('A','h'), card('A','d'), card('K','c'), card('Q','d'), card('J','s')];
    const board = [card('A','c'), card('K','d'), card('K','s'), card('5','c'), card('9','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(7);
    expect(result.highCards[0]).toBe(14); // trips of A
    expect(result.highCards[1]).toBe(13); // pair of K
  });

  it('フラッシュ: A-high スペード', () => {
    const hole = [card('A','s'), card('K','s'), card('2','c'), card('3','d'), card('4','h')];
    const board = [card('Q','s'), card('J','s'), card('5','s'), card('7','c'), card('9','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(6);
    expect(result.highCards).toEqual([14, 13, 12, 11, 5]);
    // 表示名はホール由来最高ランク (A♠) を採用
    expect(result.name).toBe('Aフラッシュ');
  });

  it('フラッシュ表示名: ボードに高スート札があってもホール由来最高ランクで表示する', () => {
    // 回帰テスト: 以前は 5 枚最高 (ボード由来 A) で "Aフラッシュ" と表示されていた。
    // PLO はホール 2 枚必須なので勝敗は実質ホール由来ランクで決まる → ホール最高で表示する。
    const hole = [card('J','s'), card('T','s'), card('2','c'), card('3','d'), card('4','h')];
    const board = [card('A','s'), card('K','s'), card('5','s'), card('7','c'), card('9','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(6);
    // 判定用 highCards は 5 枚降順のまま（compareHands に影響しない）
    expect(result.highCards).toEqual([14, 13, 11, 10, 5]);
    // 表示名はホール由来最高 (J♠) ベース
    expect(result.name).toBe('Jフラッシュ');
  });

  it('ストレート: 9-K (T以下キッカーなし)', () => {
    const hole = [card('K','h'), card('Q','d'), card('2','c'), card('3','d'), card('4','s')];
    const board = [card('J','c'), card('T','d'), card('9','h'), card('5','c'), card('7','d')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(5);
    expect(result.highCards[0]).toBe(13); // K-high
  });

  it('ホイールストレート: A-2-3-4-5', () => {
    const hole = [card('A','h'), card('2','d'), card('K','c'), card('Q','d'), card('J','s')];
    const board = [card('3','c'), card('4','d'), card('5','h'), card('9','c'), card('T','d')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(5);
    expect(result.highCards[0]).toBe(5); // wheel high = 5
  });

  it('スリーカード: トリップス A', () => {
    const hole = [card('A','h'), card('A','d'), card('5','c'), card('7','d'), card('9','s')];
    const board = [card('A','c'), card('K','d'), card('Q','c'), card('J','d'), card('2','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(4);
    expect(result.highCards[0]).toBe(14); // trips of A
    expect(result.highCards[1]).toBe(13); // K kicker
    expect(result.highCards[2]).toBe(12); // Q kicker
  });

  it('ツーペア: AA-KK', () => {
    const hole = [card('A','h'), card('K','d'), card('5','c'), card('7','d'), card('9','s')];
    const board = [card('A','c'), card('K','c'), card('Q','d'), card('J','h'), card('2','c')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(3);
    expect(result.highCards[0]).toBe(14); // pair of A
    expect(result.highCards[1]).toBe(13); // pair of K
    expect(result.highCards[2]).toBe(12); // Q kicker
  });

  it('ワンペア: AA', () => {
    const hole = [card('A','h'), card('K','d'), card('5','c'), card('7','d'), card('9','s')];
    const board = [card('A','c'), card('Q','d'), card('J','h'), card('8','c'), card('2','d')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(2);
    expect(result.highCards[0]).toBe(14); // pair of A
    expect(result.highCards.slice(1, 4)).toEqual([13, 12, 11]); // K Q J kickers
  });

  it('ハイカード: A-K-Q-J-8', () => {
    const hole = [card('A','h'), card('K','d'), card('5','c'), card('7','d'), card('9','s')];
    const board = [card('Q','d'), card('J','h'), card('8','c'), card('2','d'), card('3','c')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(1);
    expect(result.highCards[0]).toBe(14);
    expect(result.highCards[1]).toBe(13);
  });
});

describe('PLO5: 「ホール2枚必須」ルールの厳守', () => {
  it('ボード AAAA でもホールにAがなければクワッズにならず、ホールのペアでフルハウス', () => {
    // ホールにAなし、22あり。ボードはAAAA。
    const hole = [card('2','c'), card('2','d'), card('3','s'), card('4','h'), card('5','d')];
    const board = [card('A','c'), card('A','d'), card('A','s'), card('A','h'), card('Q','c')];
    const result = evaluatePLOHand(hole, board);
    // ホール2枚=22 + ボード3枚=AAA → AAA22 フルハウス
    expect(result.rank).toBe(7);
    expect(result.highCards[0]).toBe(14); // Aces full
    expect(result.highCards[1]).toBe(2);  // of 2s
  });

  it('ボード5枚同スートでもホールに同スート1枚しかなければフラッシュにならない', () => {
    // ホールにハート1枚 (Ah) のみ。ボードは全てハート。
    const hole = [card('A','h'), card('2','c'), card('3','c'), card('4','c'), card('5','c')];
    const board = [card('K','h'), card('Q','h'), card('J','h'), card('T','h'), card('9','h')];
    const result = evaluatePLOHand(hole, board);
    // 5-card ハンドにハートは最大4枚 → フラッシュ不可
    // ストレートも不可 (A-K-Q-J-T はホール2+ボード3制約で組めない)
    // ベスト: ハイカード A-K-Q-J-5
    expect(result.rank).toBe(1);
    expect(result.highCards).toEqual([14, 13, 12, 11, 5]);
  });

  it('ボードで6-highストレート完成 (2-3-4-5-6) でもホール内に該当2枚なければストレートにならない', () => {
    // ボード5枚で 2-3-4-5-6 のストレートが完成しているが、ホール側にはストレートに使える低い数字なし
    const hole = [card('A','h'), card('K','d'), card('Q','c'), card('J','s'), card('T','h')];
    const board = [card('2','c'), card('3','d'), card('4','s'), card('5','h'), card('6','c')];
    const result = evaluatePLOHand(hole, board);
    // ホール2枚=A,K,Q,J,Tから2枚 (どれも 7-K straight には使えない、A-K-Q-J-T は5枚必要なので不可)
    // ベスト: ハイカード A-K + ボードからベスト3 (6,5,4) → A-K-6-5-4
    expect(result.rank).toBe(1);
    expect(result.highCards).toEqual([14, 13, 6, 5, 4]);
  });

  it('ボード QQQ でもホールにQ・ペアなしならスリーカードかワンペア (フルハウスではない)', () => {
    // ボードにトリップスQ。ホールはハイカードのみ・ペアなし。
    const hole = [card('A','h'), card('K','d'), card('5','c'), card('7','d'), card('9','s')];
    const board = [card('Q','c'), card('Q','d'), card('Q','s'), card('J','h'), card('2','c')];
    const result = evaluatePLOHand(hole, board);
    // ホール2=AhKd + ボード3=QQQ → QQQ + AK = スリーカードQ
    expect(result.rank).toBe(4);
    expect(result.highCards[0]).toBe(12); // trips of Q
    expect(result.highCards[1]).toBe(14); // A kicker
    expect(result.highCards[2]).toBe(13); // K kicker
  });

  it('ボードに4ハート + ホールに1ハート → フラッシュ不可', () => {
    // 古典的な「4 to a flush」誤判定回帰テスト。
    // ストレートも組めない構成にして、フラッシュ判定の正誤だけを切り分ける。
    const hole = [card('A','h'), card('K','c'), card('Q','d'), card('J','s'), card('T','d')];
    const board = [card('2','h'), card('3','h'), card('4','h'), card('5','h'), card('7','d')];
    const result = evaluatePLOHand(hole, board);
    // フラッシュ: ハートはホール 1 枚 + ボード 4 枚 → 5-card 中最大 4 枚しかハートにできない → 不可。
    // ストレート:
    //   - A-K-Q-J-T: 全てホール → ホール 2 枚制約で不可。
    //   - ホイール A-2-3-4-5: ホールに A しかない (2,3,4,5 はボードのみ) → 不可。
    //   - その他 6 や 8 を含むストレート: 6・8 がどこにも無い → 不可。
    // よって high card。ベストは hole2={Ah,Kc} + board3={7d,5h,4h} → A-K-7-5-4。
    expect(result.rank).toBe(1);
    expect(result.highCards).toEqual([14, 13, 7, 5, 4]);
  });
});

describe('PLO5: ハンド比較 (compareHands)', () => {
  it('上位役は下位役に勝つ (フォーカード > フルハウス > フラッシュ > ストレート > スリーカード)', () => {
    const quad   = { rank: 8, name: 'フォーカード',   highCards: [2, 14] };
    const fullH  = { rank: 7, name: 'フルハウス',     highCards: [14, 13] };
    const flush  = { rank: 6, name: 'フラッシュ',     highCards: [14, 13, 12, 11, 9] };
    const strgt  = { rank: 5, name: 'ストレート',     highCards: [13] };
    const trips  = { rank: 4, name: 'スリーカード',   highCards: [14, 13, 12] };
    expect(compareHands(quad,  fullH)).toBeGreaterThan(0);
    expect(compareHands(fullH, flush)).toBeGreaterThan(0);
    expect(compareHands(flush, strgt)).toBeGreaterThan(0);
    expect(compareHands(strgt, trips)).toBeGreaterThan(0);
  });

  it('フルハウスはトリップスのランクで優先比較される (KKK-22 > 222-AA)', () => {
    const kkk22 = { rank: 7, name: 'フルハウス', highCards: [13, 2] };
    const ttt_aa = { rank: 7, name: 'フルハウス', highCards: [2, 14] };
    expect(compareHands(kkk22, ttt_aa)).toBeGreaterThan(0);
  });

  it('A-high フラッシュ > K-high フラッシュ', () => {
    const aFlush = { rank: 6, name: 'フラッシュ', highCards: [14, 12, 9, 5, 3] };
    const kFlush = { rank: 6, name: 'フラッシュ', highCards: [13, 12, 11, 10, 9] };
    expect(compareHands(aFlush, kFlush)).toBeGreaterThan(0);
  });

  it('6-high ストレート > ホイール (5-high)', () => {
    const sixHigh = { rank: 5, name: 'ストレート', highCards: [6] };
    const wheel   = { rank: 5, name: 'ストレート', highCards: [5] };
    expect(compareHands(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('同一ハンドは 0 を返す', () => {
    const a = { rank: 6, name: 'フラッシュ', highCards: [14, 13, 12, 11, 9] };
    const b = { rank: 6, name: 'フラッシュ', highCards: [14, 13, 12, 11, 9] };
    expect(compareHands(a, b)).toBe(0);
  });
});

describe('PLO5: ターン (4枚コミュニティ) 評価', () => {
  it('5 枚ホール × 4 枚ボードでも C(5,2)*C(4,3)=40 通りからベストが選ばれる', () => {
    // ボード4枚 (ターン)。ホール+ボードで AAA-KK のフルハウスが成立。
    const hole = [card('A','h'), card('A','d'), card('K','c'), card('5','d'), card('7','s')];
    const board = [card('A','c'), card('K','d'), card('K','s'), card('2','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBe(7);
    expect(result.highCards[0]).toBe(14);
    expect(result.highCards[1]).toBe(13);
  });

  it('evaluateCurrentHand: ターン (4枚コミュニティ) でも評価できる', () => {
    const hole = [card('A','h'), card('A','d'), card('K','c'), card('Q','d'), card('J','s')];
    const board = [card('A','c'), card('K','d'), card('K','s'), card('2','h')];
    const result = evaluateCurrentHand(hole, board);
    expect(result).not.toBeNull();
    expect(result!.rank).toBe(7); // フルハウス AAA-KK
  });
});
