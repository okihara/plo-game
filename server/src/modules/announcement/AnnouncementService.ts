import { Server } from 'socket.io';

export interface AnnouncementStatus {
  isActive: boolean;
  message: string;
}

class AnnouncementService {
  private _isActive = false;
  private message = '';
  private io: Server | null = null;

  initialize(io: Server): void {
    this.io = io;
  }

  set(message: string): AnnouncementStatus {
    this._isActive = message.length > 0;
    this.message = message;

    if (this.io) {
      this.io.emit('announcement:status', this.getStatus());
    }

    return this.getStatus();
  }

  clear(): AnnouncementStatus {
    return this.set('');
  }

  getStatus(): AnnouncementStatus {
    return {
      isActive: this._isActive,
      message: this.message,
    };
  }

  isAnnouncementActive(): boolean {
    return this._isActive;
  }
}

export const announcementService = new AnnouncementService();
