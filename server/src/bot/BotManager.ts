import { BotClient, BotStatus } from './BotClient.js';

const MAINTENANCE_PAUSE_MS = 60_000; // メンテナンス検知時の待機時間

export const BOT_NAMES = [
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
  // --- 追加200体 ---
  'naoto_k1', 'chika_s9', 'ryota_m2', 'honoka_t', 'keigo_n5',
  'ayaka_h3', 'shota_s7', 'nanami_k', 'yuji_t12', 'kotone_m',
  'masato_h', 'rin_plo4', 'tatsuya_s', 'mei_omaha', 'kosuke_n',
  'fuuka_t6', 'genki_m3', 'mikoto_s', 'ryo_pkr9', 'tsukasa_h',
  'anna_k55', 'subaru_t', 'hinano_m', 'ikuto_s2', 'nodoka_h',
  'hayato_k', 'shiho_t4', 'yamato_n', 'kanon_s8', 'shunsuke_m',
  'haruka_p3', 'itsuki_t', 'manaka_n', 'touma_s6', 'risa_h22',
  'akira_k7', 'suzune_t', 'kakeru_m', 'miyu_plo8', 'souma_n',
  'azusa_s5', 'kaito_h3', 'minori_t', 'ryusei_k', 'koharu_m9',
  'naoya_t4', 'satsuki_n', 'raito_s', 'yuzuki_h', 'daishin_k',
  'ayana_m2', 'shun_plo5', 'momoka_t', 'yuuto_s8', 'chiaki_n',
  'haruki_m', 'tomoe_h7', 'sena_k33', 'miori_t', 'keisuke_s',
  'riko_n44', 'taiga_m2', 'sayuri_h', 'ibuki_k', 'kurumi_s6',
  'makoto_t3', 'hina_pkr', 'shin_m77', 'amane_h', 'ryunosuke',
  'mayu_s14', 'kosei_t', 'akemi_n5', 'kairi_m', 'hitomi_s9',
  'takeshi_h', 'otoha_k2', 'yusaku_t', 'misato_n', 'zen_plo',
  'natsume_s', 'kotetsu_m', 'fuyumi_h', 'rikuto_k', 'shinobu_t',
  'mahiro_n3', 'taisei_s', 'rena_h88', 'gento_m', 'chinatsu_k',
  'yuuma_t5', 'airi_s22', 'shinya_n', 'kokona_m', 'hayate_h',
  'miku_plo6', 'sosuke_t', 'yua_k11', 'takuya_m', 'rika_s44',
  'nagisa_h', 'asahi_t9', 'miho_n33', 'souta_k', 'tomoka_m',
  'kei_plo2', 'yuzuha_s', 'daigo_t', 'reina_h5', 'minato_k',
  'chisato_n', 'ryuji_m8', 'sakurako', 'kouga_t', 'yuria_s3',
  'shuichi_h', 'mayumi_k', 'isamu_t7', 'haruna_n', 'ritsuki_m',
  'nene_s66', 'taku_plo', 'miona_h', 'kiichi_t', 'tsugumi_k',
  'yosuke_m', 'karin_s2', 'masaki_h', 'futaba_t', 'ryoichi_n',
  'shiori_m5', 'kouki_t9', 'nanase_h', 'daichi_k', 'saori_plo',
  'tokiya_m', 'harumi_s', 'go_pkr44', 'kohana_t', 'shinsuke_n',
  'mai_h123', 'yusei_k', 'akari_m7', 'tatsuki_s', 'mana_t99',
  'junichi_h', 'himari_k', 'shoma_t', 'kyoka_m3', 'ryohei_s',
  'mitsuru_n', 'hikari_t', 'koudai_m', 'saki_h66', 'renka_s',
  'yuichi_k2', 'nozomi_t', 'kai_plo7', 'chihaya_m', 'taiki_s',
  'sumire_h4', 'shintaro', 'mirai_k8', 'koji_t55', 'ayane_m',
  'seiji_h3', 'nonoka_s', 'tatsu_plo', 'wakaba_t', 'kou_m99',
  'rei_s123', 'tomoaki_h', 'ichika_k', 'shuji_t4', 'yuki_n88',
  'kaname_m', 'suzuka_h', 'rinto_s5', 'chiyo_t', 'hayata_k2',
  'marino_n', 'keita_m8', 'akane_plo', 'tomotaka_s', 'luna_h7',
];
export const BOT_AVATARS = Array.from({ length: 70 }, (_, i) =>
  `/images/icons/icon_${String(i + 1).padStart(3, '0')}.png`
);

interface BotManagerConfig {
  serverUrl: string;
  botCount: number;
  blinds: string;
  variant?: string; // ゲームバリアント（'plo' | 'stud' 等）
  isFastFold?: boolean;
  midHandDisconnectChance?: number;
  maxHandsPerSession?: number; // セッション上限ハンド数
  noDelay?: boolean; // 思考時間を0にする
  inviteCode?: string; // プライベートテーブル招待コード
}

export class BotManager {
  private bots: Map<string, BotClient> = new Map();
  private config: BotManagerConfig;
  private usedNames: Set<string> = new Set();
  private isRunning = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private maintenancePauseUntil: number = 0; // メンテナンス待機の終了時刻

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
      variant: this.config.variant,
      isFastFold: this.config.isFastFold,
      midHandDisconnectChance: this.config.midHandDisconnectChance,
      maxHandsPerSession: maxHands,
      noDelay: this.config.noDelay,
      botSecret: process.env.BOT_SECRET,
      onJoinFailed: (failedBot, reason) => this.handleJoinFailed(failedBot, reason),
    });

    try {
      await bot.connect();

      const playerId = bot.getPlayerId();
      if (playerId) {
        this.bots.set(playerId, bot);
        this.usedNames.add(name);

        // メンテナンス中ならマッチメイキングに参加しない（接続だけ維持）
        if (bot.isMaintenanceActive) {
          console.log(`[BotManager] ${name} connected but maintenance active, skipping matchmaking`);
          return bot;
        }

        // Join matchmaking pool or private table
        if (this.config.inviteCode) {
          await bot.joinPrivateTable(this.config.inviteCode);
        } else {
          await bot.joinMatchmaking(this.config.blinds, this.config.variant);
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

  /** マッチメイキング参加失敗時: 該当ボットを切断（補充はヘルスチェックに任せる） */
  private async handleJoinFailed(failedBot: BotClient, reason: string): Promise<void> {
    if (!this.isRunning) return;

    const playerId = failedBot.getPlayerId();
    const botName = failedBot.getName();
    console.log(`[BotManager] Bot ${botName} join failed (${reason}), removing.`);

    // 失敗したボットを除去（補充はヘルスチェックが判断する）
    if (playerId) this.bots.delete(playerId);
    this.usedNames.delete(botName);
    failedBot.disconnect().catch(() => {});
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

      // メンテナンス中なら待機（いずれかのボットがメンテ検知 → 1分間ヘルスチェックをスキップ）
      const anyMaintenance = [...this.bots.values()].some(b => b.isMaintenanceActive);
      if (anyMaintenance) {
        if (this.maintenancePauseUntil === 0) {
          this.maintenancePauseUntil = Date.now() + MAINTENANCE_PAUSE_MS;
          console.log('[HealthCheck] Maintenance detected, pausing for ~60s');
        }
      }
      if (this.maintenancePauseUntil > 0) {
        if (Date.now() < this.maintenancePauseUntil) return; // まだ待機中
        // 待機終了 — いずれかのボットがまだメンテ中なら延長
        if (anyMaintenance) {
          this.maintenancePauseUntil = Date.now() + MAINTENANCE_PAUSE_MS;
          console.log('[HealthCheck] Maintenance still active, extending pause');
          return;
        }
        this.maintenancePauseUntil = 0;
        console.log('[HealthCheck] Maintenance ended, resuming');
        // メンテ中にマッチメイキング未参加だったボットを参加させる
        for (const bot of this.bots.values()) {
          if (bot.isActive() && !bot.isInGame()) {
            if (this.config.inviteCode) {
              bot.joinPrivateTable(this.config.inviteCode).catch(() => {});
            } else {
              bot.joinMatchmaking(this.config.blinds, this.config.variant).catch(() => {});
            }
          }
        }
      }

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
