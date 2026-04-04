/**
 * デイリーPLOクイズ投稿スクリプト。
 * ローカルから手動または cron で実行する。
 *
 * 使い方:
 *   cd server && npx tsx scripts/daily-quiz.ts                       # ツイート投稿
 *   cd server && npx tsx scripts/daily-quiz.ts --dry-run             # 投稿なし（確認用）
 *   cd server && npx tsx scripts/daily-quiz.ts --type board          # ボード問題（ランダム）
 *   cd server && npx tsx scripts/daily-quiz.ts --type board:outs    # アウツ問題を指定
 *   cd server && npx tsx scripts/daily-quiz.ts --type board:winner  # 勝敗問題を指定
 *   cd server && npx tsx scripts/daily-quiz.ts --type board:nuts    # ナッツ問題を指定
 *   cd server && npx tsx scripts/daily-quiz.ts --type board:handname  # 役名問題を指定
 *   cd server && npx tsx scripts/daily-quiz.ts --type knowledge       # 知識問題を指定
 *   cd server && npx tsx scripts/daily-quiz.ts --type board:outs --min-outs 9  # 9枚以上のアウツ問題
 *   cd server && npx tsx scripts/daily-quiz.ts --answer              # 前日の正解を投稿
 *
 * 環境変数（.env または直接指定）:
 *   TWITTER_API_KEY, TWITTER_API_KEY_SECRET,
 *   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
 *
 * 履歴: server/data/quiz-history.jsonl に1行1JSONで記録
 */
import { config } from 'dotenv';
config();

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateQuiz, parseQuizType } from '../src/modules/quiz/quizGenerator.js';
import { setBoardQuizOptions } from '../src/modules/quiz/generators/boardQuiz.js';
import { renderQuizImage, type QuizImageData } from '../src/modules/quiz/renderQuizImage.js';
import { postTweet, getCredentialsFromEnv } from '../src/modules/quiz/twitterClient.js';
import type { Quiz, QuizHistory } from '../src/modules/quiz/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const HISTORY_FILE = join(DATA_DIR, 'quiz-history.jsonl');

// --- 履歴管理（JSONL ファイル） ---

function loadHistory(): QuizHistory[] {
  if (!existsSync(HISTORY_FILE)) return [];
  const lines = readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line) as QuizHistory);
}

function appendHistory(entry: QuizHistory): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- クイズからの画像データ抽出 ---

function extractImageData(quiz: Quiz): QuizImageData | null {
  if (quiz.type !== 'board') return null;

  // question テキストから情報を抽出（テキスト解析の代わりに quiz.image が設定済みならそちらを使用）
  // boardQuiz.ts で生成されたテキストパターンを解析
  const lines = quiz.question.split('\n');

  const parseLine = (prefix: string): string | undefined => {
    const line = lines.find(l => l.startsWith(prefix));
    return line?.replace(prefix, '').trim();
  };

  // タイトル行（1行目）
  const title = lines[0]?.replace('🃏 PLOクイズ: ', '') || 'PLO Quiz';

  return { title, communityCards: [], street: undefined };
}

// --- メイン ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const answerMode = args.includes('--answer');
  const typeIndex = args.indexOf('--type');
  const typeRaw = typeIndex !== -1 ? args[typeIndex + 1] : undefined;
  const parsed = typeRaw ? (() => {
    try { return parseQuizType(typeRaw); }
    catch (e) { console.error(`❌ ${(e as Error).message}`); process.exit(1); }
  })() : undefined;
  const quizType = parsed?.type;
  const quizSubtype = parsed?.subtype;
  const minOutsIndex = args.indexOf('--min-outs');
  const minOuts = minOutsIndex !== -1 ? parseInt(args[minOutsIndex + 1], 10) : undefined;
  if (minOuts !== undefined && (isNaN(minOuts) || minOuts < 1)) {
    console.error('❌ --min-outs には正の整数を指定してください');
    process.exit(1);
  }
  if (minOuts !== undefined) {
    setBoardQuizOptions({ minOuts });
  }

  const modeLabel = [
    dryRun && 'DRY RUN',
    answerMode && 'ANSWER MODE',
    typeRaw && `type=${typeRaw}`,
    minOuts && `min-outs=${minOuts}`,
  ].filter(Boolean).join(', ');
  console.log(`=== Daily PLO Quiz ${modeLabel ? `(${modeLabel})` : ''} ===\n`);

  if (answerMode) {
    await postAnswer(dryRun);
    return;
  }

  // 今日すでに投稿済みか確認
  const history = loadHistory();
  const today = todayStr();
  if (history.some(h => h.date === today)) {
    console.log(`⚠️  今日 (${today}) は既に投稿済みです。`);
    if (!dryRun) return;
    console.log('(dry-run なので続行します)\n');
  }

  // 既出の知識問題を除外
  const usedKnowledge = new Set(
    history.filter(h => h.type === 'knowledge').map(h => h.question),
  );

  // クイズ生成
  const quiz = generateQuiz(usedKnowledge, quizType, quizSubtype);
  console.log('📝 生成されたクイズ:');
  console.log('─'.repeat(50));
  console.log(quiz.question);
  console.log('─'.repeat(50));
  console.log('選択肢:');
  quiz.choices.forEach((c, i) => {
    const marker = i === quiz.correctIndex ? '✅' : '  ';
    console.log(`  ${marker} ${i + 1}. ${c}`);
  });
  console.log(`\n解説: ${quiz.explanation}\n`);

  // 画像生成（ボード問題の場合）
  let imageBuffer: Buffer | undefined;
  if (quiz.image) {
    imageBuffer = quiz.image;
    console.log('🖼️  クイズ画像あり');
  }

  if (dryRun) {
    // dry-run時は画像をファイルに保存
    if (imageBuffer) {
      const imgPath = join(DATA_DIR, `quiz-preview-${today}.png`);
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(imgPath, imageBuffer);
      console.log(`🖼️  プレビュー画像を保存しました: ${imgPath}`);
    }
    console.log('\n✅ Dry run 完了（ツイートは投稿されませんでした）');
    return;
  }

  // Twitter投稿
  const creds = getCredentialsFromEnv();

  // 投票付きツイート
  const tweetText = quiz.question + '\n\n#PLO #ポーカー #BabyPLO';
  const result = await postTweet(creds, {
    text: tweetText,
    pollOptions: quiz.choices,
    pollDurationMinutes: 1440, // 24時間
    image: imageBuffer,
  });

  console.log(`✅ ツイート投稿完了: https://twitter.com/i/status/${result.tweetId}`);

  // 履歴保存
  appendHistory({
    date: today,
    type: quiz.type,
    question: quiz.question,
    correctIndex: quiz.correctIndex,
    tweetId: result.tweetId,
  });
  console.log('📁 履歴を保存しました');
}

/** 前日のクイズの正解をリプライで投稿 */
async function postAnswer(dryRun: boolean) {
  const history = loadHistory();
  // tweetId があり answerTweetId がまだない最新のエントリを探す
  const target = [...history].reverse().find(h => h.tweetId && !h.answerTweetId);

  if (!target) {
    console.log('⚠️  回答すべきクイズが見つかりません。');
    return;
  }

  console.log(`📝 回答対象: ${target.date} のクイズ`);
  console.log(`   正解: ${target.correctIndex + 1}番目の選択肢\n`);

  // generateQuiz を再度呼ぶのではなく、履歴から正解情報を使う
  const answerText = [
    `⏰ 昨日のクイズの正解発表！`,
    '',
    `正解は ${target.correctIndex + 1} 番！`,
    '',
    `明日もお楽しみに 🃏`,
    '',
    '#PLO #ポーカー #BabyPLO',
  ].join('\n');

  console.log('回答ツイート:');
  console.log('─'.repeat(50));
  console.log(answerText);
  console.log('─'.repeat(50));

  if (dryRun) {
    console.log('\n✅ Dry run 完了');
    return;
  }

  const creds = getCredentialsFromEnv();
  const result = await postTweet(creds, {
    text: answerText,
    replyToTweetId: target.tweetId,
  });

  console.log(`✅ 回答ツイート投稿完了: https://twitter.com/i/status/${result.tweetId}`);

  // 履歴更新（answerTweetId を追記）
  const updatedHistory = history.map(h =>
    h === target ? { ...h, answerTweetId: result.tweetId } : h,
  );
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(HISTORY_FILE, updatedHistory.map(h => JSON.stringify(h)).join('\n') + '\n');
  console.log('📁 履歴を更新しました');
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
