/**
 * ステップ1: PLOハンドクラスタ列挙
 *
 * 52枚から4枚の全組み合わせ C(52,4) = 270,725 通りを列挙し、
 * スート同型性（24通りの置換）で正規化して canonical クラスタにまとめる。
 * 結果: ~16,000 クラスタ、それぞれに代表ハンドと重み（出現回数）を記録。
 */

// --- カード表現 ---
// カードは 0-51 の整数で表現: card = rank * 4 + suit
// rank: 0=2, 1=3, ..., 12=A
// suit: 0=h, 1=d, 2=c, 3=s

export const RANK_COUNT = 13;
export const SUIT_COUNT = 4;
export const DECK_SIZE = 52;

export function cardRank(card: number): number {
  return (card >> 2); // card / 4
}

export function cardSuit(card: number): number {
  return card & 3; // card % 4
}

export function makeCard(rank: number, suit: number): number {
  return (rank << 2) | suit;
}

const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUIT_NAMES = ['h', 'd', 'c', 's'];

export function cardToString(card: number): string {
  return RANK_NAMES[cardRank(card)] + SUIT_NAMES[cardSuit(card)];
}

export function handToString(hand: number[]): string {
  return hand.map(cardToString).join(' ');
}

// --- スート置換によるカノニカル化 ---

// 24通りのスート置換を事前生成
const SUIT_PERMS: number[][] = [];
function generatePermutations(arr: number[], l: number): void {
  if (l === arr.length) {
    SUIT_PERMS.push([...arr]);
    return;
  }
  for (let i = l; i < arr.length; i++) {
    [arr[l], arr[i]] = [arr[i], arr[l]];
    generatePermutations(arr, l + 1);
    [arr[l], arr[i]] = [arr[i], arr[l]];
  }
}
generatePermutations([0, 1, 2, 3], 0);

/**
 * ハンド（4枚の整数配列）をカノニカルキーに変換。
 * 既存の preflopEquity.ts と同じ形式: "rankValue.suitIndex-..." (降順ソート)
 *
 * ただし rankValue は getRankValue 互換で 2-14 (2=2, A=14)
 */
export function canonicalKey(hand: number[]): string {
  const ranks = hand.map(cardRank);  // 0-12
  const suits = hand.map(cardSuit);  // 0-3

  let bestKey: string | null = null;

  for (const perm of SUIT_PERMS) {
    const mapped: { r: number; s: number }[] = [];
    for (let i = 0; i < 4; i++) {
      mapped.push({ r: ranks[i] + 2, s: perm[suits[i]] }); // +2 で getRankValue互換
    }
    // 降順ソート: ランク降順、同ランクならスート昇順
    mapped.sort((a, b) => a.r !== b.r ? b.r - a.r : a.s - b.s);

    let key = '';
    for (let i = 0; i < 4; i++) {
      if (i > 0) key += '-';
      key += mapped[i].r + '.' + mapped[i].s;
    }

    if (bestKey === null || key < bestKey) {
      bestKey = key;
    }
  }

  return bestKey!;
}

// --- ハンドクラスタ ---

export interface HandCluster {
  key: string;            // canonical key
  representative: number[]; // 代表ハンド (4枚のカード整数)
  weight: number;         // 出現回数（このクラスタに属するハンドの数）
}

/**
 * 全C(52,4)ハンドを列挙し、canonical クラスタにまとめる
 */
export function enumerateHandClusters(): HandCluster[] {
  const clusterMap = new Map<string, HandCluster>();
  let totalHands = 0;

  // C(52,4) の全組み合わせを列挙
  for (let a = 0; a < DECK_SIZE - 3; a++) {
    for (let b = a + 1; b < DECK_SIZE - 2; b++) {
      for (let c = b + 1; c < DECK_SIZE - 1; c++) {
        for (let d = c + 1; d < DECK_SIZE; d++) {
          const hand = [a, b, c, d];
          const key = canonicalKey(hand);
          totalHands++;

          if (!clusterMap.has(key)) {
            clusterMap.set(key, {
              key,
              representative: hand,
              weight: 1,
            });
          } else {
            clusterMap.get(key)!.weight++;
          }
        }
      }
    }
  }

  const clusters = Array.from(clusterMap.values());

  // weight 合計が C(52,4) = 270725 になるはず
  const weightSum = clusters.reduce((sum, c) => sum + c.weight, 0);

  console.log(`Total raw hands: ${totalHands}`);
  console.log(`Canonical clusters: ${clusters.length}`);
  console.log(`Weight sum: ${weightSum} (expected 270725)`);
  console.log(`Compression ratio: ${(totalHands / clusters.length).toFixed(1)}x`);

  // サンプル表示
  console.log('\n--- Top 10 clusters (by weight) ---');
  const sorted = [...clusters].sort((a, b) => b.weight - a.weight);
  for (const c of sorted.slice(0, 10)) {
    console.log(`  ${c.key}  weight=${c.weight}  rep=${handToString(c.representative)}`);
  }

  console.log('\n--- Bottom 5 clusters (by weight) ---');
  for (const c of sorted.slice(-5)) {
    console.log(`  ${c.key}  weight=${c.weight}  rep=${handToString(c.representative)}`);
  }

  return clusters;
}

// --- 既存データとの整合性チェック ---

async function loadEquityData(): Promise<Record<string, number>> {
  const fs = await import('fs');
  const path = new URL('../../packages/shared/src/data/preflopEquity.json', import.meta.url).pathname;
  return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

async function verifyAgainstExistingData(clusters: HandCluster[]): Promise<void> {
  const equityData = await loadEquityData();
  const existingKeys = new Set(Object.keys(equityData));

  let matched = 0;
  let missing = 0;
  const missingExamples: string[] = [];

  for (const cluster of clusters) {
    if (existingKeys.has(cluster.key)) {
      matched++;
    } else {
      missing++;
      if (missingExamples.length < 5) {
        missingExamples.push(`${cluster.key} (rep=${handToString(cluster.representative)})`);
      }
    }
  }

  console.log(`\n--- Verification against existing equity data ---`);
  console.log(`Existing equity entries: ${existingKeys.size}`);
  console.log(`Matched: ${matched}`);
  console.log(`Missing from equity data: ${missing}`);
  if (missingExamples.length > 0) {
    console.log(`Missing examples: ${missingExamples.join(', ')}`);
  }

  // 逆方向: 既存データにあるが列挙にないキー
  let extraInExisting = 0;
  for (const key of existingKeys) {
    if (!clusters.find(c => c.key === key)) {
      extraInExisting++;
    }
  }
  if (extraInExisting > 0) {
    console.log(`Extra in existing data (not in enumeration): ${extraInExisting}`);
  }
}

// --- メイン ---

if (process.argv[1]?.includes('enumerate')) {
  console.log('=== PLO Hand Cluster Enumeration ===\n');
  const start = performance.now();
  const clusters = enumerateHandClusters();
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  console.log(`\nTime: ${elapsed}s`);

  await verifyAgainstExistingData(clusters);

  // クラスタデータをJSONで保存
  const output = clusters.map(c => ({
    key: c.key,
    rep: c.representative,
    w: c.weight,
  }));

  const fs = await import('fs');
  const outPath = new URL('../data/handClusters.json', import.meta.url).pathname;
  fs.writeFileSync(outPath, JSON.stringify(output));
  console.log(`\nSaved ${clusters.length} clusters to ${outPath}`);
}
