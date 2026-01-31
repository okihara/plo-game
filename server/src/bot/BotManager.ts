import { BotClient } from './BotClient.js';

const BOT_NAMES = ['Miko', 'Kento', 'Luna', 'Hiro', 'Tomoka', 'Yuki', 'Sora', 'Ren', 'Ai', 'Taro'];
const BOT_AVATARS = [
  '/avatars/cpu-1.png',
  '/avatars/cpu-2.png',
  '/avatars/cpu-3.png',
  '/avatars/cpu-4.png',
  '/avatars/cpu-5.png',
];

interface BotManagerConfig {
  serverUrl: string;
  botCount: number;
  blinds: string;
}

export class BotManager {
  private bots: Map<string, BotClient> = new Map();
  private config: BotManagerConfig;
  private usedNames: Set<string> = new Set();
  private isRunning = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: BotManagerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('BotManager is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting BotManager with ${this.config.botCount} bots...`);

    // Create and connect bots
    for (let i = 0; i < this.config.botCount; i++) {
      try {
        await this.createBot();
        // Small delay between bot connections to avoid overwhelming the server
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

    // Disconnect all bots
    for (const bot of this.bots.values()) {
      bot.disconnect();
    }

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
    // First try unused names
    for (const name of BOT_NAMES) {
      if (!this.usedNames.has(name)) {
        return name;
      }
    }

    // If all names are used, add a number suffix
    for (let i = 2; i <= 100; i++) {
      for (const baseName of BOT_NAMES) {
        const name = `${baseName}${i}`;
        if (!this.usedNames.has(name)) {
          return name;
        }
      }
    }

    return null;
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

      // Replace dead bots
      const botsToCreate = this.config.botCount - this.bots.size;
      for (let i = 0; i < botsToCreate; i++) {
        try {
          await this.createBot();
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
}
