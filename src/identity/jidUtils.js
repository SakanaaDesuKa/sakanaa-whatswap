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
  if (str.endsWith('@s.whatsapp.net') || str.endsWith('@lid')) {
    return normalizeJid(str);
  }
  const cleanNumber = str.replace(/\D/g, '');
  if (!cleanNumber) return '';
  return `${cleanNumber}@s.whatsapp.net`;
}

/**
 * Extracts digits from a phone number or PN JID.
 * @param {string} jidOrNumber
 * @returns {string}
 */
export function extractPhoneNumber(jidOrNumber) {
  if (!jidOrNumber) return '';
  const decoded = jidDecode(jidOrNumber);
  if (decoded && decoded.server === 's.whatsapp.net') {
    return decoded.user;
  }
  return String(jidOrNumber).replace(/\D/g, '');
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
