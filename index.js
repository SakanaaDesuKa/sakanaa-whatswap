/**
 * Sakanaa-Whatswap (v2.0)
 * Production-grade, resilient, and Termux-compatible WhatsApp multi-device library wrapping Baileys v7.
 *
 * @license MIT
 * @copyright 2026 Sakanaa Team
 */

import { BaileysConnection } from './src/core/BaileysConnection.js';
import { ConnectionGuard, connectionGuard } from './src/core/connectionGuard.js';
import { AuthManager, authManager } from './src/core/authManager.js';
import { Logger, logger } from './src/core/logger.js';

import { MessageBuilder, messageBuilder } from './src/messaging/messageBuilder.js';
import { MediaProcessor, mediaProcessor } from './src/messaging/mediaProcessor.js';
import { RateLimiter, rateLimiter } from './src/messaging/rateLimiter.js';

import { LidPnResolver, lidPnResolver } from './src/identity/lidPnResolver.js';
import {
  normalizeJid,
  isSameJid,
  toPnJid,
  toLidJid,
  extractPhoneNumber,
  extractSenderInfo,
  getJidType,
  jidDecode,
  jidEncode,
  jidNormalizedUser,
  areJidsSameUser,
  isPnUser,
  isLidUser,
  isHostedPnUser,
  isHostedLidUser,
  isJidMetaAI,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
} from './src/identity/jidUtils.js';

import { GroupMetadataCache, groupMetadataCache } from './src/groups/groupMetadataCache.js';
import { watchAndReload } from './src/utils/hotReload.js';

import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  proto,
  generateWAMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  generateMessageID,
} from '@whiskeysockets/baileys';

import {
  Button,
  ButtonV2,
  Carousel,
  AIRich,
  Toolkit,
  VERSION,
  VERSION as interactiveVersion,
} from './src/builder/MessageBuilder.js';

import {
  makeSticker,
  createStickerWithWatermark,
  buildExifBuffer,
  injectExif,
  writeExif,
  stickerLib,
} from './src/messaging/stickerLib.js';

export {
  // Core
  BaileysConnection,
  ConnectionGuard,
  connectionGuard,
  AuthManager,
  authManager,
  Logger,
  logger,

  // Messaging & Media
  MessageBuilder,
  messageBuilder,
  MediaProcessor,
  mediaProcessor,
  RateLimiter,
  rateLimiter,

  // Interactive Message Builder (MessageBuilder 4.7)
  Button,
  ButtonV2,
  Carousel,
  AIRich,
  Toolkit,
  VERSION,
  interactiveVersion,

  // Sticker Engine & Watermark (stickerLib)
  makeSticker,
  createStickerWithWatermark,
  buildExifBuffer,
  injectExif,
  writeExif,
  stickerLib,

  // Identity & JID
  LidPnResolver,
  lidPnResolver,
  normalizeJid,
  isSameJid,
  toPnJid,
  toLidJid,
  extractPhoneNumber,
  extractSenderInfo,
  getJidType,
  jidDecode,
  jidEncode,
  jidNormalizedUser,
  areJidsSameUser,
  isPnUser,
  isLidUser,
  isHostedPnUser,
  isHostedLidUser,
  isJidMetaAI,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,

  // Groups
  GroupMetadataCache,
  groupMetadataCache,

  // Utils
  watchAndReload,

  // Baileys Re-exports
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  proto,
  generateWAMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  generateMessageID,
};

export default BaileysConnection;
