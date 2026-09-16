/**
 * Sakanaa-Whatswap - JID Utilities
 * Wrappers and helpers around official Baileys JID functions.
 * NEVER cut or compare JIDs with raw .split('@') or ===.
 */

import {
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
} from '@whiskeysockets/baileys';

/**
 * Normalizes any JID to its clean canonical user representation.
 * @param {string} jid
 * @returns {string}
 */
export function normalizeJid(jid) {
  if (!jid) return '';
  return jidNormalizedUser(jid);
}

/**
 * Compares two JIDs safely using official areJidsSameUser.
 * @param {string} jid1
 * @param {string} jid2
 * @returns {boolean}
 */
export function isSameJid(jid1, jid2) {
  if (!jid1 || !jid2) return false;
  return areJidsSameUser(jid1, jid2);
}

/**
 * Sanitizes and converts a phone number or raw string into a valid PN JID.
 * Example: '+62 812-3456-7890' -> '6281234567890@s.whatsapp.net'
 * @param {string|number} input
 * @returns {string}
 */
export function toPnJid(input) {
  if (!input) return '';
  const str = String(input).trim();
  if (str.endsWith('@lid') || isLidUser(str)) return '';
  if (str.endsWith('@s.whatsapp.net')) {
    return normalizeJid(str);
  }
  const cleanNumber = str.replace(/\D/g, '');
  if (!cleanNumber) return '';
  return `${cleanNumber}@s.whatsapp.net`;
}

/**
 * Sanitizes and converts a raw string or LID into a valid LID JID.
 * Example: '142816839766079' -> '142816839766079@lid'
 * @param {string|number} input
 * @returns {string}
 */
export function toLidJid(input) {
  if (!input) return '';
  const str = String(input).trim();
  if (str.endsWith('@s.whatsapp.net') || isPnUser(str)) return '';
  if (str.endsWith('@lid')) {
    return normalizeJid(str);
  }
  const cleanNumber = str.replace(/\D/g, '');
  if (!cleanNumber) return '';
  return `${cleanNumber}@lid`;
}

/**
 * Extracts digits from a phone number or PN JID.
 * Strictly returns empty string if input is a LID, group, or broadcast JID.
 * @param {string} jidOrNumber
 * @returns {string}
 */
export function extractPhoneNumber(jidOrNumber) {
  if (!jidOrNumber) return '';
  const str = String(jidOrNumber).trim();
  if (str.endsWith('@lid') || isLidUser(str) || isJidGroup(str) || isJidNewsletter(str) || isJidBroadcast(str)) {
    return '';
  }
  const decoded = jidDecode(str);
  if (decoded) {
    if (decoded.server === 's.whatsapp.net') {
      return decoded.user;
    }
    return '';
  }
  if (!str.includes('@')) {
    return str.replace(/\D/g, '');
  }
  return '';
}

/**
 * Extracts sender identity information from a Baileys message object.
 * Handles both groups and private chats with Baileys v7 LID/PN architecture.
 * @param {object} m - Baileys message object
 * @returns {{ senderPn: string, senderLid: string, pnJid: string, lidJid: string, cleanPn: string, remoteJid: string, isGroup: boolean, isNewsletter: boolean, fromMe: boolean }}
 */
export function extractSenderInfo(m) {
  if (!m || !m.key) {
    return {
      senderPn: '',
      senderLid: '',
      pnJid: '',
      lidJid: '',
      cleanPn: '',
      remoteJid: '',
      isGroup: false,
      isNewsletter: false,
      fromMe: false,
    };
  }

  const key = m.key;
  const remoteJid = key.remoteJid || '';
  const fromMe = Boolean(key.fromMe);
  const isGroup = remoteJid.endsWith('@g.us');
  const isNewsletter = remoteJid.endsWith('@newsletter');

  // Candidate JIDs for sender
  // In Group: participantAlt, participant, participantLid
  // In Private: remoteJidAlt, remoteJid, participantLid
  const candidates = isGroup
    ? [key.participantAlt, key.participant, key.participantLid]
    : [key.remoteJidAlt, remoteJid, key.participantLid];

  let pnJid = '';
  let lidJid = '';

  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    const norm = normalizeJid(c);
    if (norm.endsWith('@s.whatsapp.net') && !pnJid) {
      pnJid = norm;
    } else if (norm.endsWith('@lid') && !lidJid) {
      lidJid = norm;
    }
  }

  const cleanPn = extractPhoneNumber(pnJid);

  return {
    senderPn: cleanPn,
    senderLid: lidJid,
    pnJid,
    lidJid,
    cleanPn,
    remoteJid,
    isGroup,
    isNewsletter,
    fromMe,
  };
}

/**
 * Returns the detected type of JID.
 * @param {string} jid
 * @returns {'pn'|'lid'|'group'|'broadcast'|'newsletter'|'meta-ai'|'status'|'unknown'}
 */
export function getJidType(jid) {
  if (!jid) return 'unknown';
  const norm = normalizeJid(jid);
  if (isJidStatusBroadcast(norm)) return 'status';
  if (isJidGroup(norm)) return 'group';
  if (isJidNewsletter(norm)) return 'newsletter';
  if (isJidBroadcast(norm)) return 'broadcast';
  if (isJidMetaAI(norm)) return 'meta-ai';
  if (isPnUser(norm) || isHostedPnUser(norm)) return 'pn';
  if (isLidUser(norm) || isHostedLidUser(norm)) return 'lid';
  return 'unknown';
}

export {
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
};
