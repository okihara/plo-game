import { BotClient, BotStatus } from './BotClient.js';

const BOT_NAMES = [
  // --- 継続11体（5000ハンド未満） ---
  'YumaS', 'chihiro7', 'RyujiK', 'shiori12', 'haruna88',
  'hana_plo', 'aoi1208', 'KoharuN', 'JunpeiT', 'kyoko_p',
  'DaisukeN',
  // --- 新規89体 ---
  'haruto_w3', 'sakura0321', 'yuuki_t8', 'mirei_plo', 'koji1985',
  'AoiTanaka', 'ren_omaha', 'maiko_s11', 'teppei_n', 'hinata07',
  'riku_k22', 'sayo_pkr', 'yutaro33', 'kana_s15', 'daito_h',
  'moe_chan3', 'sora_h44', 'rumi_n99', 'tsubasa_k', 'yui_plo',
  'kenta_w5', 'asami_t', 'ShugoMura', 'nao_pkr7', 'misaki_h',
  'takuma_s6', 'rina_ace2', 'hideki_n', 'kaede0808', 'jun_omaha',
  'wataru_t2', 'emiko_s', 'RyoH07', 'mashiro5', 'kouki_m3',
  'ayumi_n', 'sota_k77', 'yuna_plo3', 'manatek', 'serina_h',
  'tetsu_n12', 'kazuha_m', 'fumito_s', 'rio_pkr', 'YukiH33',
  'MaoN08', 'issei_k9', 'haru_omaha', 'akane_t2', 'taichi_m',
  'sumika_h', 'rento_s4', 'moeka_22', 'gaku_n', 'saeko_t7',
  'kouhei_m', 'nagi_plo', 'aika_h11', 'shunto_k', 'mizuki_s3',
  'tomoki_n2', 'yuuna_08', 'jiro_t88', 'kotoha_m', 'reiji_s5',
  'sakiko_n', 'hajime_k', 'mio_pkr5', 'yuri_h14', 'tsumugi_s',
  'kazuto_m', 'arisa_t3', 'shingo_n', 'mahiru_p', 'iori_k9',
  'kenma_s2', 'ruka_h55', 'takuto_m', 'sara_plo', 'yuuka_n8',
  'kyosuke_t', 'AmiH07', 'soma_k13', 'wakana_3', 'daiki_s4',
  'erina_m6', 'hiroto_n', 'yume_pkr', 'mitsuki_t',
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
  inviteCode?: string; // プライベートテーブル招待コード
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

        // Join matchmaking pool or private table
        if (this.config.inviteCode) {
          await bot.joinPrivateTable(this.config.inviteCode);
        } else {
          await bot.joinMatchmaking(this.config.blinds);
        }

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

      // totalPlayers が目標以上なら補充不要
      if (totalPlayers >= this.config.botCount) return;

      const deficit = this.config.botCount - totalPlayers;
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
