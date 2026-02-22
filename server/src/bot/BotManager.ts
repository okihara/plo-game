import { BotClient, BotStatus } from './BotClient.js';

const BOT_NAMES = [
  'Taku83',        // 名前+生まれ年風
  'mii_chan',      // ニックネーム風
  'ShotaK',       // 名前+イニシャル
  'risa.p',       // 名前+ドット+頭文字
  'YuHayashi',    // フルネーム風
  'ken2408',      // 名前+数字
  'NanaM',        // 名前+イニシャル
  'daisk77',      // カジュアル+数字
  'HaruSun',      // 名前+英語
  'AyakaSaito',   // フルネーム風
  'ryooo3',       // 伸ばし+数字
  'MizuhoT',      // 名前+イニシャル
  'shun_pkr',     // 名前+略語
  'Sakuraba',     // 苗字のみ
  'kojimax',      // 名前+接尾辞
  'Mei0522',      // 名前+誕生日風
  'TatsuyaN',     // 名前+イニシャル
  'yuna0312',     // 名前+日付
  'Kaito_R',      // 名前+アンダーバー+イニシャル
  'momoka55',     // 名前+数字
];
const BOT_AVATARS = [
  '/images/icons/avatar1.png',
  '/images/icons/avatar2.png',
  '/images/icons/avatar3.png',
  '/images/icons/avatar4.png',
  '/images/icons/avatar5.png',
];

interface BotManagerConfig {
  serverUrl: string;
  botCount: number;
  blinds: string;
  isFastFold?: boolean;
}

export class BotManager {
  private bots: Map<string, BotClient> = new Map();
  private config: BotManagerConfig;
  private usedNames: Set<string> = new Set();
  private isRunning = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: BotManagerConfig) {
    this.config = {
      ...config,
      botCount: Math.min(config.botCount, BOT_NAMES.length),
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('BotManager is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting BotManager with ${this.config.botCount} bots...`);

    // Create and connect bots (capped by available names)
    for (let i = 0; i < this.config.botCount; i++) {
      try {
        const bot = await this.createBot();
        if (!bot) break; // No more names available
        await this.sleep(500);
      } catch (err) {
        console.error(`Failed to create bot ${i + 1}:`, err);
      }
    }

    console.log(`BotManager started with ${this.bots.size} bots`);

    // Start health check to replace disconnected bots
    this.startHealthCheck();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    console.log('Stopping BotManager...');

    // 全ボットを並行してクリーンに切断（各ボットが table:leave 等を送信してから disconnect）
    const disconnectPromises = Array.from(this.bots.values()).map(bot =>
      bot.disconnect().catch(err => console.error('Bot disconnect error:', err))
    );
    await Promise.all(disconnectPromises);

    this.bots.clear();
    this.usedNames.clear();

    console.log('BotManager stopped');
  }

  private async createBot(): Promise<BotClient | null> {
    const name = this.getAvailableName();
    if (!name) {
      console.error('No available bot names');
      return null;
    }

    const avatarIndex = Math.floor(Math.random() * BOT_AVATARS.length);
    const bot = new BotClient({
      serverUrl: this.config.serverUrl,
      name,
      avatarUrl: BOT_AVATARS[avatarIndex],
      defaultBlinds: this.config.blinds,
      isFastFold: this.config.isFastFold,
    });

    try {
      await bot.connect();

      const playerId = bot.getPlayerId();
      if (playerId) {
        this.bots.set(playerId, bot);
        this.usedNames.add(name);

        // Join matchmaking pool
        await bot.joinMatchmaking(this.config.blinds);

        return bot;
      }
    } catch (err) {
      console.error(`Failed to connect bot ${name}:`, err);
      bot.disconnect();
      this.usedNames.delete(name);
    }

    return null;
  }

  private getAvailableName(): string | null {
    for (const name of BOT_NAMES) {
      if (!this.usedNames.has(name)) {
        return name;
      }
    }
    return null;
  }

  private async getPlayerCountForBlinds(): Promise<number> {
    try {
      const res = await fetch(`${this.config.serverUrl}/api/lobby/tables`);
      if (!res.ok) return 0;
      const data = await res.json() as Array<{ blinds: string; playerCount: number; isFastFold: boolean }>;
      const entry = data.find(t => t.blinds === this.config.blinds && t.isFastFold === !!this.config.isFastFold);
      return entry?.playerCount ?? 0;
    } catch {
      return 0;
    }
  }

  private startHealthCheck(): void {
    // Check bot health every 10 seconds
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const deadBots: string[] = [];

      // Find disconnected bots
      for (const [playerId, bot] of this.bots.entries()) {
        if (!bot.isActive()) {
          deadBots.push(playerId);
          this.usedNames.delete(bot.getName());
        }
      }

      // Remove dead bots
      for (const playerId of deadBots) {
        this.bots.delete(playerId);
        console.log(`Removed dead bot: ${playerId}`);
      }

      // Skip replacing bots if total players for this blinds level exceeds limit
      const totalPlayers = await this.getPlayerCountForBlinds();
      if (totalPlayers >= this.config.botCount) {
        if (deadBots.length > 0) {
          console.log(`[HealthCheck] Skipping bot replacement: ${totalPlayers} players at ${this.config.blinds} (limit: ${this.config.botCount})`);
        }
        return;
      }

      // Replace dead bots
      const botsToCreate = this.config.botCount - this.bots.size;
      for (let i = 0; i < botsToCreate; i++) {
        try {
          const bot = await this.createBot();
          if (!bot) break; // No more names available
          await this.sleep(500);
        } catch (err) {
          console.error('Failed to replace bot:', err);
        }
      }
    }, 10000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getBotCount(): number {
    return this.bots.size;
  }

  getActiveBotCount(): number {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.isActive()) count++;
    }
    return count;
  }

  getInGameBotCount(): number {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.isInGame()) count++;
    }
    return count;
  }

  getStats(): { total: number; active: number; inGame: number } {
    return {
      total: this.getBotCount(),
      active: this.getActiveBotCount(),
      inGame: this.getInGameBotCount(),
    };
  }

  getDetailedStats(): { summary: { total: number; connected: number; playing: number; matchmaking: number; disconnected: number; targetCount: number }; bots: BotStatus[] } {
    const bots: BotStatus[] = [];
    let connected = 0, playing = 0, matchmaking = 0, disconnected = 0;

    for (const bot of this.bots.values()) {
      const status = bot.getStatus();
      bots.push(status);
      if (status.state === 'playing') playing++;
      else if (status.state === 'matchmaking') matchmaking++;
      else disconnected++;
      if (status.isConnected) connected++;
    }

    return {
      summary: {
        total: this.bots.size,
        connected,
        playing,
        matchmaking,
        disconnected,
        targetCount: this.config.botCount,
      },
      bots,
    };
  }
}
