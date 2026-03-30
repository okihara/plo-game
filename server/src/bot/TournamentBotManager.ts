import { BotClient } from './BotClient.js';
import { BOT_NAMES, BOT_AVATARS } from './BotManager.js';

export interface TournamentBotConfig {
  serverUrl: string;
  botCount: number;
  tournamentId: string;
  noDelay?: boolean;
  chaosMode?: boolean; // true: ランダム切断→再接続で不具合を再現する
}

/**
 * トーナメント用ボット管理。
 * N体のボットを接続→トーナメント登録し、完了/脱落を待って切断する。
 * キャッシュゲーム用 BotManager とはライフサイクルが異なるため別クラス。
 */
export class TournamentBotManager {
  private bots: BotClient[] = [];
  private config: TournamentBotConfig;
  private resolveCompleted: (() => void) | null = null;
  private eliminatedCount = 0;

  constructor(config: TournamentBotConfig) {
    this.config = {
      ...config,
      botCount: Math.min(config.botCount, BOT_NAMES.length),
    };
  }

  /**
   * ボットを接続してトーナメントに登録する。
   * トーナメントの開始は呼び出し側が管理APIで行う。
   */
  async connectAndRegister(): Promise<void> {
    const { serverUrl, botCount, tournamentId, noDelay } = this.config;

    // シャッフルして被らない名前を選択
    const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const names = shuffled.slice(0, botCount);

    console.log(`[TournamentBotManager] Connecting ${botCount} bots for tournament ${tournamentId}...`);

    for (let i = 0; i < botCount; i++) {
      const avatarUrl = BOT_AVATARS[Math.floor(Math.random() * BOT_AVATARS.length)];

      const bot = new BotClient({
        serverUrl,
        name: names[i],
        avatarUrl,
        noDelay,
        botSecret: process.env.BOT_SECRET,
        tournamentMode: true,
        tournamentChaosMode: this.config.chaosMode,
        disconnectChance: 0,
        onTournamentEliminated: () => this.onBotEliminated(),
        onTournamentCompleted: () => this.onBotCompleted(),
      });

      try {
        await bot.connect();
        await bot.joinTournament(tournamentId);
        this.bots.push(bot);
        // 接続間隔（サーバー負荷軽減）
        await sleep(200);
      } catch (err) {
        console.error(`[TournamentBotManager] Failed to connect bot ${names[i]}:`, err);
      }
    }

    console.log(`[TournamentBotManager] ${this.bots.length}/${botCount} bots registered`);
  }

  /**
   * 全ボットが脱落またはトーナメント完了するまで待機する。
   */
  async waitForCompletion(): Promise<void> {
    if (this.bots.length === 0) return;

    return new Promise<void>((resolve) => {
      this.resolveCompleted = resolve;
      // 既に全員終了済みならすぐ解決
      if (this.eliminatedCount >= this.bots.length) {
        resolve();
      }
    });
  }

  async disconnectAll(): Promise<void> {
    console.log(`[TournamentBotManager] Disconnecting ${this.bots.length} bots...`);
    await Promise.all(
      this.bots.map(bot => bot.disconnect().catch(() => {}))
    );
    this.bots = [];
    this.eliminatedCount = 0;
    console.log('[TournamentBotManager] All bots disconnected');
  }

  getBotCount(): number {
    return this.bots.length;
  }

  private onBotEliminated(): void {
    this.eliminatedCount++;
    this.checkAllDone();
  }

  private onBotCompleted(): void {
    // tournament:completed は全ボットに送信されるので、全員分カウント
    this.eliminatedCount = this.bots.length;
    this.checkAllDone();
  }

  private checkAllDone(): void {
    if (this.eliminatedCount >= this.bots.length && this.resolveCompleted) {
      this.resolveCompleted();
      this.resolveCompleted = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
