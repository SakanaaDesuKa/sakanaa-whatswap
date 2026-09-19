/**
 * Sakanaa-Whatswap - Message Builder & Chat Actions
 * Handles high-level messaging methods, media wrappers, and WhatsApp privacy/chat management.
 */

import crypto from 'crypto';
import {
  generateWAMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  generateMessageID,
} from '@whiskeysockets/baileys';
import { logger as defaultLogger } from '../core/logger.js';
import { mediaProcessor as defaultMediaProcessor } from './mediaProcessor.js';
import { rateLimiter as defaultRateLimiter } from './rateLimiter.js';
import { jidNormalizedUser, toPnJid } from '../identity/jidUtils.js';

export class MessageBuilder {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
    this.mediaProcessor = options.mediaProcessor || defaultMediaProcessor;
    this.rateLimiter = options.rateLimiter || defaultRateLimiter;
  }

  /**
   * Internal sender wrapped with rate limiter and circuit breaker monitoring.
   */
  async _sendWithLimit(sock, rawJid, content, opts = {}) {
    if (!sock?.sendMessage) {
      throw new Error('Socket WhatsApp belum terhubung.');
    }

    const jid = jidNormalizedUser(rawJid);
    await this.rateLimiter.acquire(jid);

    try {
      const result = await sock.sendMessage(jid, content, opts);
      this.rateLimiter.recordSuccess(jid);
      return result;
    } catch (err) {
      this.rateLimiter.recordFailure(jid, err);
      throw err;
    }
  }

  /**
   * Send plain text message.
   * @param {object} sock
   * @param {string} jid
   * @param {string} text
   * @param {object} [opts={}]
   */
  async sendText(sock, jid, text, opts = {}) {
    return this._sendWithLimit(sock, jid, { text: String(text || '') }, opts);
  }

  /**
   * Send image message.
   * @param {object} sock
   * @param {string} jid
   * @param {Buffer|string} src - Buffer, local path, or URL
   * @param {string} [caption='']
   * @param {object} [opts={}]
   */
  async sendImg(sock, jid, src, caption = '', opts = {}) {
    const buffer = await this.mediaProcessor.toBuffer(src);
    return this._sendWithLimit(
      sock,
      jid,
      {
        image: buffer,
        caption: caption || undefined,
        ...opts.contentOptions,
      },
      opts
    );
  }

  /**
   * Send video message with automatic H.265 to H.264 transcoding.
   * @param {object} sock
   * @param {string} jid
   * @param {Buffer|string} src
   * @param {string} [caption='']
   * @param {object} [opts={}]
   */
  async sendVideo(sock, jid, src, caption = '', opts = {}) {
    const { buffer, mimetype } = await this.mediaProcessor.processVideo(src);
    return this._sendWithLimit(
      sock,
      jid,
      {
        video: buffer,
        mimetype: mimetype || 'video/mp4',
        caption: caption || undefined,
        ...opts.contentOptions,
      },
      opts
    );
  }

  // Alias for sendVideo
  async sendvid(sock, jid, src, caption = '', opts = {}) {
    return this.sendVideo(sock, jid, src, caption, opts);
  }

  /**
   * Send voice note (PTT) with automatic Ogg/Opus mono transcoding.
   * @param {object} sock
   * @param {string} jid
   * @param {Buffer|string} src
   * @param {object} [opts={}]
   */
  async sendVoice(sock, jid, src, opts = {}) {
    const { buffer, mimetype, ptt } = await this.mediaProcessor.processVoice(src);
    return this._sendWithLimit(
      sock,
      jid,
      {
        audio: buffer,
        mimetype,
        ptt,
        ...opts.contentOptions,
      },
      opts
    );
  }

  /**
   * Send standard audio message (music/speech).
   * @param {object} sock
   * @param {string} jid
   * @param {Buffer|string} src
   * @param {object} [opts={}]
   */
  async sendAudio(sock, jid, src, opts = {}) {
    const buffer = await this.mediaProcessor.toBuffer(src);
    return this._sendWithLimit(
      sock,
      jid,
      {
        audio: buffer,
        mimetype: opts.mimetype || 'audio/mp4',
        ptt: false,
        ...opts.contentOptions,
      },
      opts
    );
  }

  /**
   * Send WebP sticker with EXIF metadata.
   * @param {object} sock
   * @param {string} jid
   * @param {Buffer|string} src
   * @param {object} [opts={}] - { pack, author, categories }
   */
  async sendSticker(sock, jid, src, opts = {}) {
    const stickerBuffer = await this.mediaProcessor.createSticker(src, opts);
    return this._sendWithLimit(
      sock,
      jid,
      {
        sticker: stickerBuffer,
        ...opts.contentOptions,
      },
      opts
    );
  }

  // Alias for sendSticker
  async sendsticker(sock, jid, src, opts = {}) {
    return this.sendSticker(sock, jid, src, opts);
  }

  /**
   * Send a pack of multiple stickers sequentially through the rate limiter.
   * WhatsApp StickerPackMessage is not stable, so stickers are sent in sequence.
   * @param {object} sock
   * @param {string} jid
   * @param {Array<Buffer|string>} arraySrc
   * @param {object} [opts={}]
   */
  async sendPackSticker(sock, jid, arraySrc = [], opts = {}) {
    if (!Array.isArray(arraySrc) || arraySrc.length === 0) {
      throw new Error('Daftar sticker (arraySrc) harus berupa array yang tidak kosong.');
    }

    const results = [];
    for (let i = 0; i < arraySrc.length; i++) {
      const src = arraySrc[i];
      const res = await this.sendSticker(sock, jid, src, opts);
      results.push(res);
      // Small pause between pack items
      if (i < arraySrc.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    return results;
  }

  /**
   * Send media album (multiple images/videos grouped into a single album).
   * Extension not natively in Baileys: creates an albumMessage and relays child media linked by messageAssociation.
   *
   * @param {object} sock - Baileys socket instance
   * @param {string} jid - Recipient JID
   * @param {Array<object>} items - Array of { image?: Buffer|string|object, video?: Buffer|string|object, caption?: string }
   * @param {object} [options={}] - { quoted, relayOptions, ... }
   * @returns {Promise<object>} album - The created and relayed parent album message
   */
  async sendAlbum(sock, jid, items = [], options = {}) {
    if (!sock?.user?.id) {
      throw new Error('Socket WhatsApp belum terhubung / terautentikasi.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Daftar items album harus berupa array dan tidak boleh kosong.');
    }

    const targetJid = jidNormalizedUser(jid);
    await this.rateLimiter.acquire(targetJid);

    try {
      // Normalize media sources (Buffers, local file paths, or URLs)
      const processedItems = await Promise.all(
        items.map(async (item) => {
          const content = { ...item };
          if (content.image) {
            if (typeof content.image === 'string') {
              content.image = await this.mediaProcessor.toBuffer(content.image);
            }
          } else if (content.video) {
            if (typeof content.video === 'string') {
              content.video = await this.mediaProcessor.toBuffer(content.video);
            }
          }
          return content;
        })
      );

      const messageSecret = new Uint8Array(crypto.randomBytes(32));

      const messageContent = {
        messageContextInfo: {
          messageSecret,
        },
        albumMessage: {
          expectedImageCount: processedItems.filter((a) => a?.image).length,
          expectedVideoCount: processedItems.filter((a) => a?.video).length,
        },
      };

      const generationOptions = {
        userJid: sock.user.id,
        upload: sock.waUploadToServer,
        quoted: options?.quoted || null,
        ephemeralExpiration: options?.quoted?.expiration ?? 0,
      };

      const album = generateWAMessageFromContent(targetJid, messageContent, generationOptions);

      await sock.relayMessage(album.key.remoteJid, album.message, {
        messageId: album.key.id,
        ...options.relayOptions,
      });

      await Promise.all(
        processedItems.map(async (content) => {
          const mediaSecret = new Uint8Array(crypto.randomBytes(32));

          const mediaMsg = await generateWAMessage(
            album.key.remoteJid,
            content,
            {
              upload: sock.waUploadToServer,
              ephemeralExpiration: options?.quoted?.expiration ?? 0,
            }
          );

          mediaMsg.message.messageContextInfo = {
            messageSecret: mediaSecret,
            messageAssociation: {
              associationType: 1, // MEDIA_ALBUM
              parentMessageKey: album.key,
            },
          };

          return sock.relayMessage(
            mediaMsg.key.remoteJid,
            mediaMsg.message,
            {
              messageId: mediaMsg.key.id,
            }
          );
        })
      );

      this.rateLimiter.recordSuccess(targetJid);
      return album;
    } catch (err) {
      this.rateLimiter.recordFailure(targetJid, err);
      throw err;
    }
  }

  /**
   * Send official third-party WhatsApp Sticker Pack (stickerPackMessage).
   * Extension not natively in Baileys: prepares cover WebP and formats pack metadata.
   *
   * @param {object} sock - Baileys socket instance
   * @param {string} jid - Recipient JID
   * @param {object} packData - Pack metadata: { name, publisher, description, cover, stickers }
   * @param {object} [options={}] - { quoted, contextInfo, relayOptions }
   * @returns {Promise<object>} relay result
   */
  async sendStickerPack(sock, jid, packData = {}, options = {}) {
    if (!sock?.user?.id) {
      throw new Error('Socket WhatsApp belum terhubung / terautentikasi.');
    }

    const {
      name = 'Sakanaa Sticker Pack',
      publisher = 'Sakanaa Team',
      description = '',
      cover,
      stickers = [],
    } = packData;

    if (!Array.isArray(stickers) || stickers.length === 0) {
      throw new Error('packData.stickers harus berupa array stiker dan tidak boleh kosong.');
    }

    const targetJid = jidNormalizedUser(jid);
    await this.rateLimiter.acquire(targetJid);

    try {
      // Determine cover source (fallback to first sticker if cover not explicitly passed)
      const coverSource = cover || (stickers[0]?.data || stickers[0]?.buffer || stickers[0]?.sticker || stickers[0]);
      if (!coverSource) {
        throw new Error('Cover sticker pack tidak ditemukan (harus berupa Buffer, path lokal, atau URL).');
      }

      const coverBuffer = await this.mediaProcessor.toBuffer(coverSource);

      const mediaMessage = await prepareWAMessageMedia(
        {
          document: coverBuffer,
          mimetype: 'image/webp',
          fileName: 'cover.webp',
        },
        {
          upload: sock.waUploadToServer,
        }
      );

      const docInfo = mediaMessage?.documentMessage;
      if (!docInfo) {
        throw new Error('Gagal mengunggah gambar cover sticker pack ke server WhatsApp.');
      }

      const formattedStickers = await Promise.all(
        stickers.map(async (s) => {
          let data;
          let emojis = ['🎨'];
          let isAnimated = false;
          let accessibilityLabel = '';
          let isLottie = false;

          if (Buffer.isBuffer(s)) {
            data = s;
          } else if (typeof s === 'string') {
            data = await this.mediaProcessor.toBuffer(s);
          } else if (s && typeof s === 'object') {
            const raw = s.data || s.buffer || s.sticker || s.url;
            if (Buffer.isBuffer(raw)) {
              data = raw;
            } else if (typeof raw === 'string') {
              data = await this.mediaProcessor.toBuffer(raw);
            }
            if (Array.isArray(s.emojis) && s.emojis.length > 0) {
              emojis = s.emojis;
            }
            if (s.isAnimated) isAnimated = true;
            if (s.accessibilityLabel) accessibilityLabel = s.accessibilityLabel;
            if (s.isLottie) isLottie = true;
          }

          if (!data || !Buffer.isBuffer(data)) {
            throw new Error('Setiap stiker dalam packData.stickers harus berupa Buffer, path lokal, atau URL webp.');
          }

          const hash = crypto.createHash('sha256').update(data).digest('base64');
          const safeFileName = hash.replace(/\+/g, '-').replace(/\//g, '_') + '.webp';

          return {
            fileName: safeFileName,
            isAnimated,
            emojis,
            accessibilityLabel,
            isLottie,
            mimetype: 'image/webp',
          };
        })
      );

      const stickerPackId = generateMessageID();
      const quoted = options.quoted || null;

      const stickerPackMessage = {
        stickerPackId,
        name,
        publisher,
        packDescription: description || '',
        stickers: formattedStickers,
        fileLength: docInfo.fileLength,
        fileSha256: docInfo.fileSha256,
        fileEncSha256: docInfo.fileEncSha256,
        mediaKey: docInfo.mediaKey,
        directPath: docInfo.directPath,
        mediaKeyTimestamp: docInfo.mediaKeyTimestamp || Math.floor(Date.now() / 1000).toString(),
        trayIconFileName: `${stickerPackId}.webp`,
        imageDataHash: docInfo.fileSha256.toString('base64'),
        stickerPackSize: docInfo.fileLength,
        stickerPackOrigin: 'THIRD_PARTY',
        contextInfo: options.contextInfo || (quoted ? {
          stanzaId: quoted.key?.id,
          participant: quoted.key?.participant || quoted.key?.remoteJid,
          quotedMessage: quoted.message,
        } : {}),
      };

      const result = await sock.relayMessage(
        targetJid,
        { stickerPackMessage },
        options.relayOptions || {}
      );

      this.rateLimiter.recordSuccess(targetJid);
      return result;
    } catch (err) {
      this.rateLimiter.recordFailure(targetJid, err);
      throw err;
    }
  }

  /**
   * Send document / file attachment.
   * @param {object} sock
   * @param {string} jid
   * @param {Buffer|string} src
   * @param {string} filename
   * @param {string} [mime='application/octet-stream']
   * @param {string} [caption='']
   * @param {object} [opts={}]
   */
  async sendDoc(sock, jid, src, filename, mime = 'application/octet-stream', caption = '', opts = {}) {
    const buffer = await this.mediaProcessor.toBuffer(src);
    return this._sendWithLimit(
      sock,
      jid,
      {
        document: buffer,
        fileName: filename || 'file.bin',
        mimetype: mime,
        caption: caption || undefined,
        ...opts.contentOptions,
      },
      opts
    );
  }

  /**
   * Send WhatsApp Poll message.
   * @param {object} sock
   * @param {string} jid
   * @param {string} name - Question
   * @param {string[]} options - Poll option choices
   * @param {number} [selectableCount=1]
   * @param {object} [opts={}]
   */
  async sendPoll(sock, jid, name, options = [], selectableCount = 1, opts = {}) {
    return this._sendWithLimit(
      sock,
      jid,
      {
        poll: {
          name,
          values: options,
          selectableCount: Number(selectableCount) || 1,
        },
      },
      opts
    );
  }

  /**
   * Send WhatsApp contact card (vCard).
   * @param {object} sock
   * @param {string} jid
   * @param {object|string} contactData - Either vCard string or { displayName, phoneNumber }
   * @param {object} [opts={}]
   */
  async sendContact(sock, jid, contactData, opts = {}) {
    let vcard = '';
    let displayName = 'Contact';

    if (typeof contactData === 'string') {
      vcard = contactData;
    } else if (contactData && typeof contactData === 'object') {
      displayName = contactData.displayName || 'Contact';
      const phone = String(contactData.phoneNumber || '').replace(/\D/g, '');
      vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${displayName}`,
        `ORG:${contactData.organization || 'Sakanaa-Whatswap'};`,
        `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}`,
        'END:VCARD',
      ].join('\n');
    }

    return this._sendWithLimit(
      sock,
      jid,
      {
        contacts: {
          displayName,
          contacts: [{ vcard }],
        },
      },
      opts
    );
  }

  /**
   * React to a message with an emoji.
   * @param {object} sock
   * @param {string} jid
   * @param {object} key - Message key { remoteJid, fromMe, id, participant }
   * @param {string} emoji
   */
  async react(sock, jid, key, emoji) {
    return this._sendWithLimit(sock, jid, {
      react: {
        text: emoji || '',
        key,
      },
    });
  }

  /**
   * Remove reaction from a message.
   */
  async unreact(sock, jid, key) {
    return this.react(sock, jid, key, '');
  }

  /**
   * Edit an existing sent message (supports text, media like image/video with caption, or caption updates).
   * @param {object} sock
   * @param {string} jid
   * @param {object} key - Target message key { id, remoteJid, fromMe, participant }
   * @param {string|object} content - New text string OR content object { text, caption, image, video, ... }
   * @param {object} [opts={}]
   */
  async editMessage(sock, jid, key, content, opts = {}) {
    if (!key || !key.id) {
      throw new Error('Key pesan yang akan diedit wajib disertakan (memiliki id).');
    }

    let payload = {};

    if (typeof content === 'string') {
      payload = {
        text: content,
        edit: key,
      };
    } else if (content && typeof content === 'object') {
      const editContent = { ...content };

      // Handle media if provided as string path or URL
      if (editContent.image && typeof editContent.image === 'string') {
        editContent.image = await this.mediaProcessor.toBuffer(editContent.image);
      }
      if (editContent.video && typeof editContent.video === 'string') {
        const processed = await this.mediaProcessor.processVideo(editContent.video);
        editContent.video = processed.buffer;
        editContent.mimetype = processed.mimetype || editContent.mimetype || 'video/mp4';
      }
      if (editContent.audio && typeof editContent.audio === 'string') {
        editContent.audio = await this.mediaProcessor.toBuffer(editContent.audio);
      }
      if (editContent.document && typeof editContent.document === 'string') {
        editContent.document = await this.mediaProcessor.toBuffer(editContent.document);
      }

      // If only caption is provided without explicit media or text, map caption to text so Baileys does not fail
      if (editContent.caption && !editContent.text && !editContent.image && !editContent.video && !editContent.audio && !editContent.document) {
        editContent.text = editContent.caption;
      }

      payload = {
        ...editContent,
        edit: key,
        ...opts.contentOptions,
      };
    } else {
      throw new Error('Konten edit pesan harus berupa string atau object.');
    }

    return this._sendWithLimit(sock, jid, payload, opts);
  }

  // Alias for editMessage
  async messageEdit(sock, jid, key, content, opts = {}) {
    return this.editMessage(sock, jid, key, content, opts);
  }

  /**
   * Delete message for everyone.
   * @param {object} sock
   * @param {string} jid
   * @param {object} key
   */
  async deleteMessage(sock, jid, key) {
    return this._sendWithLimit(sock, jid, {
      delete: key,
    });
  }

  /**
   * Send WhatsApp Status Story.
   * @param {object} sock
   * @param {object} content - Baileys message content (image, video, text, etc.)
   * @param {string[]} [statusJidList=[]] - Audience list
   * @param {object} [opts={}]
   */
  async sendStatus(sock, content, statusJidList = [], opts = {}) {
    const normList = Array.isArray(statusJidList) ? statusJidList.map(toPnJid) : [];
    return this._sendWithLimit(sock, 'status@broadcast', content, {
      statusJidList: normList.length > 0 ? normList : undefined,
      ...opts,
    });
  }

  // ==========================================
  // SECTION 12: PRIVACY & CHAT MANAGEMENT
  // ==========================================

  async fetchPrivacySettings(sock) {
    return await sock.fetchPrivacySettings();
  }

  async updateLastSeenPrivacy(sock, value) {
    return await sock.updateLastSeenPrivacy(value);
  }

  async updateOnlinePrivacy(sock, value) {
    return await sock.updateOnlinePrivacy(value);
  }

  async updateProfilePicturePrivacy(sock, value) {
    return await sock.updateProfilePicturePrivacy(value);
  }

  async updateStatusPrivacy(sock, value) {
    return await sock.updateStatusPrivacy(value);
  }

  async updateReadReceiptsPrivacy(sock, value) {
    return await sock.updateReadReceiptsPrivacy(value);
  }

  async fetchBlocklist(sock) {
    return await sock.fetchBlocklist();
  }

  async blockUser(sock, jid) {
    return await sock.updateBlockStatus(toPnJid(jid), 'block');
  }

  async unblockUser(sock, jid) {
    return await sock.updateBlockStatus(toPnJid(jid), 'unblock');
  }

  async starMessage(sock, jid, key, star = true) {
    return await sock.chatModify(
      {
        star: {
          messages: [{ id: key.id, fromMe: key.fromMe }],
          star,
        },
      },
      jidNormalizedUser(jid)
    );
  }

  async unstarMessage(sock, jid, key) {
    return this.starMessage(sock, jid, key, false);
  }

  async pinMessage(sock, jid, key, durationSeconds = 86400) {
    return await sock.sendMessage(jidNormalizedUser(jid), {
      pin: {
        type: 1, // PIN
        key,
        time: durationSeconds,
      },
    });
  }

  async unpinMessage(sock, jid, key) {
    return await sock.sendMessage(jidNormalizedUser(jid), {
      pin: {
        type: 0, // UNPIN
        key,
      },
    });
  }

  /**
   * Safely modifies chat, ensuring lastMessages is present to prevent FORCED LOGOUT!
   * (Section 2.4 & Section 12).
   */
  async _safeChatModify(sock, jid, modObject, lastMessages) {
    if (!lastMessages || (Array.isArray(lastMessages) && lastMessages.length === 0)) {
      this.logger.warn(
        'MSG',
        `chatModify dibatalkan: 'lastMessages' tidak boleh kosong/tidak terverifikasi untuk mencegah logout paksa WhatsApp!`
      );
      return false;
    }

    const normJid = jidNormalizedUser(jid);
    return await sock.chatModify(modObject, normJid);
  }

  async archiveChat(sock, jid, lastMessages) {
    return this._safeChatModify(sock, jid, { archive: true, lastMessages }, lastMessages);
  }

  async unarchiveChat(sock, jid, lastMessages) {
    return this._safeChatModify(sock, jid, { archive: false, lastMessages }, lastMessages);
  }

  async muteChat(sock, jid, durationMs, lastMessages) {
    const muteTime = durationMs ? Date.now() + durationMs : 8 * 3600 * 1000;
    return this._safeChatModify(sock, jid, { mute: muteTime, lastMessages }, lastMessages);
  }

  async unmuteChat(sock, jid, lastMessages) {
    return this._safeChatModify(sock, jid, { mute: null, lastMessages }, lastMessages);
  }

  async disappearingMessagesInChat(sock, jid, timerSeconds = 0) {
    return await sock.sendMessage(jidNormalizedUser(jid), {
      disappearingMessagesInChat: timerSeconds,
    });
  }

  async rejectCall(sock, callId, callFrom) {
    if (typeof sock.rejectCall === 'function') {
      return await sock.rejectCall(callId, callFrom);
    }
  }
}

export const messageBuilder = new MessageBuilder();
export default messageBuilder;
