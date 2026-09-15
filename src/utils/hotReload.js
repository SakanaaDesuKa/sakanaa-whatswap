/**
 * Sakanaa-Whatswap - Hot Reload Utility
 * Pure-JS file watcher with strict debounce and low CPU/RAM footprint for Termux & Linux.
 */

import fs from 'fs';
import path from 'path';
import { logger as defaultLogger } from '../core/logger.js';

const DEFAULT_IGNORED = [
  'node_modules',
  '.git',
  'session',
  'sessions',
  'auth_info_baileys',
  'tmp',
  '.env',
];

/**
 * Watches a directory for file changes and executes a debounced callback.
 * @param {string} dirPath - Absolute or relative directory path to watch
 * @param {Function} callback - Triggered with (filename, eventType) on change
 * @param {object} [opts={}] - Configuration options
 * @returns {{ close: Function }} Watcher control object
 */
export function watchAndReload(dirPath, callback, opts = {}) {
  const logger = opts.logger || defaultLogger;
  const debounceMs = opts.debounceMs || 500;
  const ignoredPatterns = opts.ignored || DEFAULT_IGNORED;
  const extensions = opts.extensions || ['.js', '.mjs', '.json'];

  const resolvedDir = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);

  if (!fs.existsSync(resolvedDir)) {
    logger.warn('SISTEM', `Direktori hot reload tidak ditemukan: ${resolvedDir}`);
    return { close: () => {} };
  }

  let debounceTimer = null;
  const watchers = [];

  const shouldIgnore = (filePath) => {
    return ignoredPatterns.some((pattern) => filePath.includes(pattern));
  };

  const hasValidExtension = (filename) => {
    if (!filename) return false;
    const ext = path.extname(filename).toLowerCase();
    return extensions.includes(ext);
  };

  const handleChange = (eventType, filename) => {
    if (!filename || shouldIgnore(filename) || !hasValidExtension(filename)) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      logger.info('SISTEM', `Perubahan terdeteksi pada [${filename}] (${eventType}). Mereload...`);
      try {
        if (typeof callback === 'function') {
          callback(filename, eventType);
        }
      } catch (err) {
        logger.error('SISTEM', `Error saat eksekusi hot reload callback: ${err.message}`);
      }
    }, debounceMs);
  };

  try {
    // Try recursive watch first (supported in Node on Linux / Android / macOS)
    const watcher = fs.watch(resolvedDir, { recursive: true }, (eventType, filename) => {
      handleChange(eventType, filename);
    });

    watchers.push(watcher);
    logger.debug('SISTEM', `Hot reload watcher aktif di: ${resolvedDir} (recursive)`);
  } catch {
    // Fallback: watch individual directories
    const watchSubdirs = (current) => {
      if (shouldIgnore(current)) return;
      try {
        const w = fs.watch(current, (eventType, filename) => {
          handleChange(eventType, path.join(path.relative(resolvedDir, current), filename || ''));
        });
        watchers.push(w);

        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            watchSubdirs(path.join(current, entry.name));
          }
        }
      } catch {
        // ignore directory access errors
      }
    };

    watchSubdirs(resolvedDir);
    logger.debug('SISTEM', `Hot reload watcher aktif di: ${resolvedDir} (shallow fallback)`);
  }

  return {
    close: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      logger.debug('SISTEM', 'Hot reload watcher dihentikan.');
    },
  };
}

export default watchAndReload;
