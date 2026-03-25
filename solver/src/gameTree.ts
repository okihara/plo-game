/**
 * ステップ3: プリフロップ ゲームツリー定義 (6max PLO)
 *
 * Pot Limit Omaha のプリフロップアクションツリー。
 * ベットサイズはポットリミットなので、各アクションポイントでの選択肢は限定的。
 *
 * ポジション: UTG(0), HJ(1), CO(2), BTN(3), SB(4), BB(5)
 * ブラインド: SB=0.5bb, BB=1bb
 * ポットリミット: レイズ額 = コール額 + (コール後のポット)
 */

// --- ポジション ---

export const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = typeof POSITIONS[number];
export const NUM_PLAYERS = 6;

// プリフロップのアクション順序: UTG → HJ → CO → BTN → SB → BB → (back to UTG if raise)
// BBが最後にアクション（レイズがなければ）

// --- アクション ---

export type ActionType = 'fold' | 'call' | 'raise';

export interface Action {
  type: ActionType;
  amount: number; // raise のときのみ意味がある（トータルベット額 in bb）
}

// --- ゲームツリーノード ---

export type NodeType = 'chance' | 'player' | 'terminal';

export interface GameNode {
  type: NodeType;
  player?: number;          // player ノードのとき: 0-5 (ポジション)
  actions?: Action[];       // player ノードのとき: 可能なアクション
  children?: Map<string, GameNode>;  // actionKey → 子ノード
  pot?: number;             // terminal ノードのとき: ポット (bb)
  payoff?: number[];        // terminal ノードのとき: 各プレイヤーの損益 (bb)
  history?: string;         // このノードに至るアクション履歴
}

// --- ゲーム状態 ---

interface GameState {
  bets: number[];           // 各プレイヤーの現在のベット額 (bb)
  folded: boolean[];        // フォールド済み
  acted: boolean[];         // アクション済み（このラウンドで）
  currentPlayer: number;    // 現在のアクションプレイヤー
  numRaises: number;        // レイズ回数（キャップ用）
  history: string;          // アクション履歴文字列
}

const MAX_RAISES = 4; // 4bet まで（open, 3bet, 4bet, 5bet cap）

function initialState(): GameState {
  return {
    bets: [0, 0, 0, 0, 0.5, 1], // UTG..BTN=0, SB=0.5, BB=1
    folded: [false, false, false, false, false, false],
    acted: [false, false, false, false, false, false],
    currentPlayer: 0, // UTG first
    numRaises: 0,     // BBのポストは "レイズ" とカウントしない
    history: '',
  };
}

/**
 * Pot Limit のレイズ額を計算
 * raise_to = call_amount + (pot_after_call)
 * pot_after_call = sum(bets) + call_amount
 * call_amount = max(bets) - current_bet
 */
function potLimitRaise(state: GameState): number {
  const maxBet = Math.max(...state.bets);
  const currentBet = state.bets[state.currentPlayer];
  const callAmount = maxBet - currentBet;
  const potAfterCall = state.bets.reduce((s, b) => s + b, 0) + callAmount;
  const raiseTo = callAmount + potAfterCall;
  return raiseTo;
}

/**
 * 次のアクティブプレイヤーを返す。全員がアクション済み（またはフォールド）ならnull。
 */
function nextPlayer(state: GameState): number | null {
  const maxBet = Math.max(...state.bets);
  let pos = (state.currentPlayer + 1) % NUM_PLAYERS;

  for (let i = 0; i < NUM_PLAYERS; i++) {
    if (!state.folded[pos]) {
      // まだアクションしていない、またはベット額が最大に達していない
      if (!state.acted[pos] || state.bets[pos] < maxBet) {
        return pos;
      }
    }
    pos = (pos + 1) % NUM_PLAYERS;
  }

  return null;
}

/**
 * アクティブ（フォールドしていない）プレイヤー数
 */
function activePlayers(state: GameState): number {
  return state.folded.filter(f => !f).length;
}

/**
 * 現在の状態から可能なアクションを列挙
 */
function getActions(state: GameState): Action[] {
  const maxBet = Math.max(...state.bets);
  const currentBet = state.bets[state.currentPlayer];
  const actions: Action[] = [];

  // フォールド（ベット額が0超でフェイスしている場合のみ。BBチェック可のときはフォールド不要）
  if (maxBet > currentBet) {
    actions.push({ type: 'fold', amount: 0 });
  }

  // コール / チェック
  actions.push({ type: 'call', amount: maxBet });

  // レイズ（キャップ未満なら）
  if (state.numRaises < MAX_RAISES) {
    const raiseTo = potLimitRaise(state);
    actions.push({ type: 'raise', amount: raiseTo });
  }

  return actions;
}

function actionKey(action: Action): string {
  if (action.type === 'fold') return 'f';
  if (action.type === 'call') return 'c';
  return `r${action.amount.toFixed(1)}`;
}

/**
 * アクションを適用して新しい状態を返す
 */
function applyAction(state: GameState, action: Action): GameState {
  const s: GameState = {
    bets: [...state.bets],
    folded: [...state.folded],
    acted: [...state.acted],
    currentPlayer: state.currentPlayer,
    numRaises: state.numRaises,
    history: state.history + actionKey(action),
  };

  const p = s.currentPlayer;

  if (action.type === 'fold') {
    s.folded[p] = true;
  } else if (action.type === 'call') {
    s.bets[p] = Math.max(...s.bets);
  } else {
    // raise
    s.bets[p] = action.amount;
    s.numRaises++;
    // レイズがあったので、他のプレイヤーは再度アクションが必要
    for (let i = 0; i < NUM_PLAYERS; i++) {
      if (i !== p && !s.folded[i]) {
        s.acted[i] = false;
      }
    }
  }

  s.acted[p] = true;

  // 次のプレイヤーを決定
  const next = nextPlayer(s);
  if (next !== null) {
    s.currentPlayer = next;
  }

  return s;
}

/**
 * ターミナルノードかどうか判定
 */
function isTerminal(state: GameState): boolean {
  // 1人以外全員フォールド
  if (activePlayers(state) <= 1) return true;

  // 全員がアクション済みでベットが揃っている
  const maxBet = Math.max(...state.bets);
  for (let i = 0; i < NUM_PLAYERS; i++) {
    if (!state.folded[i]) {
      if (!state.acted[i]) return false;
      if (state.bets[i] < maxBet) return false;
    }
  }

  return true;
}

// --- ゲームツリー構築 ---

/**
 * 再帰的にゲームツリーを構築
 */
function buildNode(state: GameState): GameNode {
  if (isTerminal(state)) {
    const pot = state.bets.reduce((s, b) => s + b, 0);

    if (activePlayers(state) <= 1) {
      // 1人残り → そのプレイヤーがポットを獲得
      const payoff = state.bets.map((b, i) => -b); // まず全員が投入額を失う
      for (let i = 0; i < NUM_PLAYERS; i++) {
        if (!state.folded[i]) {
          payoff[i] += pot; // 勝者がポット獲得
          break;
        }
      }
      return { type: 'terminal', pot, payoff, history: state.history };
    }

    // 複数人残り → ショーダウン（エクイティで分配）
    // ここはCFRでエクイティに基づいて計算する
    return { type: 'terminal', pot, history: state.history };
  }

  const actions = getActions(state);
  const children = new Map<string, GameNode>();

  for (const action of actions) {
    const key = actionKey(action);
    const newState = applyAction(state, action);
    children.set(key, buildNode(newState));
  }

  return {
    type: 'player',
    player: state.currentPlayer,
    actions,
    children,
    history: state.history,
  };
}

/**
 * 完全なゲームツリーを構築
 */
export function buildGameTree(): GameNode {
  const state = initialState();
  return buildNode(state);
}

// --- ツリー統計 ---

interface TreeStats {
  totalNodes: number;
  playerNodes: number;
  terminalNodes: number;
  maxDepth: number;
  terminalByType: { fold: number; showdown: number };
  nodesByPlayer: number[];
}

function collectStats(node: GameNode, depth: number = 0): TreeStats {
  const stats: TreeStats = {
    totalNodes: 1,
    playerNodes: node.type === 'player' ? 1 : 0,
    terminalNodes: node.type === 'terminal' ? 1 : 0,
    maxDepth: depth,
    terminalByType: {
      fold: node.type === 'terminal' && node.payoff ? 1 : 0,
      showdown: node.type === 'terminal' && !node.payoff ? 1 : 0,
    },
    nodesByPlayer: new Array(NUM_PLAYERS).fill(0),
  };

  if (node.type === 'player' && node.player !== undefined) {
    stats.nodesByPlayer[node.player]++;
  }

  if (node.children) {
    for (const child of node.children.values()) {
      const childStats = collectStats(child, depth + 1);
      stats.totalNodes += childStats.totalNodes;
      stats.playerNodes += childStats.playerNodes;
      stats.terminalNodes += childStats.terminalNodes;
      stats.maxDepth = Math.max(stats.maxDepth, childStats.maxDepth);
      stats.terminalByType.fold += childStats.terminalByType.fold;
      stats.terminalByType.showdown += childStats.terminalByType.showdown;
      for (let i = 0; i < NUM_PLAYERS; i++) {
        stats.nodesByPlayer[i] += childStats.nodesByPlayer[i];
      }
    }
  }

  return stats;
}

// --- 情報セット (Information Set) ---

/**
 * 情報セットのキー: プレイヤーの位置 + アクション履歴
 * （ハンドの内容は含まない — CFRではハンドごとに regret を持つ）
 */
export function infoSetKey(player: number, history: string): string {
  return `${player}:${history}`;
}

/**
 * ゲームツリー中の全情報セットを列挙
 */
export function enumerateInfoSets(root: GameNode): Map<string, { actions: Action[]; count: number }> {
  const infoSets = new Map<string, { actions: Action[]; count: number }>();

  function traverse(node: GameNode): void {
    if (node.type === 'player' && node.player !== undefined && node.actions) {
      const key = infoSetKey(node.player, node.history || '');
      const existing = infoSets.get(key);
      if (existing) {
        existing.count++;
      } else {
        infoSets.set(key, { actions: node.actions, count: 1 });
      }
    }
    if (node.children) {
      for (const child of node.children.values()) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return infoSets;
}

// --- メイン ---

if (process.argv[1]?.includes('gameTree')) {
  console.log('=== PLO Preflop Game Tree (6max) ===\n');

  const start = performance.now();
  const root = buildGameTree();
  const elapsed = ((performance.now() - start) / 1000).toFixed(3);

  const stats = collectStats(root);

  console.log(`Build time: ${elapsed}s`);
  console.log(`Total nodes: ${stats.totalNodes.toLocaleString()}`);
  console.log(`Player nodes: ${stats.playerNodes.toLocaleString()}`);
  console.log(`Terminal nodes: ${stats.terminalNodes.toLocaleString()}`);
  console.log(`  Fold wins: ${stats.terminalByType.fold.toLocaleString()}`);
  console.log(`  Showdowns: ${stats.terminalByType.showdown.toLocaleString()}`);
  console.log(`Max depth: ${stats.maxDepth}`);
  console.log(`\nNodes by player position:`);
  for (let i = 0; i < NUM_PLAYERS; i++) {
    console.log(`  ${POSITIONS[i]}: ${stats.nodesByPlayer[i].toLocaleString()}`);
  }

  const infoSets = enumerateInfoSets(root);
  console.log(`\nUnique information sets: ${infoSets.size.toLocaleString()}`);

  // いくつかの情報セットを表示
  console.log('\n--- Sample information sets ---');
  let shown = 0;
  for (const [key, info] of infoSets) {
    if (shown >= 15) break;
    const actionStrs = info.actions.map(a => actionKey(a));
    console.log(`  ${key}  actions=[${actionStrs.join(',')}]`);
    shown++;
  }
}
