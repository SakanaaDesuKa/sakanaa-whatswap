/**
 * Sakanaa-Whatswap - Auth Manager
 * Manages MultiFileAuthState with cached signal key store and safe session isolation.
 */

import fs from 'fs';
import path from 'path';
import { useMultiFileAuthState, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { logger as defaultLogger } from './logger.js';

export class AuthManager {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
  }

  /**
   * Resolve an absolute or local session path.
   * Ensures paths are isolated and relative to process.cwd() if not absolute.
   */
  resolveSessionPath(sessionPath = 'session') {
    if (path.isAbsolute(sessionPath)) {
      return path.normalize(sessionPath);
    }
    return path.join(process.cwd(), sessionPath);
  }

  /**
   * Initialize MultiFileAuthState with makeCacheableSignalKeyStore.
   * @param {string} [sessionName='session'] - Path or folder name of the session.
   * @param {object} [pinoLogger] - Optional pino logger for key store caching.
   * @returns {Promise<{ state: object, saveCreds: Function, clearSession: Function, sessionPath: string }>}
   */
  async initAuth(sessionName = 'session', pinoLogger) {
    const sessionPath = this.resolveSessionPath(sessionName);

    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const effectivePino = pinoLogger || this.logger.createPino('silent');
    const cachedState = {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, effectivePino),
    };

    return {
      state: cachedState,
      rawState: state,
      saveCreds,
      clearSession: () => this.clearSession(sessionPath),
      sessionPath,
    };
  }

  /**
   * Cleans up local session directory completely upon DisconnectReason.loggedOut (401).
   * @param {string} sessionPath - Resolved path to session folder.
   */
  clearSession(sessionPath) {
    const resolved = this.resolveSessionPath(sessionPath);
    try {
      if (fs.existsSync(resolved)) {
        fs.rmSync(resolved, { recursive: true, force: true });
        this.logger.warn('AUTH', `Sesi di ${resolved} telah berhasil dihapus karena logout permanen.`);
      }
    } catch (err) {
      this.logger.error('AUTH', `Gagal menghapus folder sesi ${resolved}:`, err.message);
    }
  }
}

export const authManager = new AuthManager();
export default authManager;
