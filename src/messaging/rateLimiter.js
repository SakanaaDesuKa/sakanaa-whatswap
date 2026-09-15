/**
 * Sakanaa-Whatswap - Adaptive Rate Limiter
 * Intelligent rate limiting with fast-path for normal chats and circuit breaker
 * against account restriction (HTTP 463 ReachoutTimelock).
 */

import { EventEmitter } from 'events';
import { logger as defaultLogger } from '../core/logger.js';
import { jidNormalizedUser } from '../identity/jidUtils.js';

export class RateLimiter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = options.logger || defaultLogger;

    // Configuration
    // mode: 'auto' | number (ms) | false
    this.mode = options.messageDelay !== undefined ? options.messageDelay : 'auto';

    // Sliding window settings
    this.windowMs = options.windowMs || 10_000; // 10 seconds sliding window
    this.maxPerJid = options.maxPerJid || 8; // Max messages to same JID within 10s
    this.maxNewJids = options.maxNewJids || 4; // Max new distinct recipients within 10s

    // Adaptive delay parameters
    this.burstDelayMs = options.burstDelayMs || 1_200; // Adaptive pause when burst threshold hit
    this.circuitBreakerCooldownMs = options.circuitBreakerCooldownMs || 45_000; // 45s on restriction warning

    // In-memory sliding window counters
    // jid -> Array of timestamps
    this.jidHistory = new Map();
    // Array of { jid, timestamp }
    this.globalHistory = [];

    // Circuit Breaker State
    this.isCircuitBroken = false;
    this.circuitBrokenUntil = 0;
    this.consecutiveFailures = 0;

    // Periodic cleanup of stale timestamps
    this.cleanupInterval = setInterval(() => this.pruneStaleRecords(), 30_000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Remove records older than the sliding window.
   */
  pruneStaleRecords() {
    const now = Date.now();
    const threshold = now - this.windowMs;

    // Prune global history
    this.globalHistory = this.globalHistory.filter((entry) => entry.timestamp > threshold);

    // Prune per-JID history
    for (const [jid, timestamps] of this.jidHistory.entries()) {
      const active = timestamps.filter((t) => t > threshold);
      if (active.length === 0) {
        this.jidHistory.delete(jid);
      } else {
        this.jidHistory.set(jid, active);
      }
    }
  }

  /**
   * Acquire send permission.
   * Resolves immediately if fast-path, or delays if throttled.
   * @param {string} rawJid
   * @returns {Promise<void>}
   */
  async acquire(rawJid) {
    if (this.mode === false) {
      return; // Limiter completely disabled
    }

    const jid = rawJid ? jidNormalizedUser(rawJid) : 'global';
    const now = Date.now();

    // Check Circuit Breaker
    if (this.isCircuitBroken) {
      if (now < this.circuitBrokenUntil) {
        const remaining = Math.ceil((this.circuitBrokenUntil - now) / 1000);
        this.logger.warn('LIMIT', `Circuit Breaker aktif (Proteksi Akun). Menunggu jeda ${remaining}s...`);
        await new Promise((resolve) => setTimeout(resolve, this.circuitBrokenUntil - now));
      } else {
        this.isCircuitBroken = false;
        this.consecutiveFailures = 0;
        this.logger.info('LIMIT', 'Circuit breaker pulih, melanjutkan pengiriman.');
      }
    }

    // Explicit Static Delay Mode
    if (typeof this.mode === 'number' && this.mode > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.mode));
      this.recordSend(jid);
      return;
    }

    // Adaptive Auto Mode
    this.pruneStaleRecords();
    const threshold = now - this.windowMs;

    // Count messages to this specific JID in the current window
    const jidTimestamps = (this.jidHistory.get(jid) || []).filter((t) => t > threshold);
    const jidCount = jidTimestamps.length;

    // Count distinct recipients in the window
    const distinctJids = new Set(
      this.globalHistory.filter((entry) => entry.timestamp > threshold).map((entry) => entry.jid)
    );
    const isNewRecipient = !distinctJids.has(jid);

    let requiredDelay = 0;

    // Throttle 1: Burst to the same recipient
    if (jidCount >= this.maxPerJid) {
      requiredDelay = Math.max(requiredDelay, this.burstDelayMs);
      this.logger.warn('LIMIT', `Lonjakan pesan ke ${jid} (${jidCount} dlm 10s). Menambahkan rem adaptif ${requiredDelay}ms.`);
    }

    // Throttle 2: Blast to many distinct recipients
    if (isNewRecipient && distinctJids.size >= this.maxNewJids) {
      requiredDelay = Math.max(requiredDelay, this.burstDelayMs * 2);
      this.logger.warn('LIMIT', `Pengiriman ke banyak nomor baru terdeteksi (${distinctJids.size} penerima). Rem adaptif ${requiredDelay}ms diaktifkan.`);
    }

    if (requiredDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, requiredDelay));
    }

    this.recordSend(jid);
  }

  /**
   * Records a message sent timestamp.
   */
  recordSend(jid) {
    const now = Date.now();
    const timestamps = this.jidHistory.get(jid) || [];
    timestamps.push(now);
    this.jidHistory.set(jid, timestamps);
    this.globalHistory.push({ jid, timestamp: now });
  }

  /**
   * Signal successful transmission.
   */
  recordSuccess(jid) {
    this.consecutiveFailures = 0;
  }

  /**
   * Signal failure, checking for HTTP 463 (ReachoutTimelock) or spam restriction signs.
   * @param {string} jid
   * @param {Error|object} error
   */
  recordFailure(jid, error) {
    const statusCode = error?.output?.statusCode || error?.status;
    const msg = String(error?.message || error || '');

    // Error 463 or account reachout restriction
    const isRestricted =
      statusCode === 463 ||
      /reachout/i.test(msg) ||
      /account_reachout_restricted/i.test(msg) ||
      /rate-overlimit/i.test(msg);

    if (isRestricted) {
      this.triggerCircuitBreaker(
        this.circuitBreakerCooldownMs,
        `Sinyal pembatasan akun terdeteksi (${statusCode || '463'}: ${msg}). Mendinginkan antrean pesan.`
      );
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 5) {
      this.triggerCircuitBreaker(
        15_000,
        `Lonjakan 5 kegagalan kirim berturut-turut (${msg}). Mengaktifkan rem pengaman 15 detik.`
      );
    }
  }

  /**
   * Trip the circuit breaker for a given cooldown duration.
   */
  triggerCircuitBreaker(cooldownMs, reason) {
    this.isCircuitBroken = true;
    this.circuitBrokenUntil = Date.now() + cooldownMs;
    this.logger.warn('LIMIT', `[CIRCUIT BREAKER] ${reason}`);
    this.emit('rateLimitWarning', {
      cooldownMs,
      reason,
      until: this.circuitBrokenUntil,
    });
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.jidHistory.clear();
    this.globalHistory = [];
  }
}

export const rateLimiter = new RateLimiter();
export default rateLimiter;
