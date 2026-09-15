/**
 * Sakanaa-Whatswap - Connection Guard
 * Watchdog timer, crash guard, network noise filter, and smart reconnect backoff.
 */

import { DisconnectReason } from '@whiskeysockets/baileys';
import { logger as defaultLogger } from './logger.js';

// Transient network error messages/codes to absorb gracefully
const TRANSIENT_NETWORK_ERRORS = [
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'socket hang up',
  'Connection Closed',
  'Connection Terminated',
  'Stream Errored',
  'Opening handshake has timed out',
  'WebSocket was closed before the connection was established',
  'pre-key',
  'rate-overlimit',
  'conflict',
];

export class ConnectionGuard {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
    this.idleTimeoutMs = options.idleTimeoutMs || 240_000; // 4 minutes default
    this.maxConsecutiveRestarts = options.maxConsecutiveRestarts || 15;
    this.stabilizeDelayMs = options.stabilizeDelayMs || 120_000; // 2 minutes to reset counter
    this.initialBackoffMs = options.initialBackoffMs || 2_000; // 2s
    this.maxBackoffMs = options.maxBackoffMs || 30_000; // 30s
    this.streamConflictDelayMs = options.streamConflictDelayMs || 15_000; // 15s

    this.lastActivity = Date.now();
    this.reconnectAttempts = 0;
    this.watchdogInterval = null;
    this.stabilizeTimer = null;
    this.globalGuardsInstalled = false;
  }

  /**
   * Installs process-wide unhandledRejection and uncaughtException guards
   * to absorb transient network noise without terminating the Node.js process.
   */
  installGlobalCrashGuards() {
    if (this.globalGuardsInstalled) return;
    this.globalGuardsInstalled = true;

    process.on('unhandledRejection', (reason) => {
      const msg = reason?.message || String(reason || '');
      const code = reason?.code || '';

      if (code === 'ENOSPC') {
        this.logger.error('SISTEM', 'FATAL: Disk penuh (ENOSPC)! Menghentikan proses secara aman...');
        setTimeout(() => process.exit(1), 1000);
        return;
      }

      if (code === 'ENOMEM') {
        this.logger.error('SISTEM', 'FATAL: Memori habis (ENOMEM)! Menghentikan proses secara aman...');
        setTimeout(() => process.exit(1), 1000);
        return;
      }

      const isTransient = TRANSIENT_NETWORK_ERRORS.some(
        (errKey) => msg.includes(errKey) || code === errKey
      );

      if (isTransient) {
        this.logger.debug('NET', `Transient network unhandled rejection diserap: ${msg || code}`);
      } else {
        this.logger.warn('SISTEM', `Unhandled Rejection: ${msg}`, reason?.stack || '');
      }
    });

    process.on('uncaughtException', (err) => {
      const msg = err?.message || String(err || '');
      const code = err?.code || '';

      if (code === 'ENOSPC' || code === 'ENOMEM') {
        this.logger.error('SISTEM', `FATAL: ${code} terdeteksi! Menghentikan proses...`);
        setTimeout(() => process.exit(1), 1000);
        return;
      }

      const isTransient = TRANSIENT_NETWORK_ERRORS.some(
        (errKey) => msg.includes(errKey) || code === errKey
      );

      if (isTransient) {
        this.logger.debug('NET', `Transient network uncaught exception diserap: ${msg || code}`);
      } else {
        this.logger.error('SISTEM', `Uncaught Exception: ${msg}`, err?.stack || '');
      }
    });
  }

  /**
   * Attach listener guard directly to the WebSocket instance of Baileys.
   */
  guardWebSocket(ws) {
    if (!ws || typeof ws.on !== 'function') return;

    ws.on('error', (err) => {
      const msg = err?.message || String(err || '');
      const isTransient = TRANSIENT_NETWORK_ERRORS.some((key) => msg.includes(key));
      if (isTransient) {
        this.logger.debug('NET', `WebSocket error diserap: ${msg}`);
      } else {
        this.logger.warn('NET', `WebSocket error: ${msg}`);
      }
    });
  }

  /**
   * Updates the last activity timestamp whenever any Baileys event is received.
   */
  touch() {
    this.lastActivity = Date.now();
  }

  /**
   * Starts the internal watchdog timer to detect hung or frozen connections.
   * Only triggers if socket is actively marked connected/online.
   * @param {Function} onIdleTimeout - Callback when idle exceeds threshold.
   * @param {Function} [isConnectedCheck] - Function returning boolean whether socket is online.
   */
  startWatchdog(onIdleTimeout, isConnectedCheck) {
    this.stopWatchdog();
    this.touch();

    this.watchdogInterval = setInterval(() => {
      // Do not trigger watchdog while waiting for user to pair or during initial handshake
      if (typeof isConnectedCheck === 'function' && !isConnectedCheck()) {
        this.touch();
        return;
      }

      const idleTime = Date.now() - this.lastActivity;
      if (idleTime > this.idleTimeoutMs) {
        this.logger.warn(
          'WATCHDOG',
          `Koneksi idle selama ${Math.round(idleTime / 1000)}s (> ${this.idleTimeoutMs / 1000}s). Memulai restart aman...`
        );
        this.touch();
        if (typeof onIdleTimeout === 'function') {
          onIdleTimeout();
        }
      }
    }, 30_000);

    if (this.watchdogInterval.unref) {
      this.watchdogInterval.unref();
    }
  }

  /**
   * Stops the watchdog timer.
   */
  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Mark connection as stabilized; resets reconnect attempts after stabilize delay.
   */
  markConnected() {
    this.touch();
    if (this.stabilizeTimer) {
      clearTimeout(this.stabilizeTimer);
    }
    this.stabilizeTimer = setTimeout(() => {
      if (this.reconnectAttempts > 0) {
        this.logger.info('SISTEM', `Koneksi stabil selama ${this.stabilizeDelayMs / 1000}s. Counter reconnect di-reset ke 0.`);
        this.reconnectAttempts = 0;
      }
    }, this.stabilizeDelayMs);

    if (this.stabilizeTimer.unref) {
      this.stabilizeTimer.unref();
    }
  }

  /**
   * Classify disconnection and determine reconnect action and backoff delay.
   * Takes context into account to avoid false-positive logouts during initial pairing!
   * @param {object} lastDisconnect - The lastDisconnect object from Baileys connection.update.
   * @param {object} [context={}] - Context { isNewLogin, isPairingAuth, wasConnected, consecutive401s }
   * @returns {{ shouldReconnect: boolean, isLoggedOut: boolean, isStreamConflict: boolean, delayMs: number, reasonText: string }}
   */
  classifyDisconnect(lastDisconnect, context = {}) {
    const error = lastDisconnect?.error;
    const statusCode = error?.output?.statusCode;
    const errorMsg = error?.message || String(error || '');

    const isNewLogin = Boolean(context.isNewLogin);
    const wasConnected = Boolean(context.wasConnected);
    const isPairingAuth = Boolean(context.isPairingAuth);
    const consecutive401s = context.consecutive401s || 0;

    // 1. Mandatory Post-Pairing Restart
    // When WhatsApp finishes pairing code verification, it intentionally restarts the socket.
    if (isNewLogin) {
      this.reconnectAttempts = 0;
      return {
        shouldReconnect: true,
        isLoggedOut: false,
        isStreamConflict: false,
        delayMs: 1500,
        reasonText: 'Pairing terverifikasi! Melakukan restart koneksi otomatis untuk sinkronisasi kredensial...',
      };
    }

    // 2. Restart Required (515) - Immediate fast reconnect
    if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
      return {
        shouldReconnect: true,
        isLoggedOut: false,
        isStreamConflict: false,
        delayMs: 1200,
        reasonText: 'Restart Required (515) - Menyambungkan kembali soket WhatsApp.',
      };
    }

    // 3. Logged Out (401)
    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
      // CRITICAL FIX: During initial pairing handshake, WhatsApp closes the temporary socket
      // with a 401 before the companion session completes. Do NOT treat as permanent logout
      // unless the session was previously registered and online, or 401 persists repeatedly!
      if (!wasConnected || isPairingAuth) {
        if (consecutive401s <= 2) {
          return {
            shouldReconnect: true,
            isLoggedOut: false,
            isStreamConflict: false,
            delayMs: 2000,
            reasonText: 'Koneksi pairing terputus (401 handshake sementara). Menyambungkan ulang dengan kredensial tersimpan...',
          };
        }
      }

      // Permanent logout confirmed after active session was invalidated
      return {
        shouldReconnect: false,
        isLoggedOut: true,
        isStreamConflict: false,
        delayMs: 0,
        reasonText: 'Logged Out (401) - Sesi tidak valid atau telah dicabut dari WhatsApp.',
      };
    }

    // 4. Stream Conflict (440)
    const isStreamConflict =
      statusCode === DisconnectReason.connectionReplaced ||
      statusCode === 440 ||
      /conflict/i.test(errorMsg) ||
      /stream replaced/i.test(errorMsg);

    if (isStreamConflict) {
      this.reconnectAttempts++;
      return {
        shouldReconnect: true,
        isLoggedOut: false,
        isStreamConflict: true,
        delayMs: this.streamConflictDelayMs,
        reasonText: `Stream Conflict (440) - Akun dibuka di perangkat lain. Menunggu jeda ${this.streamConflictDelayMs / 1000}s...`,
      };
    }

    // 5. General transient disconnections (428 connectionClosed, 408 timedOut, 500 badSession, etc.)
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxConsecutiveRestarts) {
      this.logger.error('SISTEM', `FATAL: Melebihi batas maksimum reconnect (${this.maxConsecutiveRestarts}x). Menghentikan proses.`);
      process.exit(1);
    }

    const jitter = Math.floor(Math.random() * 1000);
    const exponential = this.initialBackoffMs * Math.pow(1.3, Math.min(this.reconnectAttempts, 6));
    const delayMs = Math.min(this.maxBackoffMs, Math.round(exponential)) + jitter;

    const reasonName = Object.entries(DisconnectReason).find(([, val]) => val === statusCode)?.[0] || 'Unknown';

    return {
      shouldReconnect: true,
      isLoggedOut: false,
      isStreamConflict: false,
      delayMs,
      reasonText: `Disconnect ${statusCode || 'N/A'} (${reasonName}): ${errorMsg || 'Koneksi terputus'}. Reconnect dalam ${Math.round(delayMs / 1000)}s...`,
    };
  }

  /**
   * Safely ends a socket instance, detaches listeners, and closes WS to prevent leaks.
   * @param {object} sock - Baileys socket instance.
   * @param {string} tag - Reason/identifier for ending the socket.
   */
  safelyEndSocket(sock, tag = 'SafeDisconnect') {
    if (!sock) return;

    try {
      if (sock.ws && typeof sock.ws.removeAllListeners === 'function') {
        sock.ws.removeAllListeners('error');
        sock.ws.removeAllListeners('close');
      }

      if (typeof sock.end === 'function') {
        sock.end(new Error(tag));
      }

      if (sock.ws && typeof sock.ws.close === 'function') {
        try {
          sock.ws.close();
        } catch {
          // Ignore close errors
        }
      }
    } catch (err) {
      this.logger.debug('SISTEM', `safelyEndSocket [${tag}] non-fatal error: ${err.message}`);
    }
  }

  /**
   * Reset all guard timers.
   */
  destroy() {
    this.stopWatchdog();
    if (this.stabilizeTimer) {
      clearTimeout(this.stabilizeTimer);
      this.stabilizeTimer = null;
    }
  }
}

export const connectionGuard = new ConnectionGuard();
export default connectionGuard;
