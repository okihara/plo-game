import { Sentry, sentryEnabled, withConsoleErrorBridgeSuppressed } from '../../config/sentry.js';
import { AuthenticatedSocket } from './authMiddleware.js';

// Socket イベントハンドラを Sentry でラップする。
// async/sync 両対応で、例外はキャプチャしつつ再 throw しないことで切断連鎖を防ぐ。
export function wrapSocketHandler<Args extends unknown[]>(
  socket: AuthenticatedSocket,
  event: string,
  handler: (...args: Args) => unknown | Promise<unknown>,
): (...args: Args) => void {
  return (...args: Args) => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        result.catch((err) => reportSocketError(err, socket, event));
      }
    } catch (err) {
      reportSocketError(err, socket, event);
    }
  };
}

function reportSocketError(err: unknown, socket: AuthenticatedSocket, event: string): void {
  withConsoleErrorBridgeSuppressed(() => {
    console.error(`[Socket] handler error: event=${event}, odId=${socket.odId}, socket=${socket.id}`, err);
  });
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('source', 'socket.io');
    scope.setTag('socket.event', event);
    scope.setContext('socket', {
      id: socket.id,
      odId: socket.odId,
      username: socket.odUsername,
      mode: socket.odConnectionMode,
    });
    if (socket.odId) {
      scope.setUser({ id: socket.odId, username: socket.odUsername });
    }
    Sentry.captureException(err);
  });
}
