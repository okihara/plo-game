// ボット用ソケットエラー専用ロガー。
// 通常ログとは別ファイルに書き出して検証時の追跡を容易にする。

import fs from 'fs';
import path from 'path';

let logStream: fs.WriteStream | null = null;
let logFilePath: string | null = null;

export function initSocketErrorLog(filePath: string): void {
  if (logStream) return;
  logFilePath = path.resolve(filePath);
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  logStream.write(`\n=== Socket error log started at ${new Date().toISOString()} (pid ${process.pid}) ===\n`);
}

export function logSocketError(botName: string, event: string, message: string): void {
  if (!logStream) return;
  const line = `${new Date().toISOString()} [${botName}] ${event}: ${message}\n`;
  logStream.write(line);
}

export function closeSocketErrorLog(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

export function getSocketErrorLogPath(): string | null {
  return logFilePath;
}

export function isSocketErrorLogEnabled(): boolean {
  return logStream != null;
}
