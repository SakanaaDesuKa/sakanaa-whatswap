/**
 * Sakanaa-Whatswap - Core Logger
 * ANSI-colored, tag-based console logger with modular support for custom log streams.
 */

import pino from 'pino';

// ANSI Color Codes
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
};

const TAG_COLORS = {
  'SISTEM': `${COLORS.cyan}[ SISTEM ]${COLORS.reset}`,
  'WATCHDOG': `${COLORS.yellow}[WATCHDOG]${COLORS.reset}`,
  'NET': `${COLORS.blue}[  NET   ]${COLORS.reset}`,
  'AUTH': `${COLORS.green}[  AUTH  ]${COLORS.reset}`,
  'MSG': `${COLORS.magenta}[  MSG   ]${COLORS.reset}`,
  'GROUP': `${COLORS.cyan}[ GROUP  ]${COLORS.reset}`,
  'LIMIT': `${COLORS.yellow}[ LIMIT  ]${COLORS.reset}`,
  'ERROR': `${COLORS.red}${COLORS.bold}[ ERROR  ]${COLORS.reset}`,
  'SUCCESS': `${COLORS.green}${COLORS.bold}[SUCCESS ]${COLORS.reset}`,
  'WARN': `${COLORS.yellow}${COLORS.bold}[  WARN  ]${COLORS.reset}`,
  'DEBUG': `${COLORS.gray}[ DEBUG  ]${COLORS.reset}`,
};

export class Logger {
  constructor(options = {}) {
    this.silent = Boolean(options.silent);
    this.level = options.level || 'info'; // 'debug' | 'info' | 'warn' | 'error' | 'silent'
    this.customLogger = options.customLogger || null;
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  }

  getTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const h = pad(now.getHours());
    const m = pad(now.getMinutes());
    const s = pad(now.getSeconds());
    return `${COLORS.gray}${h}:${m}:${s}${COLORS.reset}`;
  }

  formatTag(rawTag) {
    const upper = String(rawTag || 'SISTEM').toUpperCase().trim();
    return TAG_COLORS[upper] || `${COLORS.cyan}[ ${upper.padEnd(6, ' ').slice(0, 6)} ]${COLORS.reset}`;
  }

  printBanner() {
    if (this.silent) return;
    const banner = `
${COLORS.cyan}${COLORS.bold}╔══════════════════════════════════════════════╗
║          SAKANAA - WHATSWAP v2.0             ║
║    Resilient Baileys v7 Connection Layer     ║
║      Termux & Linux Multi-Platform Ready     ║
╚══════════════════════════════════════════════╝${COLORS.reset}
`;
    console.log(banner);
  }

  log(level, tag, ...args) {
    if (this.silent || this.level === 'silent') return;

    if (this.customLogger && typeof this.customLogger[level] === 'function') {
      this.customLogger[level](`[${tag}]`, ...args);
      return;
    }

    if (this.onEvent) {
      this.onEvent({ level, tag, args, timestamp: Date.now() });
    }

    const time = this.getTimestamp();
    const tagFormatted = this.formatTag(tag);

    switch (level) {
      case 'error':
        console.error(`${time} ${tagFormatted}`, ...args);
        break;
      case 'warn':
        if (this.level !== 'error') {
          console.warn(`${time} ${tagFormatted}`, ...args);
        }
        break;
      case 'debug':
        if (this.level === 'debug') {
          console.debug(`${time} ${tagFormatted}`, ...args);
        }
        break;
      default:
        if (this.level !== 'warn' && this.level !== 'error') {
          console.log(`${time} ${tagFormatted}`, ...args);
        }
        break;
    }
  }

  info(tag, ...args) {
    this.log('info', tag, ...args);
  }

  success(tag, ...args) {
    this.log('info', tag || 'SUCCESS', ...args);
  }

  warn(tag, ...args) {
    this.log('warn', tag || 'WARN', ...args);
  }

  error(tag, ...args) {
    this.log('error', tag || 'ERROR', ...args);
  }

  debug(tag, ...args) {
    this.log('debug', tag || 'DEBUG', ...args);
  }

  createPino(level = 'silent') {
    return pino({ level });
  }
}

export const logger = new Logger();
export default logger;
