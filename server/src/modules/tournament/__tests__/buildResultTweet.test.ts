import { describe, it, expect } from 'vitest';
import {
  buildResultTweet,
  buildWinnerComment,
  buildPlacementLines,
  parseEffectiveBB,
  parseDoubleBoardHand,
  observeFinalHand,
  estimateTweetWeight,
} from '../tweet/buildResultTweet.js';
import type {
  TournamentTweetData,
  TweetHand,
  TweetHandPlayer,
} from '../tweet/types.js';

const WINNER_ID = 'user-winner';

function makePlayer(overrides: Partial<TweetHandPlayer> = {}): TweetHandPlayer {
  return {
    userId: 'user-x',
    displayName: 'X',
    seatPosition: 0,
    startChips: 100000,
    profit: 0,
    finalHand: null,
    isWinnerOfTournament: false,
    ...overrides,
  };
}

function makeHand(overrides: Partial<TweetHand> = {}): TweetHand {
  return {
    handNumber: 1,
    createdAt: '2026-06-10T12:00:00.000Z',
    blinds: '30000/60000/60000',
    communityCards: ['As', 'Kd', '7h', '2c', '9s'],
    potSize: 1020000, // 17BB (実質BB 60000)
    winnerUserIds: [WINNER_ID],
    winnerNames: ['ゆたちん'],
    players: [
      makePlayer({
        userId: WINNER_ID,
        displayName: 'ゆたちん',
        finalHand: 'Aフラッシュ',
        isWinnerOfTournament: true,
      }),
      makePlayer({ userId: 'user-2', displayName: 'ikeda' }),
    ],
    actions: [],
    ...overrides,
  };
}

function makeData(overrides: Partial<TournamentTweetData> = {}): TournamentTweetData {
  return {
    tournament: {
      id: 't-1',
      name: 'BabyPLO Blue Monday 6/9',
      status: 'COMPLETED',
      buyIn: 10000,
      startedAt: '2026-06-09T12:00:00.000Z',
      completedAt: '2026-06-09T14:30:00.000Z',
      totalEntries: 37,
      uniqueRegistrations: 25,
      totalReentries: 12,
    },
    winner: { userId: WINNER_ID, displayName: 'ゆたちん', prize: 100000, reentries: 1 },
    topResults: [
      { position: 1, userId: WINNER_ID, displayName: 'ゆたちん', prize: 100000, reentries: 1 },
      { position: 2, userId: 'user-2', displayName: 'ikeda', prize: 60000, reentries: 0 },
      { position: 3, userId: 'user-3', displayName: 'tsufaana', prize: 40000, reentries: 2 },
      { position: 4, userId: 'user-4', displayName: 'かずハイボール', prize: 20000, reentries: 0 },
      { position: 5, userId: 'user-5', displayName: 'IOwOI9', prize: 0, reentries: 0 },
      { position: 6, userId: 'user-6', displayName: 'だれか', prize: 0, reentries: 1 },
    ],
    lastHands: [makeHand()],
    ...overrides,
  };
}

describe('parseEffectiveBB', () => {
  it('SB/BB 形式は BB を返す', () => {
    expect(parseEffectiveBB('300/600')).toBe(600);
  });

  it('BBアンティ形式 "0/0/60000" は 60000 を返す', () => {
    expect(parseEffectiveBB('0/0/60000')).toBe(60000);
  });

  it('SB/BB/アンティ形式は BB とアンティの大きい方を返す', () => {
    expect(parseEffectiveBB('30000/60000/60000')).toBe(60000);
  });

  it('不正な文字列は 0 を返す', () => {
    expect(parseEffectiveBB('')).toBe(0);
    expect(parseEffectiveBB('abc')).toBe(0);
  });
});

describe('parseDoubleBoardHand', () => {
  it('ダブルボード形式を分解する', () => {
    expect(parseDoubleBoardHand('B1: 7フラッシュ / B2: Kストレート')).toEqual({
      board1: '7フラッシュ',
      board2: 'Kストレート',
    });
  });

  it('シングルボードは null', () => {
    expect(parseDoubleBoardHand('Aフラッシュ')).toBeNull();
  });
});

describe('observeFinalHand', () => {
  it('優勝者が最終ハンドを取った場合、役と BB 換算ポットを観察する', () => {
    const obs = observeFinalHand(makeHand(), WINNER_ID);
    expect(obs.winnerWonPot).toBe(true);
    expect(obs.handName).toBe('Aフラッシュ');
    expect(obs.doubleBoard).toBeNull();
    expect(obs.isScoop).toBe(false);
    expect(obs.potBB).toBe(17);
  });

  it('ダブルボードで両面取りならスクープ', () => {
    const hand = makeHand({
      players: [
        makePlayer({
          userId: WINNER_ID,
          displayName: 'ゆたちん',
          finalHand: 'B1: 7フラッシュ / B2: Kストレート',
          isWinnerOfTournament: true,
        }),
        makePlayer({ userId: 'user-2' }),
      ],
    });
    const obs = observeFinalHand(hand, WINNER_ID);
    expect(obs.isScoop).toBe(true);
    expect(obs.doubleBoard).toEqual({ board1: '7フラッシュ', board2: 'Kストレート' });
    expect(obs.handName).toBeNull();
  });

  it('ダブルボードでもチョップ（勝者複数）ならスクープではない', () => {
    const hand = makeHand({
      winnerUserIds: [WINNER_ID, 'user-2'],
      players: [
        makePlayer({
          userId: WINNER_ID,
          finalHand: 'B1: 7フラッシュ / B2: Kストレート',
          isWinnerOfTournament: true,
        }),
        makePlayer({ userId: 'user-2', finalHand: 'B1: Aハイ / B2: Kストレート' }),
      ],
    });
    expect(observeFinalHand(hand, WINNER_ID).isScoop).toBe(false);
  });
});

describe('buildWinnerComment', () => {
  it('最終ハンドの役と BB 換算ポットに触れる', () => {
    const comment = buildWinnerComment(makeData());
    expect(comment).toContain('Aフラッシュ');
    expect(comment).toContain('約17BBのポット');
    expect(comment).not.toContain('スクープ');
  });

  it('スクープ時は両ボードの役とスクープに触れる', () => {
    const data = makeData({
      lastHands: [
        makeHand({
          players: [
            makePlayer({
              userId: WINNER_ID,
              finalHand: 'B1: 7フラッシュ / B2: Kストレート',
              isWinnerOfTournament: true,
            }),
            makePlayer({ userId: 'user-2' }),
          ],
        }),
      ],
    });
    const comment = buildWinnerComment(data);
    expect(comment).toContain('7フラッシュ');
    expect(comment).toContain('Kストレート');
    expect(comment).toContain('スクープ');
  });

  it('ショーダウンなし（役不明）でもポット獲得ならフォールバックしない情報を出さず安全な文になる', () => {
    const data = makeData({
      lastHands: [
        makeHand({
          players: [
            makePlayer({ userId: WINNER_ID, finalHand: null, isWinnerOfTournament: true }),
            makePlayer({ userId: 'user-2' }),
          ],
        }),
      ],
    });
    const comment = buildWinnerComment(data);
    expect(comment).toContain('トップフィニッシュ');
  });

  it('lastHands が空でも汎用コメントを返す', () => {
    const comment = buildWinnerComment(makeData({ lastHands: [] }));
    expect(comment).toContain('トップフィニッシュ');
  });

  it('終盤に勝ちまくっていれば勢いに触れる', () => {
    const hands = Array.from({ length: 6 }, (_, i) =>
      makeHand({ handNumber: i + 1 }),
    );
    const comment = buildWinnerComment(makeData({ lastHands: hands }));
    expect(comment).toContain('圧倒的な勢い');
  });

  it('生のカード名・生のチップ数を含まない', () => {
    const comment = buildWinnerComment(makeData());
    expect(comment).not.toMatch(/[AKQJT2-9][shdc]/); // カード表記
    expect(comment).not.toContain('1020000'); // 生のポット額
  });
});

describe('buildPlacementLines', () => {
  it('prize > 0 の人数だけ列挙する（5位固定ではない）', () => {
    const lines = buildPlacementLines(makeData());
    expect(lines).toEqual([
      '1位　ゆたちん さん',
      '2位　ikeda さん',
      '3位　tsufaana さん',
      '4位　かずハイボール さん',
    ]);
  });
});

describe('buildResultTweet', () => {
  it('スキルのフォーマット骨格に従った全文を生成する', () => {
    const text = buildResultTweet(makeData());
    expect(text).toContain('【BabyPLO Blue Monday 6/9】');
    expect(text).toContain('1位　ゆたちん さん');
    expect(text).toContain('🥇ゆたちん さん');
    expect(text).toContain('🏆\nおめでとうございます！');
    expect(text).toContain('本日は37エントリー（参加者25名）！');
    expect(text).toContain('参加者のみなさんありがとうございました🙇‍♂️');
    expect(text.trimEnd().endsWith('#BabyPLO')).toBe(true);
  });

  it('リエントリーに触れない', () => {
    const text = buildResultTweet(makeData());
    expect(text).not.toContain('リエントリー');
  });

  it('entriesLead で前置きを差し替えられる', () => {
    const text = buildResultTweet(makeData(), { entriesLead: '休みの中' });
    expect(text).toContain('休みの中37エントリー（参加者25名）！');
  });

  it('winnerComment で優勝者コメントを差し替えられる', () => {
    const text = buildResultTweet(makeData(), { winnerComment: '見事な優勝でした' });
    expect(text).toContain('見事な優勝でした🏆');
  });

  it('winner が null ならエラー', () => {
    expect(() => buildResultTweet(makeData({ winner: null }))).toThrow();
  });
});

describe('estimateTweetWeight', () => {
  it('半角は1、日本語は2でカウントする', () => {
    expect(estimateTweetWeight('abc')).toBe(3);
    expect(estimateTweetWeight('あいう')).toBe(6);
  });
});
