import { BotClient, BotStatus } from './BotClient.js';

const BOT_NAMES = [
  // --- 既存20体 ---
  'Taku83', 'mii_chan', 'ShotaK', 'risa.p', 'YuHayashi',
  'ken2408', 'NanaM', 'daisk77', 'HaruSun', 'AyakaSaito',
  'ryooo3', 'MizuhoT', 'shun_pkr', 'Sakuraba', 'kojimax',
  'Mei0522', 'TatsuyaN', 'yuna0312', 'Kaito_R', 'momoka55',
  // --- 追加80体 ---
  'ReinaK42', 'takuya_s', 'Yamamoto7', 'hina2525', 'KenjiF',
  'Sora_99', 'mayu_plo', 'DaichiM', 'aoi1208', 'RyosukeT',
  'mikimiki3', 'HiroShi', 'natsuki_p', 'YutoK07', 'haruna88',
  'KazukiH', 'rin_chan5', 'TomoyaS', 'asuka111', 'KoharuN',
  'shunsuke', 'MaoT14', 'yuki_ace', 'IkuoW', 'chiho33',
  'RenK', 'aya_poker', 'TakeshiM', 'mana0808', 'YusukeH',
  'karin22', 'ShinyaT', 'miho_pkr', 'DaigoN', 'sakiY05',
  'KotaroS', 'nene777', 'AtsushiK', 'yui_0210', 'MasatoH',
  'hana_plo', 'SoichiroT', 'riho99', 'KengoM', 'akane_55',
  'YumaS', 'shiori12', 'TakeruN', 'mai_chan', 'RyujiK',
  'miku0603', 'HayatoS', 'kanako_p', 'JunpeiT', 'riko2424',
  'NaokiM', 'sae_pkr', 'KosukeH', 'yurina10', 'MakotoS',
  'chihiro7', 'TaigaN', 'ami_0930', 'ShogoK', 'nanami22',
  'RyotaH', 'kyoko_p', 'YoshikiT', 'eri_chan', 'DaisukeN',
  'momo_plo', 'KeisukeS', 'sayaka88', 'AkiraM', 'yuzuki13',
  'ShinjiK', 'rika_ace', 'HikaruN', 'tomomi55', 'GoT08',
];
const BOT_AVATARS = Array.from({ length: 70 }, (_, i) =>
  `/images/icons/icon_${String(i + 1).padStart(3, '0')}.png`
);

interface BotManagerConfig {
  serverUrl: string;
  botCount: number;
  blinds: string;
  isFastFold?: boolean;
  midHandDisconnectChance?: number;
  maxHandsPerSession?: number; // セッション上限ハンド数
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
    // セッション上限に±20のランダム幅を持たせ、全ボット一斉離脱を防ぐ
    let maxHands = this.config.maxHandsPerSession;
    if (maxHands) {
      const variance = Math.floor(maxHands * 0.25);
      maxHands = maxHands - variance + Math.floor(Math.random() * variance * 2);
    }

    const bot = new BotClient({
      serverUrl: this.config.serverUrl,
      name,
      avatarUrl: BOT_AVATARS[avatarIndex],
      defaultBlinds: this.config.blinds,
      isFastFold: this.config.isFastFold,
      midHandDisconnectChance: this.config.midHandDisconnectChance,
      maxHandsPerSession: maxHands,
      onJoinFailed: (failedBot, reason) => this.handleJoinFailed(failedBot, reason),
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

  /** マッチメイキング参加失敗時: 該当ボットを切断し、別のボットで再試行 */
  private async handleJoinFailed(failedBot: BotClient, reason: string): Promise<void> {
    if (!this.isRunning) return;

    const playerId = failedBot.getPlayerId();
    const botName = failedBot.getName();
    console.log(`[BotManager] Bot ${botName} join failed (${reason}), replacing...`);

    // 失敗したボットを除去
    if (playerId) this.bots.delete(playerId);
    this.usedNames.delete(botName);
    failedBot.disconnect().catch(() => {});

    // 少し待ってから別のボットで再試行
    await this.sleep(1000);
    if (!this.isRunning) return;

    try {
      await this.createBot();
    } catch (err) {
      console.error('[BotManager] Failed to create replacement bot:', err);
    }
  }

  private getAvailableName(): string | null {
    // 使用可能な名前をランダムに選択
    const available = BOT_NAMES.filter(n => !this.usedNames.has(n));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
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

      const totalPlayers = await this.getPlayerCountForBlinds();

      // ボットが過剰な場合、能動的に削減（ゲーム中でないボットを優先）
      const excess = totalPlayers - this.config.botCount;
      if (excess > 0) {
        const botsToRemove = Math.min(excess, this.bots.size);
        const candidates = [...this.bots.entries()]
          .sort((a, b) => Number(a[1].isInGame()) - Number(b[1].isInGame()))
          .slice(0, botsToRemove);
        for (const [playerId, bot] of candidates) {
          this.bots.delete(playerId);
          this.usedNames.delete(bot.getName());
          bot.disconnect().catch(err => console.error('Bot reduction disconnect error:', err));
        }
        if (candidates.length > 0) {
          console.log(`[HealthCheck] Reduced ${candidates.length} bots (total: ${totalPlayers}, target: ${this.config.botCount})`);
        }
        return;
      }

      // totalPlayers == botCount なら補充不要
      if (totalPlayers >= this.config.botCount) return;

      const deficit = this.config.botCount - this.bots.size;
      const botsToCreate = Math.max(0, deficit);

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
