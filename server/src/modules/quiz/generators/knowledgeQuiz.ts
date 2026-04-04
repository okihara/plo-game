/**
 * PLO知識問題のテンプレート集。
 * ランダムに選出して出題する。
 */
import type { Quiz } from '../types.js';

interface KnowledgeTemplate {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

const TEMPLATES: KnowledgeTemplate[] = [
  // --- ルール系 ---
  {
    question: 'PLOでホールカードは何枚配られる？',
    choices: ['2枚', '3枚', '4枚', '5枚'],
    correctIndex: 2,
    explanation: 'PLO（Pot Limit Omaha）では各プレイヤーに4枚のホールカードが配られます。テキサスホールデムの2枚と比べて手の可能性が大幅に広がります。',
  },
  {
    question: 'PLOのショーダウンで使うホールカードの枚数は？',
    choices: ['好きな枚数', 'ちょうど2枚', 'ちょうど3枚', '1枚以上'],
    correctIndex: 1,
    explanation: 'PLOでは必ずホールカードからちょうど2枚、ボードからちょうど3枚を使って5枚の役を作ります。これがホールデムとの大きな違いです。',
  },
  {
    question: 'ポットリミットの最大レイズ額の計算で正しいのは？',
    choices: ['ポットの半分', 'ポットと同額', 'ポットの2倍', '制限なし'],
    correctIndex: 1,
    explanation: 'ポットリミットでは、最大レイズ額 = 現在のポット + 相手のベットをコールした後の額です。実質的にポットサイズのレイズが可能です。',
  },
  {
    question: 'PLOでボード上に4枚のスペードが出ている。手札に A♠ 1枚だけ持っている場合、フラッシュは成立する？',
    choices: ['成立する', '成立しない', 'Aなら特別に成立', 'ディーラー判断'],
    correctIndex: 1,
    explanation: 'PLOではホールカードから必ず2枚使うルールのため、手札にスペード1枚だけではフラッシュは成立しません。2枚のスペードが必要です。',
  },
  {
    question: 'PLOでボードが 5-6-7-8-9 のストレートボード。手札にストレートのカードが1枚もなくても勝てる？',
    choices: ['ボードのストレートで勝てる', '手札から2枚使わないと無理', '手札が強ければ例外', '自動的にチョップ'],
    correctIndex: 1,
    explanation: 'PLOでは必ず手札から2枚を使います。ボード上にストレートが完成していても、手札から2枚 + ボード3枚で役を作る必要があります。',
  },

  // --- 戦略系 ---
  {
    question: 'PLOで「ラップドロー」とは何？',
    choices: [
      'フラッシュ+ストレートの複合ドロー',
      'コミュニティカードを包み込む形のストレートドロー',
      'ポットの全額ベット',
      'ナッツを持っている状態',
    ],
    correctIndex: 1,
    explanation: 'ラップドローは、コミュニティカードの連続した数字を「包み込む（wrap）」形のストレートドロー。例: 手札 5-6-8-9 でボード 7-x-x なら、4/5/6/8/9/10 の多くがアウツになる非常に強力なドローです。',
  },
  {
    question: 'PLOでプリフロップに最も強いハンドは？',
    choices: ['A♠A♥K♠K♥', 'A♠A♥A♦K♠', 'K♠K♥Q♠Q♥', 'A♠K♠Q♠J♠'],
    correctIndex: 0,
    explanation: 'AAKKダブルスーテッドはPLOプリフロップで最強のハンド。AAの強さに加え、KKのバックアップとダブルスーテッドによるフラッシュ可能性を兼ね備えます。',
  },
  {
    question: '「ダブルスーテッド」とはどういう意味？',
    choices: [
      '同じスートが4枚',
      '2組のスーテッドペアを持つ',
      'ボードに同スートが2枚',
      'フラッシュが2つ完成',
    ],
    correctIndex: 1,
    explanation: 'ダブルスーテッドとは、4枚のホールカードが2種類のスートに分かれていること（例: A♠K♠Q♥J♥）。2つのフラッシュドローの可能性があり、ハンドの価値が大きく上がります。',
  },
  {
    question: 'PLOでの「ダングラー」とは？',
    choices: [
      '高いキッカー',
      '他の3枚と連携しない孤立したカード',
      'フラッシュドローのカード',
      'ペアになっているカード',
    ],
    correctIndex: 1,
    explanation: 'ダングラーとは、他の3枚のカードとシナジーがない孤立したカード。例: A♠K♠Q♥3♦ の 3♦。ダングラーがあるとハンドの価値が下がります。',
  },
  {
    question: 'PLOのポストフロップで一般的にどちらのドローが強い？',
    choices: [
      'ナッツフラッシュドロー',
      '13アウツのラップドロー',
      'どちらも同じ',
      '状況によるがラップの方が多い',
    ],
    correctIndex: 3,
    explanation: 'ラップドローはアウツが13枚以上になることもあり、ナッツフラッシュドロー（9アウツ）より多い場合があります。ただしフラッシュはナッツ性が高いため、状況次第です。',
  },
  {
    question: 'PLOでAAAKを配られた。このハンドの問題点は？',
    choices: [
      'Aが強すぎてレイズを受けない',
      'Aが3枚でアウツが減っている',
      '問題ない、最強クラスのハンド',
      'ストレートが作れない',
    ],
    correctIndex: 1,
    explanation: 'A3枚は一見強そうですが、セットのアウツが通常より少なく（1枚しか残っていない）、フラッシュドローの可能性も制限されます。AAKKやAAJTの方が遥かに強いです。',
  },
  {
    question: 'PLOでフロップ後のポジションとして最も有利なのは？',
    choices: ['SB（スモールブラインド）', 'BB（ビッグブラインド）', 'UTG（アンダーザガン）', 'BTN（ボタン）'],
    correctIndex: 3,
    explanation: 'BTN（ボタン）は全ストリートで最後にアクションできるため、最も情報優位があります。相手の行動を見てから判断できることがPLOでは特に大きなアドバンテージです。',
  },
  {
    question: 'PLOでセット（スリーカード）を持っているとき、最も警戒すべきドローは？',
    choices: ['フラッシュドロー', 'ストレートドロー', 'フルハウスドロー', 'ラップドロー'],
    correctIndex: 3,
    explanation: 'PLOではラップドローのアウツが非常に多く（最大20枚）、セットよりもエクイティが高い場合があります。モノトーンボードでなければ、ラップドローが最大の脅威です。',
  },
  {
    question: 'PLOの「ブロッカー」とは何？',
    choices: [
      '相手のベットをブロックする戦略',
      '相手が特定の手を持つ可能性を減らすカード',
      '防御的なプレイスタイル',
      'ポットリミットの制限',
    ],
    correctIndex: 1,
    explanation: 'ブロッカーとは、自分が持っているカードによって相手がそのカードを使った役を作る可能性が下がること。例: A♠を持っていれば、相手がナッツフラッシュを持つ可能性が0になります。',
  },
  {
    question: 'PLOで「ランダウン」ハンドとは？',
    choices: [
      '全て同じスートの4枚',
      '連続した4枚の数字 (例: 5-6-7-8)',
      '2つのペア (例: KK77)',
      'Aを含む4枚',
    ],
    correctIndex: 1,
    explanation: 'ランダウンは 5-6-7-8 のように4枚が連続した数字のハンド。ストレートのドローが非常に多く、PLOでは強力なハンドタイプです。',
  },

  // --- エクイティ・計算系 ---
  {
    question: 'PLOのプリフロップでAAxxとランダムハンドのエクイティ差は約何%？',
    choices: ['約65% vs 35%', '約80% vs 20%', '約55% vs 45%', '約90% vs 10%'],
    correctIndex: 0,
    explanation: 'PLOではホールデムと違い、AAでもランダムハンドに対して約65%程度のエクイティしかありません。4枚のカードから多くの組み合わせが生まれるため、プリフロップの支配力はホールデムより低いです。',
  },
  {
    question: '「4ベット」とは何？',
    choices: [
      '4回連続でベットすること',
      'ポットの4倍のベット',
      '3回目のレイズ（オープン→レイズ→リレイズ→4ベット）',
      '4人でポットを分けること',
    ],
    correctIndex: 2,
    explanation: '4ベットは、オープンレイズ(2ベット)に対する3ベットに対するリレイズ(4ベット)です。PLOでは4ベットはAAxx等の非常に強いハンドを示すことが多いです。',
  },
  {
    question: 'PLOで「SPR」（Stack-to-Pot Ratio）が低いとき、一般的にどうプレイすべき？',
    choices: [
      'ブラフを増やす',
      'ドローを追いやすい',
      'コミットしやすいのでシンプルに押す',
      'フォールドを増やす',
    ],
    correctIndex: 2,
    explanation: 'SPRが低い（スタックがポットに対して小さい）とき、多くのハンドでコミット（オールイン）しやすくなります。トップペア+ドローなどでもフロップオールインが正当化されます。',
  },
  {
    question: 'PLOのフロップで「9アウツ」のフラッシュドローがある場合、ターンで完成する確率は約何%？',
    choices: ['約10%', '約15%', '約19%', '約25%'],
    correctIndex: 2,
    explanation: '残り45枚のデッキから9枚がフラッシュを完成させるので、9/45 = 20%。実際には相手の手札を考慮すると約19%程度です。',
  },
  {
    question: '「エクイティ」と「リアライズ」の違いは？',
    choices: [
      '同じ意味',
      'エクイティは理論上の勝率、リアライズは実際に実現できる勝率',
      'エクイティはプリフロップ、リアライズはポストフロップ',
      'エクイティは個人、リアライズはチーム',
    ],
    correctIndex: 1,
    explanation: 'エクイティはオールイン時の理論上の勝率。しかし実際はポストフロップのスキル差やポジションにより、エクイティの一部しか実現（リアライズ）できません。PLOではポジションによるリアライズの差が特に大きいです。',
  },

  // --- 雑学系 ---
  {
    question: 'PLOの「O」は何の略？',
    choices: ['Online', 'Omaha', 'Original', 'Open'],
    correctIndex: 1,
    explanation: 'PLOは「Pot Limit Omaha」の略。オマハはネブラスカ州の都市名に由来します。4枚ホールカードのこのゲームは、テキサスホールデムに次いで世界で2番目に人気のあるポーカーバリアントです。',
  },
  {
    question: 'PLOで最もアウツが多くなりうるドローは最大何枚？',
    choices: ['13枚', '17枚', '20枚以上', '9枚'],
    correctIndex: 2,
    explanation: 'フラッシュドロー + ラップドローが同時にある場合、20枚以上のアウツを持つことがあります。この場合、現在の手が弱くてもエクイティは50%を超えることがあります。',
  },
  {
    question: 'PLOとテキサスホールデムの最大の違いは？',
    choices: [
      'ベット制限が違う',
      'ホールカードの枚数が違い、必ず2枚使う',
      'コミュニティカードの枚数が違う',
      'ディーラーの役割が違う',
    ],
    correctIndex: 1,
    explanation: '最大の違いはホールカードが4枚配られ、必ず2枚を使うこと。コミュニティカードは同じ5枚ですが、手の組み合わせが格段に増え、ゲームの複雑さとアクション量が増します。',
  },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 知識問題を1つランダムに返す。usedQuestions で既出を除外する。 */
export function generateKnowledgeQuiz(usedQuestions?: Set<string>): Quiz {
  let pool = TEMPLATES;
  if (usedQuestions && usedQuestions.size > 0) {
    const filtered = pool.filter(t => !usedQuestions.has(t.question));
    if (filtered.length > 0) pool = filtered;
  }

  const template = shuffle(pool)[0];

  return {
    type: 'knowledge',
    question: `📚 PLOクイズ: ${template.question}`,
    choices: template.choices,
    correctIndex: template.correctIndex,
    explanation: template.explanation,
  };
}

export const KNOWLEDGE_QUIZ_COUNT = TEMPLATES.length;
