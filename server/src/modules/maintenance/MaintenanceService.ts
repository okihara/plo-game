import { Server } from 'socket.io';
import { prisma } from '../../config/database.js';

export interface MaintenanceStatus {
  isActive: boolean;
  message: string;
  activatedAt: string | null;
}

class MaintenanceService {
  private _isActive = false;
  private message = '';
  private activatedAt: Date | null = null;
  private io: Server | null = null;
  private onDeactivateCallback?: () => void;

  async initialize(io: Server): Promise<void> {
    this.io = io;

    const record = await prisma.maintenanceMode.findUnique({
      where: { id: 'singleton' },
    });

    if (record) {
      this._isActive = record.isActive;
      this.message = record.message;
      this.activatedAt = record.activatedAt;
    }
  }

  async toggle(active: boolean, message: string = ''): Promise<MaintenanceStatus> {
    const now = active ? new Date() : null;

    await prisma.maintenanceMode.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', isActive: active, message, activatedAt: now },
      update: { isActive: active, message, activatedAt: now },
    });

    this._isActive = active;
    this.message = message;
    this.activatedAt = now;

    // 全接続クライアントにブロードキャスト
    if (this.io) {
      this.io.emit('maintenance:status', this.getStatus());
    }

    // メンテOFF時にコールバック実行（ハンド再開トリガー）
    if (!active && this.onDeactivateCallback) {
      this.onDeactivateCallback();
    }

    return this.getStatus();
  }

  getStatus(): MaintenanceStatus {
    return {
      isActive: this._isActive,
      message: this.message,
      activatedAt: this.activatedAt?.toISOString() ?? null,
    };
  }

  isMaintenanceActive(): boolean {
    return this._isActive;
  }

  setOnDeactivate(callback: () => void): void {
    this.onDeactivateCallback = callback;
  }
}

export const maintenanceService = new MaintenanceService();
