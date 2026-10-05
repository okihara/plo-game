import { describe, expect, it } from 'vitest';
import type { TournamentHandExport } from '../../history/tournamentHandsForUser.js';
import { buildHandFacts } from '../handFacts.js';

type ActionSpec = { seat: number; action: string; amount?: number; street?: string };

function hand(opts: {
  heroHole: string[];
  villainHole?: string[];
  board: string[];
  actions: ActionSpec[];
  profit?: number;
}): TournamentHandExport {
  return {
    id: 'h1',
    handNumber: 1,
    blinds: '100/200',
    communityCards: opts.board,
    communityCards2: [],
    potSize: 1000,
    rakeAmount: 0,
    winners: [],
    actions: opts.actions.map(a => ({
      seatIndex: a.seat,
      odName: `p${a.seat}`,
      action: a.action,
      amount: a.amount ?? 0,
      street: a.street ?? 'preflop',
    })),
    dealerPosition: 0,
    createdAt: new Date(2026, 0, 1),
    players: [
      {
        userId: 'me', username: 'hero', avatarUrl: null, seatPosition: 0,
        holeCards: opts.heroHole, finalHand: null, startChips: 2480, profit: opts.profit ?? 0,
        isCurrentUser: true,
      },
      {
        userId: 'v', username: 'villain', avatarUrl: null, seatPosition: 1,
        holeCards: opts.villainHole ?? [], finalHand: null, startChips: 6000, profit: 0,
        isCurrentUser: false,
      },
      {
        userId: 'w', username: 'other', avatarUrl: null, seatPosition: 2,
        holeCards: [], finalHand: null, startChips: 4000, profit: 0,
        isCurrentUser: false,
      },
    ],
  };
}

const preflopCall: ActionSpec[] = [
  { seat: 1, action: 'call', amount: 100 },
  { seat: 2, action: 'check' },
  { seat: 0, action: 'raise', amount: 600 },
];

describe('buildHandFacts', () => {
  it('PLO5 のポケットペア＋ホイールラップを正しく数える', () => {
    const facts = buildHandFacts(
      hand({ heroHole: ['Th', '3h', '2c', '3d', 'Ac'], board: ['4s', '5h', '9s'], actions: preflopCall })
    )!;
    expect(facts).toContain('フロップ [4s 5h 9s]: 3のワンペア（ホール 3h 3d');
    // ストレートになるのは 3(2枚)・6(4枚)・2(3枚)・A(3枚)
    expect(facts).toContain('次の1枚でストレート以上に改善: 12枚（ストレート 12）');
  });

  it('フロップで完成したフラッシュとナッツでないことを書く', () => {
    const facts = buildHandFacts(
      hand({ heroHole: ['Qh', 'Th', '2c', '2d'], board: ['3h', 'Kh', 'Jh'], actions: preflopCall })
    )!;
    expect(facts).toContain('Kハイのフラッシュ（ホール Qh Th');
    expect(facts).toContain('ナッツではない');
    expect(facts).toContain('フロップ [3h Kh Jh]: ナッツ Aハイのフラッシュ／ストレート作れない／フラッシュ作れる／ボードペアなし');
    // 9h・Ah でストレートフラッシュ
    expect(facts).toContain('次の1枚でストレート以上に改善: 2枚（ストレートフラッシュ 2）');
  });

  it('セットとトリップスを区別し、ショーダウンした相手の役も書く', () => {
    const facts = buildHandFacts(
      hand({
        heroHole: ['5s', '5c', 'Kd', '2h'],
        villainHole: ['9d', '8c', 'Qs', 'Qh'],
        board: ['5h', '9s', '4c', 'Jd', '2s'],
        actions: preflopCall,
        profit: 1200,
      })
    )!;
    expect(facts).toContain('5のスリーカード（セット: ホールのポケットペア使用）');
    // ナッツ（ポケット99のセット）にはセット/トリップスの区別を付けない
    expect(facts).toContain('フロップ [5h 9s 4c]: ナッツ 9のスリーカード／ストレート作れない／フラッシュ作れない');
    // 相手はホールの 9d を使えない（Qs Qh で2枚使用済み）ので Q のワンペア
    expect(facts).toContain('ショーダウン: SB villain [9d 8c Qs Qh] → Qのワンペア（ホール Qs Qh');
    expect(facts).toContain('結果: ヒーロー +6BB');
  });

  it('ポジション表記のアクション順・BB換算のスタックを書き、フォールド後の役は書かない', () => {
    const facts = buildHandFacts(
      hand({
        heroHole: ['As', 'Ks', 'Qd', 'Jd'],
        board: ['2c', '7h', '8d', '9c', 'Th'],
        actions: [
          { seat: 1, action: 'raise', amount: 600 },
          { seat: 2, action: 'call', amount: 600 },
          { seat: 0, action: 'fold' },
        ],
      })
    )!;
    expect(facts).toContain('開始スタック 12.4BB');
    expect(facts).toContain('ヒーローの最大有効スタック: 12.4BB');
    expect(facts).toMatch(/プリフロップ: \S+ raise to 3BB → \S+ call 3BB → \S+\(ヒーロー\) fold/);
    expect(facts).not.toContain('ヒーローの役');
  });

  it('ターンでストレートが作れないボードをそう書く', () => {
    // 検証で「86xx の既成ストレート」と誤ったボード
    const facts = buildHandFacts(
      hand({ heroHole: ['Ad', 'Kd', '7s', '2s'], board: ['Ah', '7c', '5d', 'Kc'], actions: preflopCall })
    )!;
    expect(facts).toContain('ターン [Ah 7c 5d Kc]: ナッツ Aのスリーカード／ストレート作れない／フラッシュ作れない');
    expect(facts).toContain('ダブルスーテッド: d2枚（Aハイ）・s2枚（7ハイ）');
  });

  it('カードが読めないハンドは null', () => {
    expect(buildHandFacts(hand({ heroHole: [], board: [], actions: [] }))).toBeNull();
  });
});
