/**
 * Sakanaa-Whatswap - Baileys Connection
 * Master wrapper class providing resilient, production-grade connection handling for Baileys v7.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

import { Logger, logger as defaultLogger } from './logger.js';
import { AuthManager, authManager as defaultAuthManager } from './authManager.js';
import { ConnectionGuard } from './connectionGuard.js';
import { LidPnResolver, lidPnResolver as defaultLidPnResolver } from '../identity/lidPnResolver.js';
import { GroupMetadataCache, groupMetadataCache as defaultGroupMetadataCache } from '../groups/groupMetadataCache.js';
import { RateLimiter, rateLimiter as defaultRateLimiter } from '../messaging/rateLimiter.js';
import { MediaProcessor, mediaProcessor as defaultMediaProcessor } from '../messaging/mediaProcessor.js';
import { MessageBuilder, messageBuilder as defaultMessageBuilder } from '../messaging/messageBuilder.js';
import { toPnJid, jidNormalizedUser } from '../identity/jidUtils.js';

class RetryCounterCache {
  constructor(ttlMs = 300_000) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const item = this.map.get(key);
    if (!item) return undefined;
    if (Date.now() > item.exp) {
      this.map.delete(key);
      return undefined;
    }
    return item.val;
  }
  set(key, val) {
    this.map.set(key, { val, exp: Date.now() + this.ttlMs });
  }
  del(key) {
    this.map.delete(key);
  }
}

export class BaileysConnection extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.sessionName = options.sessionName || 'session';
    this.autoReconnect = options.autoReconnect !== false;
    this.baileysLogLevel = options.baileysLogLevel || 'silent';
    this.pairingNumber = options.pairingNumber || null;
    this.authType = options.authType || 'qr'; // 'pairing' | 'qr'

    // Device identity MUST BE NEUTRAL per Section 5.4 & Section 15
    this.browser = options.browser || Browsers.ubuntu('Chrome');

    // Logger initialization
    if (options.logger instanceof Logger) {
      this.logger = options.logger;
    } else if (options.logger) {
      this.logger = new Logger({ customLogger: options.logger, silent: options.silent });
    } else {
      this.logger = new Logger({ silent: options.silent });
    }

    // Submodules
    this.authManager = options.authManager || new AuthManager({ logger: this.logger });
    this.connectionGuard = new ConnectionGuard({
      logger: this.logger,
      idleTimeoutMs: options.idleTimeoutMs || 240_000,
      maxConsecutiveRestarts: options.maxConsecutiveRestarts || 15,
    });
    this.lidPnResolver = options.lidPnResolver || defaultLidPnResolver;
    this.groupMetadataCache = options.groupMetadataCache || defaultGroupMetadataCache;
    this.rateLimiter = options.rateLimiter || new RateLimiter({
      logger: this.logger,
      messageDelay: options.messageDelay !== undefined ? options.messageDelay : 'auto',
    });
    this.mediaProcessor = options.mediaProcessor || new MediaProcessor({
      logger: this.logger,
      pack: options.stickerPackName,
      author: options.stickerAuthorName,
    });
    this.messageBuilder = new MessageBuilder({
      logger: this.logger,
      mediaProcessor: this.mediaProcessor,
      rateLimiter: this.rateLimiter,
    });

    // Message store & retry cache for getMessage (mandatory in Baileys v7)
    this.messageCache = new Map(); // id -> message
    this.msgRetryCounterCache = new RetryCounterCache();

    // Socket & Auth State
    this.sock = null;
    this.authState = null;
    this.saveCreds = null;
    this.clearSession = null;
    this.isConnecting = false;
    this.isConnected = false;
    this.hasBeenConnected = false;
    this.isManualDisconnect = false;
    this.isReconnecting = false;
    this.pairingRequested = false;
    this.isNewLogin = false;
    this.isPairingAuth = false;
    this.consecutive401s = 0;

    // Heartbeat timer for keeping cellular NAT open
    this.heartbeatInterval = null;

    // Termux background wake lock
    this.wakeLockAcquired = false;
    this.setupTermuxWakeLock();

    // Graceful shutdown handling
    this.setupGracefulShutdown();

    // Install global crash guards
    this.connectionGuard.installGlobalCrashGuards();
  }

  /**
   * Acquire Termux wake lock if running in Termux to prevent Android from sleeping the process.
   */
  setupTermuxWakeLock() {
    const isTermux =
      Boolean(process.env.TERMUX_VERSION) ||
      fs.existsSync('/data/data/com.termux/files/usr/bin/termux-wake-lock');

    if (isTermux && !this.wakeLockAcquired) {
      try {
        const proc = spawn('/data/data/com.termux/files/usr/bin/termux-wake-lock', [], {
          detached: true,
          stdio: 'ignore',
        });
        proc.unref();
        this.wakeLockAcquired = true;
        this.logger.info('SISTEM', 'Termux Wake-Lock diaktifkan (mencegah Android Doze/sleep).');
      } catch (err) {
        this.logger.debug('SISTEM', `Gagal mengaktifkan wake-lock: ${err.message}`);
      }
    }
  }

  /**
   * Release Termux wake lock on shutdown.
   */
  releaseTermuxWakeLock() {
    if (this.wakeLockAcquired) {
      try {
        spawn('/data/data/com.termux/files/usr/bin/termux-wake-unlock', [], {
          detached: true,
          stdio: 'ignore',
        });
        this.wakeLockAcquired = false;
      } catch {
        // ignore
      }
    }
  }

  /**
   * Heartbeat presence timer to prevent cellular carrier NAT timeouts.
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (this.sock && this.isConnected) {
        try {
          await this.sock.sendPresenceUpdate('available');
        } catch (err) {
          this.logger.debug('NET', `Heartbeat presence error: ${err.message}`);
        }
      }
    }, 45_000); // 45 seconds keeps mobile NAT alive

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Set custom cache adapter for LID/PN resolutions.
   */
  setCacheAdapter(adapter) {
    this.lidPnResolver.setCacheAdapter(adapter);
  }

  /**
   * Return the active Baileys socket instance.
   */
  getSocket() {
    return this.sock;
  }

  /**
   * Connect using phone number pairing code.
   * @param {string|number} phoneNumber
   * @param {object} [opts={}]
   */
  async connectWithPairing(phoneNumber, opts = {}) {
    this.authType = 'pairing';
    this.isPairingAuth = true;
    this.pairingRequested = false;
    this.pairingNumber = String(phoneNumber || '').replace(/\D/g, '');
    if (!this.pairingNumber) {
      throw new Error('Nomor telepon pairing tidak valid.');
    }
    this.options = { ...this.options, ...opts };
    return this._initConnection();
  }

  /**
   * Connect using Terminal QR code.
   * @param {object} [opts={}]
   */
  async connectWithQR(opts = {}) {
    this.authType = 'qr';
    this.isPairingAuth = false;
    this.pairingNumber = null;
    this.options = { ...this.options, ...opts };
    return this._initConnection();
  }

  /**
   * Core initialization and connection logic.
   */
  async _initConnection() {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.isManualDisconnect = false;
    this.pairingRequested = false;

    this.logger.printBanner();
    this.logger.info('SISTEM', `Menyiapkan sesi '${this.sessionName}'...`);

    const pinoLogger = this.logger.createPino(this.baileysLogLevel);
    const { state, saveCreds, clearSession } = await this.authManager.initAuth(
      this.sessionName,
      pinoLogger
    );

    this.authState = state;
    this.saveCreds = saveCreds;
    this.clearSession = clearSession;

    await this._createSocket();
  }

  /**
   * Instantiates Baileys socket with required v7 configurations.
   */
  async _createSocket() {
    const pinoLogger = this.logger.createPino(this.baileysLogLevel);

    // Socket configuration tailored for mobile/Termux & Linux stability
    const socketConfig = {
      logger: pinoLogger,
      auth: this.authState,
      browser: this.browser,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      fireInitQueries: true,
      generateHighQualityLinkPreview: true,
      msgRetryCounterCache: this.msgRetryCounterCache,
      keepAliveIntervalMs: 25_000, // 25s for responsive cellular ping
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 5,

      // Mandatory getMessage callback for retry/poll/quotes (Section 2.2)
      getMessage: async (key) => {
        const cached = this.messageCache.get(key.id);
        if (cached) return cached;
        return undefined;
      },

      // Mandatory cachedGroupMetadata to prevent live fetches on every send (Section 2.4 & 8)
      cachedGroupMetadata: async (jid) => {
        return this.groupMetadataCache.get(jid);
      },

      ...this.options.customSocketConfig,
    };

    this.sock = makeWASocket(socketConfig);

    // Guard WebSocket
    if (this.sock.ws) {
      this.connectionGuard.guardWebSocket(this.sock.ws);
    }

    // Bind modules to socket events
    this.lidPnResolver.bindSocketEvents(this.sock);
    this.groupMetadataCache.bindSocketEvents(this.sock);

    // Socket injection extensions (sendAlbum, sendStickerPack)
    this.sock.sendAlbum = (jid, items, opts) => this.sendAlbum(jid, items, opts);
    this.sock.sendStickerPack = (jid, packData, opts) => this.sendStickerPack(jid, packData, opts);

    // Bind internal events
    this._bindEvents();

    // Start Watchdog timer (only active while online/connected)
    this.connectionGuard.startWatchdog(
      () => {
        this.logger.warn('WATCHDOG', 'Idle watchdog memicu restart koneksi...');
        this._reconnect();
      },
      () => this.isConnected
    );

    // Check if pairing code needs to be requested
    const isRegistered = Boolean(this.authState?.creds?.registered);
    if (
      this.authType === 'pairing' &&
      this.pairingNumber &&
      !isRegistered &&
      !this.pairingRequested
    ) {
      this.pairingRequested = true;
      this.logger.info('AUTH', `Menyiapkan permintaan Pairing Code untuk +${this.pairingNumber}...`);

      setTimeout(async () => {
        try {
          if (this.authState?.creds?.registered) return;
          const rawCode = await this.sock.requestPairingCode(this.pairingNumber);
          const formattedCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
          this.logger.success('AUTH', `KODE PAIRING WHATSAPP: ${formattedCode}`);
          this.emit('pairing-code', formattedCode);
        } catch (err) {
          this.logger.error('AUTH', `Gagal meminta pairing code: ${err.message}`);
          this.pairingRequested = false;
        }
      }, 3000);
    }

    this.isConnecting = false;
  }

  /**
   * Internal event bindings for the socket.
   */
  _bindEvents() {
    const sock = this.sock;

    // Save auth credentials to disk
    sock.ev.on('creds.update', async (update) => {
      this.connectionGuard.touch();
      if (update?.me?.id) {
        this.logger.info('AUTH', `Identitas bot terdaftar: ${update.me.id}`);
      }
      if (this.saveCreds) {
        try {
          await this.saveCreds();
        } catch (err) {
          this.logger.error('AUTH', 'Gagal menulis creds.json:', err.message);
        }
      }
    });

    // Cache incoming & outgoing messages for getMessage retry handling
    sock.ev.on('messages.upsert', ({ messages }) => {
      this.connectionGuard.touch();
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (msg?.key?.id && msg?.message) {
            this.messageCache.set(msg.key.id, msg.message);
            // Prune cache if over 1000 items
            if (this.messageCache.size > 1000) {
              const firstKey = this.messageCache.keys().next().value;
              this.messageCache.delete(firstKey);
            }
          }
        }
      }
      this.emit('messages.upsert', { messages });
    });

    // Forward other Baileys events to this instance
    const eventsToForward = [
      'messages.update',
      'message-receipt.update',
      'presence.update',
      'chats.update',
      'contacts.update',
      'contacts.upsert',
      'groups.update',
      'group-participants.update',
      'call',
    ];
    for (const evt of eventsToForward) {
      sock.ev.on(evt, (arg) => {
        this.connectionGuard.touch();
        this.emit(evt, arg);
      });
    }

    // Connection update handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      this.connectionGuard.touch();
      this.emit('connection.update', update);

      // Pairing success signal from Baileys
      if (isNewLogin) {
        this.isNewLogin = true;
        this.logger.success('AUTH', 'Pairing terverifikasi oleh server WhatsApp! Menyiapkan login...');
      }

      // Handle QR Code
      if (qr && this.authType === 'qr') {
        this.logger.info('AUTH', 'Silakan scan QR Code di bawah menggunakan WhatsApp Anda:');
        qrcode.generate(qr, { small: true });
        this.emit('qr', qr);
      }

      // Connection Open
      if (connection === 'open') {
        this.isConnected = true;
        this.hasBeenConnected = true;
        this.consecutive401s = 0;
        this.isNewLogin = false;
        this.connectionGuard.markConnected();
        this.startHeartbeat();

        // Send active presence update to WhatsApp
        sock.sendPresenceUpdate('available').catch(() => {});

        this.logger.success('NET', 'Koneksi WhatsApp berhasil dibuka (STATUS: ONLINE)!');
        this.emit('open', { user: sock.user });
        this.emit('ready', { user: sock.user });
      }

      // Connection Close
      if (connection === 'close') {
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('close', lastDisconnect);

        if (this.isManualDisconnect) {
          this.logger.info('SISTEM', 'Koneksi ditutup secara manual.');
          return;
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === 401) {
          this.consecutive401s++;
        }

        const classification = this.connectionGuard.classifyDisconnect(lastDisconnect, {
          isNewLogin: this.isNewLogin,
          isPairingAuth: this.isPairingAuth,
          wasConnected: this.hasBeenConnected,
          consecutive401s: this.consecutive401s,
        });

        this.logger.warn('NET', classification.reasonText);

        if (classification.isLoggedOut) {
          this.logger.error('AUTH', 'Sesi telah logout permanen. Membersihkan folder sesi...');
          if (this.clearSession) {
            this.clearSession();
          }
          this.emit('logout');
          return; // Stop reconnecting on genuine loggedOut
        }

        if (classification.shouldReconnect && this.autoReconnect) {
          this.logger.info('NET', `Menyambungkan kembali dalam ${Math.round(classification.delayMs / 1000)}s...`);
          setTimeout(async () => {
            try {
              await this._reconnect();
            } catch (err) {
              this.logger.error('NET', `Gagal rekoneksi: ${err.message}`);
            }
          }, classification.delayMs);
        }
      }
    });
  }

  /**
   * Reconnects socket cleanly, reloading fresh auth credentials from disk.
   */
  async _reconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;

    try {
      this.stopHeartbeat();
      if (this.sock) {
        this.connectionGuard.safelyEndSocket(this.sock, 'ReconnectCycle');
        this.sock = null;
      }

      // Reload fresh credentials from disk
      const pinoLogger = this.logger.createPino(this.baileysLogLevel);
      const { state, saveCreds, clearSession } = await this.authManager.initAuth(
        this.sessionName,
        pinoLogger
      );
      this.authState = state;
      this.saveCreds = saveCreds;
      this.clearSession = clearSession;

      await this._createSocket();
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Gracefully disconnects the connection.
   */
  async disconnect(reason = 'Manual Disconnect') {
    this.isManualDisconnect = true;
    this.stopHeartbeat();
    this.connectionGuard.destroy();
    if (this.sock) {
      this.connectionGuard.safelyEndSocket(this.sock, reason);
      this.sock = null;
    }
    this.isConnected = false;
    this.releaseTermuxWakeLock();
    this.logger.info('SISTEM', `Koneksi dihentikan: ${reason}`);
  }

  /**
   * Setup SIGINT / SIGTERM signals for clean graceful termination.
   */
  setupGracefulShutdown() {
    const handleSignal = async (signal) => {
      this.logger.info('SISTEM', `Sinyal ${signal} diterima. Memulai graceful shutdown...`);
      try {
        await this.disconnect(signal);
        this.mediaProcessor.cleanupAllTmp();
        this.logger.success('SISTEM', 'Shutdown selesai secara bersih.');
      } catch (err) {
        this.logger.error('SISTEM', `Error saat graceful shutdown: ${err.message}`);
      } finally {
        process.exit(0);
      }
    };

    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
  }

  // ==========================================
  // CONVENIENCE MESSAGING METHODS
  // ==========================================

  async sendText(jid, text, opts) {
    return this.messageBuilder.sendText(this.sock, jid, text, opts);
  }

  async sendImg(jid, src, caption, opts) {
    return this.messageBuilder.sendImg(this.sock, jid, src, caption, opts);
  }

  async sendVideo(jid, src, caption, opts) {
    return this.messageBuilder.sendVideo(this.sock, jid, src, caption, opts);
  }

  async sendvid(jid, src, caption, opts) {
    return this.messageBuilder.sendvid(this.sock, jid, src, caption, opts);
  }

  async sendVoice(jid, src, opts) {
    return this.messageBuilder.sendVoice(this.sock, jid, src, opts);
  }

  async sendAudio(jid, src, opts) {
    return this.messageBuilder.sendAudio(this.sock, jid, src, opts);
  }

  async sendSticker(jid, src, opts) {
    return this.messageBuilder.sendSticker(this.sock, jid, src, opts);
  }

  async sendsticker(jid, src, opts) {
    return this.messageBuilder.sendsticker(this.sock, jid, src, opts);
  }

  async sendPackSticker(jid, arraySrc, opts) {
    return this.messageBuilder.sendPackSticker(this.sock, jid, arraySrc, opts);
  }

  async sendAlbum(jid, items = [], opts = {}) {
    return this.messageBuilder.sendAlbum(this.sock, jid, items, opts);
  }

  async sendStickerPack(jid, packData = {}, opts = {}) {
    return this.messageBuilder.sendStickerPack(this.sock, jid, packData, opts);
  }

  async sendDoc(jid, src, filename, mime, caption, opts) {
    return this.messageBuilder.sendDoc(this.sock, jid, src, filename, mime, caption, opts);
  }

  async sendPoll(jid, name, options, selectableCount, opts) {
    return this.messageBuilder.sendPoll(this.sock, jid, name, options, selectableCount, opts);
  }

  async sendContact(jid, contactData, opts) {
    return this.messageBuilder.sendContact(this.sock, jid, contactData, opts);
  }

  async react(jid, key, emoji) {
    return this.messageBuilder.react(this.sock, jid, key, emoji);
  }

  async unreact(jid, key) {
    return this.messageBuilder.unreact(this.sock, jid, key);
  }

  async editMessage(jid, key, newText) {
    return this.messageBuilder.editMessage(this.sock, jid, key, newText);
  }

  async deleteMessage(jid, key) {
    return this.messageBuilder.deleteMessage(this.sock, jid, key);
  }

  async sendStatus(content, statusJidList, opts) {
    return this.messageBuilder.sendStatus(this.sock, content, statusJidList, opts);
  }

  // ==========================================
  // CONVENIENCE IDENTITY METHODS
  // ==========================================

  async convertPn(pnJidOrNumber) {
    return this.lidPnResolver.convertPn(pnJidOrNumber, this.sock);
  }

  async convertLid(lidJid) {
    return this.lidPnResolver.convertLid(lidJid, this.sock);
  }

  async resolveIdentity(jidOrNumber) {
    return this.lidPnResolver.resolveIdentity(jidOrNumber, this.sock);
  }

  // ==========================================
  // CONVENIENCE GROUP METHODS
  // ==========================================

  async getGroupMetadata(jid, forceRefresh) {
    return this.groupMetadataCache.getGroupMetadata(this.sock, jid, forceRefresh);
  }

  async updateGroupSubject(jid, subject) {
    return this.groupMetadataCache.updateGroupSubject(this.sock, jid, subject);
  }

  async updateGroupDescription(jid, description) {
    return this.groupMetadataCache.updateGroupDescription(this.sock, jid, description);
  }

  async updateGroupSetting(jid, setting) {
    return this.groupMetadataCache.updateGroupSetting(this.sock, jid, setting);
  }

  async getGroupInviteCode(jid) {
    return this.groupMetadataCache.getGroupInviteCode(this.sock, jid);
  }

  async revokeGroupInviteCode(jid) {
    return this.groupMetadataCache.revokeGroupInviteCode(this.sock, jid);
  }

  async acceptGroupInvite(code) {
    return this.groupMetadataCache.acceptGroupInvite(this.sock, code);
  }

  async groupParticipantsUpdate(jid, participants, action) {
    return this.groupMetadataCache.groupParticipantsUpdate(this.sock, jid, participants, action);
  }

  async groupAdd(jid, participants) {
    return this.groupMetadataCache.groupAdd(this.sock, jid, participants);
  }

  async groupKick(jid, participants) {
    return this.groupMetadataCache.groupKick(this.sock, jid, participants);
  }

  async groupPromote(jid, participants) {
    return this.groupMetadataCache.groupPromote(this.sock, jid, participants);
  }

  async groupDemote(jid, participants) {
    return this.groupMetadataCache.groupDemote(this.sock, jid, participants);
  }

  isParticipantAdmin(metadata, participantJid) {
    return this.groupMetadataCache.isParticipantAdmin(metadata, participantJid, this);
  }

  isBotAdmin(metadata) {
    return this.groupMetadataCache.isBotAdmin(this.sock, metadata, this);
  }

  async downloadMediaMessage(message) {
    if (!this.sock) {
      throw new Error('Socket WhatsApp belum terhubung.');
    }
    const pinoLogger = this.logger.createPino(this.baileysLogLevel);
    return await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: pinoLogger,
        reuploadRequest: this.sock.updateMediaMessage,
      }
    );
  }

  // ==========================================
  // PRIVACY & CHAT MANAGEMENT
  // ==========================================

  async fetchPrivacySettings() {
    return this.messageBuilder.fetchPrivacySettings(this.sock);
  }

  async updateLastSeenPrivacy(val) {
    return this.messageBuilder.updateLastSeenPrivacy(this.sock, val);
  }

  async updateOnlinePrivacy(val) {
    return this.messageBuilder.updateOnlinePrivacy(this.sock, val);
  }

  async updateProfilePicturePrivacy(val) {
    return this.messageBuilder.updateProfilePicturePrivacy(this.sock, val);
  }

  async updateStatusPrivacy(val) {
    return this.messageBuilder.updateStatusPrivacy(this.sock, val);
  }

  async updateReadReceiptsPrivacy(val) {
    return this.messageBuilder.updateReadReceiptsPrivacy(this.sock, val);
  }

  async fetchBlocklist() {
    return this.messageBuilder.fetchBlocklist(this.sock);
  }

  async blockUser(jid) {
    return this.messageBuilder.blockUser(this.sock, jid);
  }

  async unblockUser(jid) {
    return this.messageBuilder.unblockUser(this.sock, jid);
  }

  async starMessage(jid, key, star) {
    return this.messageBuilder.starMessage(this.sock, jid, key, star);
  }

  async unstarMessage(jid, key) {
    return this.messageBuilder.unstarMessage(this.sock, jid, key);
  }

  async pinMessage(jid, key, durationSeconds) {
    return this.messageBuilder.pinMessage(this.sock, jid, key, durationSeconds);
  }

  async unpinMessage(jid, key) {
    return this.messageBuilder.unpinMessage(this.sock, jid, key);
  }

  async archiveChat(jid, lastMessages) {
    return this.messageBuilder.archiveChat(this.sock, jid, lastMessages);
  }

  async unarchiveChat(jid, lastMessages) {
    return this.messageBuilder.unarchiveChat(this.sock, jid, lastMessages);
  }

  async muteChat(jid, durationMs, lastMessages) {
    return this.messageBuilder.muteChat(this.sock, jid, durationMs, lastMessages);
  }

  async unmuteChat(jid, lastMessages) {
    return this.messageBuilder.unmuteChat(this.sock, jid, lastMessages);
  }

  async disappearingMessagesInChat(jid, timerSeconds) {
    return this.messageBuilder.disappearingMessagesInChat(this.sock, jid, timerSeconds);
  }

  async rejectCall(callId, callFrom) {
    return this.messageBuilder.rejectCall(this.sock, callId, callFrom);
  }
}

export default BaileysConnection;
