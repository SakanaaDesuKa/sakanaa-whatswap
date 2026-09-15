/**
 * Sakanaa-Whatswap - LID/PN Resolver
 * Handles bidirectional mapping between Phone Number (PN) and Linked Identity (LID)
 * with multi-tier resolution and opportunistic event learning.
 */

import {
  jidNormalizedUser,
  isPnUser,
  isLidUser,
  isJidGroup,
  isJidNewsletter,
  isJidMetaAI,
  toPnJid,
  extractPhoneNumber,
} from './jidUtils.js';
import { logger as defaultLogger } from '../core/logger.js';

export class LidPnResolver {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
    this.customAdapter = options.cacheAdapter || null;

    // In-memory dual-indexed storage
    this.pnToLid = new Map();
    this.lidToPn = new Map();
  }

  /**
   * Pluggable cache adapter setter.
   * Adapter must implement { get(key), set(key, value) }
   */
  setCacheAdapter(adapter) {
    if (adapter && typeof adapter.get === 'function' && typeof adapter.set === 'function') {
      this.customAdapter = adapter;
      this.logger.debug('AUTH', 'Custom cache adapter terpasang pada LidPnResolver.');
    }
  }

  async getFromCache(key) {
    if (this.customAdapter) {
      try {
        const val = await this.customAdapter.get(key);
        if (val) return val;
      } catch (err) {
        this.logger.debug('AUTH', `Error membaca cache adapter untuk ${key}:`, err.message);
      }
    }
    return null;
  }

  async setInCache(key, value) {
    if (this.customAdapter) {
      try {
        await this.customAdapter.set(key, value);
      } catch (err) {
        this.logger.debug('AUTH', `Error menulis cache adapter untuk ${key}:`, err.message);
      }
    }
  }

  /**
   * Save a known PN <-> LID pair to cache.
   * @param {string} rawPn - Phone number JID (e.g. 628123@s.whatsapp.net)
   * @param {string} rawLid - LID JID (e.g. 123456789@lid)
   */
  async registerMapping(rawPn, rawLid) {
    if (!rawPn || !rawLid) return;
    const pn = jidNormalizedUser(rawPn);
    const lid = jidNormalizedUser(rawLid);

    if (!isPnUser(pn) || !isLidUser(lid)) return;

    this.pnToLid.set(pn, lid);
    this.lidToPn.set(lid, pn);

    await this.setInCache(`pn:${pn}`, lid);
    await this.setInCache(`lid:${lid}`, pn);
  }

  /**
   * Resolve Phone Number JID to LID JID.
   * @param {string|number} pnJidOrNumber
   * @param {object} sock - Active Baileys socket instance
   * @returns {Promise<string|null>} LID JID or null
   */
  async convertPn(pnJidOrNumber, sock) {
    if (!pnJidOrNumber) return null;
    const pn = toPnJid(pnJidOrNumber);

    // Tier 1: Local In-Memory Cache & Adapter
    if (this.pnToLid.has(pn)) {
      return this.pnToLid.get(pn);
    }
    const cachedLid = await this.getFromCache(`pn:${pn}`);
    if (cachedLid) {
      this.pnToLid.set(pn, cachedLid);
      return cachedLid;
    }

    // Tier 2: Baileys Signal Repository LID mapping
    if (sock?.signalRepository?.lidMapping?.getLIDForPN) {
      try {
        const lid = await sock.signalRepository.lidMapping.getLIDForPN(pn);
        if (lid) {
          const normLid = jidNormalizedUser(lid);
          await this.registerMapping(pn, normLid);
          return normLid;
        }
      } catch (err) {
        this.logger.debug('AUTH', `LID lookup via signalRepository gagal: ${err.message}`);
      }
    }

    // Tier 3: onWhatsApp verification fallback
    if (sock && typeof sock.onWhatsApp === 'function') {
      try {
        const num = extractPhoneNumber(pn);
        const [res] = await sock.onWhatsApp(num);
        if (res?.exists && res.lid) {
          const normLid = jidNormalizedUser(res.lid);
          await this.registerMapping(pn, normLid);
          return normLid;
        }
      } catch (err) {
        this.logger.debug('AUTH', `onWhatsApp lookup gagal: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Resolve LID JID to Phone Number JID.
   * @param {string} rawLid
   * @param {object} sock - Active Baileys socket instance
   * @returns {Promise<string|null>} PN JID or null
   */
  async convertLid(rawLid, sock) {
    if (!rawLid) return null;
    const lid = jidNormalizedUser(rawLid);

    // Tier 1: Local In-Memory Cache & Adapter
    if (this.lidToPn.has(lid)) {
      return this.lidToPn.get(lid);
    }
    const cachedPn = await this.getFromCache(`lid:${lid}`);
    if (cachedPn) {
      this.lidToPn.set(lid, cachedPn);
      return cachedPn;
    }

    // Tier 2: Baileys Signal Repository LID mapping
    if (sock?.signalRepository?.lidMapping?.getPNForLID) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
        if (pn) {
          const normPn = jidNormalizedUser(pn);
          await this.registerMapping(normPn, lid);
          return normPn;
        }
      } catch (err) {
        this.logger.debug('AUTH', `PN lookup via signalRepository gagal: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * High-level identity resolution returning both representations.
   * @param {string|number} jidOrNumber
   * @param {object} sock
   * @returns {Promise<{ pn: string|null, lid: string|null, exists: boolean, isGroup: boolean, isNewsletter: boolean, isBot: boolean }>}
   */
  async resolveIdentity(jidOrNumber, sock) {
    const raw = String(jidOrNumber || '').trim();
    const isGroup = isJidGroup(raw);
    const isNewsletter = isJidNewsletter(raw);
    const isBot = isJidMetaAI(raw);

    if (isGroup || isNewsletter || isBot) {
      return {
        pn: raw,
        lid: null,
        exists: true,
        isGroup,
        isNewsletter,
        isBot,
      };
    }

    if (isLidUser(raw)) {
      const lid = jidNormalizedUser(raw);
      const pn = await this.convertLid(lid, sock);
      return {
        pn,
        lid,
        exists: Boolean(pn || lid),
        isGroup: false,
        isNewsletter: false,
        isBot: false,
      };
    }

    // Assume PN or raw phone number
    const pn = toPnJid(raw);
    const lid = await this.convertPn(pn, sock);
    return {
      pn,
      lid,
      exists: Boolean(pn || lid),
      isGroup: false,
      isNewsletter: false,
      isBot: false,
    };
  }

  /**
   * Bind event listeners to Baileys socket to opportunistically learn mappings.
   * @param {object} sock - Baileys socket instance
   */
  bindSocketEvents(sock) {
    if (!sock?.ev) return;

    // 1. Listen to explicit lid-mapping.update events
    sock.ev.on('lid-mapping.update', (mapping) => {
      if (!mapping) return;
      if (Array.isArray(mapping)) {
        for (const item of mapping) {
          if (item?.pn && item?.lid) {
            this.registerMapping(item.pn, item.lid);
          }
        }
      } else if (mapping.pn && mapping.lid) {
        this.registerMapping(mapping.pn, mapping.lid);
      }
    });

    // 2. Listen to contacts.upsert / contacts.update
    const handleContacts = (contacts) => {
      if (!Array.isArray(contacts)) return;
      for (const contact of contacts) {
        const id = contact.id;
        const lid = contact.lid;
        const phoneNumber = contact.phoneNumber;

        if (id && isPnUser(id) && lid && isLidUser(lid)) {
          this.registerMapping(id, lid);
        } else if (id && isLidUser(id) && phoneNumber) {
          this.registerMapping(toPnJid(phoneNumber), id);
        }
      }
    };
    sock.ev.on('contacts.upsert', handleContacts);
    sock.ev.on('contacts.update', handleContacts);

    // 3. Opportunistic capture from incoming messages
    sock.ev.on('messages.upsert', ({ messages }) => {
      if (!Array.isArray(messages)) return;
      for (const msg of messages) {
        const key = msg?.key;
        if (!key) continue;

        // Extract participant and participantAlt (e.g. in groups)
        const participant = key.participant;
        const participantAlt = key.participantAlt;
        if (participant && participantAlt) {
          if (isLidUser(participant) && isPnUser(participantAlt)) {
            this.registerMapping(participantAlt, participant);
          } else if (isPnUser(participant) && isLidUser(participantAlt)) {
            this.registerMapping(participant, participantAlt);
          }
        }

        // Extract remoteJid and remoteJidAlt (in 1-on-1 chats)
        const remoteJid = key.remoteJid;
        const remoteJidAlt = key.remoteJidAlt;
        if (remoteJid && remoteJidAlt) {
          if (isLidUser(remoteJid) && isPnUser(remoteJidAlt)) {
            this.registerMapping(remoteJidAlt, remoteJid);
          } else if (isPnUser(remoteJid) && isLidUser(remoteJidAlt)) {
            this.registerMapping(remoteJid, remoteJidAlt);
          }
        }
      }
    });
  }
}

export const lidPnResolver = new LidPnResolver();
export default lidPnResolver;
