/**
 * Sakanaa-Whatswap - Group Metadata Cache & Group Operations
 * Caches group metadata with TTL and keeps it updated via socket events.
 */

import { logger as defaultLogger } from '../core/logger.js';
import {
  jidNormalizedUser,
  isJidGroup,
  isLidUser,
  isPnUser,
  areJidsSameUser,
  extractPhoneNumber,
} from '../identity/jidUtils.js';

export class GroupMetadataCache {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
    this.ttlMs = options.ttlMs || 300_000; // 5 minutes default
    this.cache = new Map(); // jid -> { data, expiresAt }
  }

  /**
   * Set metadata in cache with TTL.
   */
  set(jid, metadata, customTtlMs) {
    if (!jid || !metadata) return;
    const normalized = jidNormalizedUser(jid);
    const ttl = customTtlMs || this.ttlMs;
    this.cache.set(normalized, {
      data: metadata,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Get metadata from cache if not expired.
   */
  get(jid) {
    if (!jid) return undefined;
    const normalized = jidNormalizedUser(jid);
    const entry = this.cache.get(normalized);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(normalized);
      return undefined;
    }
    return entry.data;
  }

  /**
   * Invalidate a single group from cache.
   */
  delete(jid) {
    if (!jid) return;
    this.cache.delete(jidNormalizedUser(jid));
  }

  /**
   * Clear all cached metadata.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Binds socket events to maintain group metadata cache dynamically.
   * @param {object} sock - Baileys socket
   */
  bindSocketEvents(sock) {
    if (!sock?.ev) return;

    // 1. Group info updates (subject, desc, restrict, announce, etc.)
    sock.ev.on('groups.update', (updates) => {
      if (!Array.isArray(updates)) return;
      for (const update of updates) {
        const jid = update?.id;
        if (!jid) continue;
        const current = this.get(jid);
        if (current) {
          const merged = { ...current, ...update };
          this.set(jid, merged);
          this.logger.debug('GROUP', `Cache metadata diperbarui untuk grup ${jid}`);
        }
      }
    });

    // 2. Participant updates (join, leave, promote, demote)
    sock.ev.on('group-participants.update', (event) => {
      const { id: jid, participants, action } = event || {};
      if (!jid || !participants || !action) return;

      const current = this.get(jid);
      if (!current || !Array.isArray(current.participants)) {
        this.delete(jid);
        return;
      }

      const participantMap = new Map(current.participants.map((p) => [p.id, p]));

      for (const pJid of participants) {
        if (action === 'add') {
          participantMap.set(pJid, { id: pJid, admin: null });
        } else if (action === 'remove') {
          participantMap.delete(pJid);
        } else if (action === 'promote') {
          const existing = participantMap.get(pJid) || { id: pJid };
          participantMap.set(pJid, { ...existing, admin: 'admin' });
        } else if (action === 'demote') {
          const existing = participantMap.get(pJid) || { id: pJid };
          participantMap.set(pJid, { ...existing, admin: null });
        }
      }

      current.participants = Array.from(participantMap.values());
      current.size = current.participants.length;
      this.set(jid, current);
      this.logger.debug('GROUP', `Partisipan grup ${jid} diperbarui (${action}: ${participants.length})`);
    });

    // 3. New groups created/joined
    sock.ev.on('groups.upsert', (newGroups) => {
      if (!Array.isArray(newGroups)) return;
      for (const group of newGroups) {
        if (group?.id) {
          this.set(group.id, group);
        }
      }
    });
  }

  /**
   * Fetch group metadata: cache-first with network fallback.
   * @param {object} sock
   * @param {string} jid
   * @param {boolean} [forceRefresh=false]
   */
  async getGroupMetadata(sock, jid, forceRefresh = false) {
    if (!jid || !isJidGroup(jid)) {
      throw new Error(`JID ${jid} bukan JID grup WhatsApp yang valid.`);
    }

    const norm = jidNormalizedUser(jid);

    if (!forceRefresh) {
      const cached = this.get(norm);
      if (cached) return cached;
    }

    if (!sock?.groupMetadata) {
      throw new Error('Socket tidak siap untuk mengambil groupMetadata.');
    }

    const metadata = await sock.groupMetadata(norm);
    if (metadata) {
      this.set(norm, metadata);
    }
    return metadata;
  }

  /**
   * Checks if a given participant is an admin (or superadmin) in the group,
   * properly resolving across both PN and LID identities.
   * @param {object} metadata - Group metadata object
   * @param {string} participantJid - Target participant JID (PN or LID)
   * @param {object} [client] - BaileysConnection instance with lidPnResolver
   * @returns {boolean}
   */
  isParticipantAdmin(metadata, participantJid, client) {
    if (!metadata || !Array.isArray(metadata.participants) || !participantJid) {
      return false;
    }

    const targetNorm = jidNormalizedUser(participantJid);
    const targetPhone = extractPhoneNumber(targetNorm);

    // Also check cached mappings if client is provided
    let mappedPn = null;
    let mappedLid = null;
    if (client?.lidPnResolver) {
      if (isLidUser(targetNorm)) {
        mappedPn = client.lidPnResolver.lidToPn.get(targetNorm);
      } else if (isPnUser(targetNorm)) {
        mappedLid = client.lidPnResolver.pnToLid.get(targetNorm);
      }
    }

    const participant = metadata.participants.find((p) => {
      const pId = jidNormalizedUser(p.id);
      if (areJidsSameUser(pId, targetNorm)) return true;
      if (mappedPn && areJidsSameUser(pId, mappedPn)) return true;
      if (mappedLid && areJidsSameUser(pId, mappedLid)) return true;
      if (targetPhone && extractPhoneNumber(pId) === targetPhone) return true;
      if (p.phoneNumber && p.phoneNumber === targetPhone) return true;
      if (p.jid && (areJidsSameUser(p.jid, targetNorm) || (mappedPn && areJidsSameUser(p.jid, mappedPn)))) return true;
      return false;
    });

    return Boolean(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
  }

  /**
   * Checks if the bot is an admin in the group, matching both the bot's PN and LID.
   * @param {object} sock - Baileys socket
   * @param {object} metadata - Group metadata object
   * @param {object} [client] - BaileysConnection instance
   * @returns {boolean}
   */
  isBotAdmin(sock, metadata, client) {
    if (!metadata || !Array.isArray(metadata.participants)) {
      return false;
    }

    const botPn = jidNormalizedUser(sock?.user?.id || '');
    const botLid = jidNormalizedUser(sock?.user?.lid || sock?.authState?.creds?.me?.lid || '');
    const botPhone = extractPhoneNumber(botPn);

    const botParticipant = metadata.participants.find((p) => {
      const pId = jidNormalizedUser(p.id);
      if (botPn && areJidsSameUser(pId, botPn)) return true;
      if (botLid && areJidsSameUser(pId, botLid)) return true;
      if (botPhone && extractPhoneNumber(pId) === botPhone) return true;
      if (client?.lidPnResolver?.lidToPn) {
        const cachedPn = client.lidPnResolver.lidToPn.get(pId);
        if (cachedPn && areJidsSameUser(cachedPn, botPn)) return true;
      }
      return false;
    });

    return Boolean(botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin'));
  }

  /**
   * Updates group subject / title.
   */
  async updateGroupSubject(sock, jid, subject) {
    const norm = jidNormalizedUser(jid);
    const res = await sock.groupUpdateSubject(norm, subject);
    const cached = this.get(norm);
    if (cached) {
      cached.subject = subject;
      this.set(norm, cached);
    }
    return res;
  }

  /**
   * Updates group description.
   */
  async updateGroupDescription(sock, jid, description) {
    const norm = jidNormalizedUser(jid);
    const res = await sock.groupUpdateDescription(norm, description);
    const cached = this.get(norm);
    if (cached) {
      cached.desc = description;
      this.set(norm, cached);
    }
    return res;
  }

  /**
   * Updates group settings.
   * @param {'announcement' | 'not_announcement' | 'locked' | 'unlocked'} setting
   */
  async updateGroupSetting(sock, jid, setting) {
    const norm = jidNormalizedUser(jid);
    return await sock.groupSettingUpdate(norm, setting);
  }

  /**
   * Get invite code of a group.
   */
  async getGroupInviteCode(sock, jid) {
    const norm = jidNormalizedUser(jid);
    return await sock.groupInviteCode(norm);
  }

  /**
   * Revoke existing invite code of a group.
   */
  async revokeGroupInviteCode(sock, jid) {
    const norm = jidNormalizedUser(jid);
    return await sock.groupRevokeInvite(norm);
  }

  /**
   * Accept invite code to join a group.
   */
  async acceptGroupInvite(sock, code) {
    const cleanCode = code.replace(/https:\/\/chat\.whatsapp\.com\//, '').trim();
    return await sock.groupAcceptInvite(cleanCode);
  }

  /**
   * Manage group participants.
   * @param {string} jid
   * @param {string|string[]} participants - Array of JIDs or single JID
   * @param {'add' | 'remove' | 'promote' | 'demote'} action
   */
  async groupParticipantsUpdate(sock, jid, participants, action) {
    const norm = jidNormalizedUser(jid);
    const list = (Array.isArray(participants) ? participants : [participants]).map(jidNormalizedUser);
    return await sock.groupParticipantsUpdate(norm, list, action);
  }

  // Aliases for developer convenience
  async groupAdd(sock, jid, participants) {
    return this.groupParticipantsUpdate(sock, jid, participants, 'add');
  }

  async groupKick(sock, jid, participants) {
    return this.groupParticipantsUpdate(sock, jid, participants, 'remove');
  }

  async groupPromote(sock, jid, participants) {
    return this.groupParticipantsUpdate(sock, jid, participants, 'promote');
  }

  async groupDemote(sock, jid, participants) {
    return this.groupParticipantsUpdate(sock, jid, participants, 'demote');
  }
}

export const groupMetadataCache = new GroupMetadataCache();
export default groupMetadataCache;
