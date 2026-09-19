import fs from 'fs';
import { tmpdir } from 'os';
import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import webp from 'node-webpmux';

const FFMPEG_BIN = fs.existsSync('/data/data/com.termux/files/usr/bin/ffmpeg')
  ? '/data/data/com.termux/files/usr/bin/ffmpeg'
  : 'ffmpeg';

const MAX_ANIMATED_BYTES = 500 * 1024; // 500 KB limit for WhatsApp stickers
const ANIMATED_TIERS = [
  { fps: 15, duration: 8 },
  { fps: 12, duration: 7 },
  { fps: 10, duration: 6 },
  { fps: 8, duration: 5 },
];

function tmpFile(ext = 'tmp') {
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
  return path.join(tmpdir(), `stk_${crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${cleanExt}`);
}

function safeUnlink(...files) {
  for (const f of files) {
    try {
      if (f && fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
}

/**
 * Builds standard WhatsApp WebP EXIF chunk.
 * @param {string} [packName='Sakanaa-Whatswap']
 * @param {string} [author='Sakanaa Bot']
 * @param {string[]} [emojis=['🌸']]
 * @returns {Buffer}
 */
export function buildExifBuffer(packName = 'Sakanaa-Whatswap', author = 'Sakanaa Bot', emojis = ['🌸']) {
  const json = {
    'sticker-pack-id': `SakanaaMiyuu-${Date.now()}`,
    'sticker-pack-name': packName,
    'sticker-pack-publisher': author,
    'emojis': Array.isArray(emojis) ? emojis : [emojis],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf-8');
  const exif = Buffer.concat([exifAttr, jsonBuf]);
  exif.writeUIntLE(jsonBuf.length, 14, 4);
  return exif;
}

/**
 * Injects EXIF metadata directly into WebP VP8X chunk for animated stickers.
 * @param {Buffer} buf
 * @param {Buffer} exifData
 * @returns {Buffer}
 */
export function injectExif(buf, exifData) {
  if (
    buf.length < 20 ||
    buf.slice(0, 4).toString('ascii') !== 'RIFF' ||
    buf.slice(8, 12).toString('ascii') !== 'WEBP' ||
    buf.slice(12, 16).toString('ascii') !== 'VP8X'
  ) {
    return buf;
  }

  const result = Buffer.from(buf);
  result[20] |= 0x08; // Set EXIF flag

  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(exifData.length, 0);

  const pad = exifData.length % 2 !== 0 ? Buffer.from([0x00]) : Buffer.alloc(0);
  const exifChunk = Buffer.concat([Buffer.from('EXIF'), sizeBuf, exifData, pad]);

  const final = Buffer.concat([result, exifChunk]);
  final.writeUInt32LE(final.length - 8, 4);
  return final;
}

/**
 * Injects EXIF into a WebP file, handling both static and animated WebP.
 * @param {string} webpPath
 * @param {string} packName
 * @param {string} author
 * @param {string[]} [emojis=['🌸']]
 * @returns {Promise<string>} Output webp temporary file path
 */
export async function writeExif(webpPath, packName, author, emojis = ['🌸']) {
  const img = new webp.Image();
  await img.load(webpPath);
  const exifBuf = buildExifBuffer(packName, author, emojis);

  if (img.hasAnim) {
    const raw = fs.readFileSync(webpPath);
    const finalBuf = injectExif(raw, exifBuf);
    const out = tmpFile('webp');
    fs.writeFileSync(out, finalBuf);
    return out;
  } else {
    img.exif = exifBuf;
    const out = tmpFile('webp');
    await img.save(out);
    return out;
  }
}

/**
 * Executes an FFmpeg command via child_process.spawn.
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      reject(new Error(`Gagal menjalankan FFmpeg (${FFMPEG_BIN}): ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg keluar dengan kode ${code}: ${stderr.slice(-300)}`));
      }
    });
  });
}

/**
 * Prepares the watermark configuration.
 * Normalizes user input into { type: 'text'|'image', ... }
 */
function normalizeWatermark(options = {}) {
  let wm = options.watermark || null;

  if (typeof wm === 'string') {
    return {
      type: 'text',
      text: wm,
      opacity: options.watermarkOpacity ?? 0.85,
      color: options.watermarkColor || 'white',
    };
  }

  if (options.watermarkText) {
    return {
      type: 'text',
      text: options.watermarkText,
      opacity: options.watermarkOpacity ?? 0.85,
      color: options.watermarkColor || 'white',
    };
  }

  if (options.watermarkImage) {
    return {
      type: 'image',
      image: options.watermarkImage,
      opacity: options.watermarkOpacity ?? 0.6,
      width: options.watermarkWidth || 70,
    };
  }

  if (wm && typeof wm === 'object') {
    if (wm.type === 'image' || wm.image) {
      return {
        type: 'image',
        image: wm.image,
        opacity: wm.opacity ?? 0.6,
        width: wm.width || 70,
      };
    }
    if (wm.type === 'text' || wm.text) {
      return {
        type: 'text',
        text: wm.text,
        opacity: wm.opacity ?? 0.85,
        color: wm.color || 'white',
      };
    }
  }

  return null;
}

/**
 * Builds base scale / crop filter according to aspect ratio setting.
 * - '1:1' (default): crop first to 1:1, then scale to 512x512
 * - 'auto': maintain original aspect ratio (e.g. 9:16), scale within 512x512 apa adanya
 */
function getScaleCropFilter(aspect = '1:1') {
  if (aspect === 'auto') {
    // Keep original aspect ratio within 512x512
    return 'scale=512:512:force_original_aspect_ratio=decrease';
  }
  // 1:1 square crop: crop first to center 1:1, scale to 512x512
  return 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512';
}

/**
 * Searches for an available system font file on Android/Termux or Linux VPS.
 * @returns {string|null}
 */
function getSystemFontFile() {
  const candidates = [
    '/system/fonts/Roboto-Regular.ttf',
    '/system/fonts/DroidSans.ttf',
    '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Escapes text for FFmpeg drawtext filter.
 */
function escapeFfmpegText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%');
}

/**
 * Builds the drawtext filter string for watermark text at bottom-right corner.
 */
function buildTextWatermarkFilter(wm) {
  const escaped = escapeFfmpegText(wm.text);
  const opacity = Math.min(Math.max(Number(wm.opacity) || 0.85, 0.1), 1.0);
  const color = wm.color || 'white';
  const fontFile = getSystemFontFile();
  const fontOption = fontFile ? `:fontfile='${fontFile}'` : '';
  return `drawtext=text='${escaped}'${fontOption}:fontsize=16:fontcolor=${color}@${opacity}:shadowcolor=black@0.7:shadowx=1:shadowy=1:x=w-tw-15:y=h-th-15`;
}

/**
 * Converts a static image to WebP sticker with aspect crop and watermark support.
 */
async function imageToWebp(inputPath, options = {}) {
  const aspect = options.aspect || '1:1';
  const outPath = tmpFile('webp');
  const wm = normalizeWatermark(options);
  const scaleCrop = getScaleCropFilter(aspect);

  let tempWmPath = null;
  try {
    const args = ['-y', '-i', inputPath];

    if (!wm) {
      // No watermark: crop/scale only
      args.push(
        '-vcodec', 'libwebp',
        '-vf', `${scaleCrop},fps=15`,
        '-loop', '1',
        '-preset', 'icon',
        '-an',
        '-qscale', '75',
        outPath
      );
    } else if (wm.type === 'text') {
      // Text watermark: crop first, then draw text at bottom-right corner
      const textFilter = buildTextWatermarkFilter(wm);

      args.push(
        '-vcodec', 'libwebp',
        '-vf', `${scaleCrop},fps=15,${textFilter}`,
        '-loop', '1',
        '-preset', 'icon',
        '-an',
        '-qscale', '75',
        outPath
      );
    } else if (wm.type === 'image') {
      // Image watermark: crop base first, then overlay image watermark at bottom-right with opacity
      tempWmPath = tmpFile('wm');
      if (Buffer.isBuffer(wm.image)) {
        fs.writeFileSync(tempWmPath, wm.image);
      } else if (typeof wm.image === 'string' && fs.existsSync(wm.image)) {
        fs.copyFileSync(wm.image, tempWmPath);
      } else {
        throw new Error('Watermark image must be a Buffer or an existing file path.');
      }

      const wmWidth = Number(wm.width) || 70;
      const opacity = Math.min(Math.max(Number(wm.opacity) || 0.6, 0.1), 1.0);

      // Input 0: base image, Input 1: watermark image
      args.push('-i', tempWmPath);
      const filterComplex = `[0:v]${scaleCrop},fps=15[base];[1:v]format=rgba,colorchannelmixer=aa=${opacity},scale=${wmWidth}:-1[wm];[base][wm]overlay=W-w-15:H-h-15`;

      args.push(
        '-filter_complex', filterComplex,
        '-vcodec', 'libwebp',
        '-loop', '1',
        '-preset', 'icon',
        '-an',
        '-qscale', '75',
        outPath
      );
    }

    await runFfmpeg(args);
    return outPath;
  } finally {
    if (tempWmPath) safeUnlink(tempWmPath);
  }
}

/**
 * Converts a video/GIF to animated WebP sticker with tier reduction and watermark support.
 */
async function videoToWebp(inputPath, fps = 15, duration = 8, options = {}) {
  const aspect = options.aspect || '1:1';
  const outPath = tmpFile('webp');
  const wm = normalizeWatermark(options);
  const scaleCrop = getScaleCropFilter(aspect);

  let tempWmPath = null;
  try {
    const args = ['-y', '-i', inputPath];

    if (!wm) {
      args.push(
        '-vcodec', 'libwebp',
        '-vf', `${scaleCrop},fps=${fps}`,
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-t', String(duration),
        '-qscale', '75',
        outPath
      );
    } else if (wm.type === 'text') {
      const textFilter = buildTextWatermarkFilter(wm);

      args.push(
        '-vcodec', 'libwebp',
        '-vf', `${scaleCrop},fps=${fps},${textFilter}`,
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-t', String(duration),
        '-qscale', '75',
        outPath
      );
    } else if (wm.type === 'image') {
      tempWmPath = tmpFile('wm');
      if (Buffer.isBuffer(wm.image)) {
        fs.writeFileSync(tempWmPath, wm.image);
      } else if (typeof wm.image === 'string' && fs.existsSync(wm.image)) {
        fs.copyFileSync(wm.image, tempWmPath);
      } else {
        throw new Error('Watermark image must be a Buffer or an existing file path.');
      }

      const wmWidth = Number(wm.width) || 70;
      const opacity = Math.min(Math.max(Number(wm.opacity) || 0.6, 0.1), 1.0);

      args.push('-i', tempWmPath);
      const filterComplex = `[0:v]${scaleCrop},fps=${fps}[base];[1:v]format=rgba,colorchannelmixer=aa=${opacity},scale=${wmWidth}:-1[wm];[base][wm]overlay=W-w-15:H-h-15`;

      args.push(
        '-filter_complex', filterComplex,
        '-vcodec', 'libwebp',
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-t', String(duration),
        '-qscale', '75',
        outPath
      );
    }

    await runFfmpeg(args);
    return outPath;
  } finally {
    if (tempWmPath) safeUnlink(tempWmPath);
  }
}

/**
 * Progressively compresses animated video across tiers to fit under 500 KB.
 */
async function makeAnimatedWebp(inputPath, options = {}) {
  let outPath = null;
  for (let i = 0; i < ANIMATED_TIERS.length; i++) {
    const { fps, duration } = ANIMATED_TIERS[i];
    if (outPath) safeUnlink(outPath);
    outPath = await videoToWebp(inputPath, fps, duration, options);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size <= MAX_ANIMATED_BYTES) {
      break;
    }
  }
  return outPath;
}

/**
 * Creates a WhatsApp WebP sticker from media Buffer.
 * Supports static images, video/GIF, custom pack & author, aspect ratio (1:1 crop or auto), and watermark.
 *
 * @param {Buffer} mediaBuffer - Raw media buffer
 * @param {string} mime - MIME type (e.g. 'image/jpeg', 'image/png', 'video/mp4', 'image/gif')
 * @param {object} [metadata={}] - Options:
 *   - pack / packname {string}: Sticker pack name
 *   - author {string}: Sticker author
 *   - emojis / categories {string[]}: Category emojis
 *   - aspect {'1:1'|'auto'}: '1:1' crops first to square; 'auto' preserves original aspect ratio
 *   - watermark {string|object}: Text watermark or { type: 'text'|'image', text, image, opacity, color }
 *   - watermarkText {string}: Shorthand for text watermark
 *   - watermarkImage {Buffer|string}: Shorthand for image watermark
 *   - watermarkOpacity {number}: Watermark opacity (default: 0.6 for image, 0.85 for text)
 * @returns {Promise<Buffer>} Final WebP sticker buffer with injected EXIF metadata
 */
export async function makeSticker(mediaBuffer, mime = 'image/jpeg', metadata = {}) {
  if (!Buffer.isBuffer(mediaBuffer) || mediaBuffer.length === 0) {
    throw new Error('mediaBuffer harus berupa Buffer yang valid dan tidak kosong.');
  }

  // Support makeSticker(buffer, options) signature
  if (mime && typeof mime === 'object' && !Array.isArray(mime)) {
    metadata = mime;
    mime = metadata.mimetype || metadata.mime || null;
  }

  // Auto-detect MIME type from buffer headers if not explicitly specified
  if (!mime || mime === 'image/jpeg') {
    if (mediaBuffer.length > 8) {
      if (mediaBuffer[0] === 0xff && mediaBuffer[1] === 0xd8) mime = 'image/jpeg';
      else if (mediaBuffer[0] === 0x89 && mediaBuffer[1] === 0x50 && mediaBuffer[2] === 0x4e && mediaBuffer[3] === 0x47) mime = 'image/png';
      else if (mediaBuffer.slice(0, 4).toString('ascii') === 'RIFF' && mediaBuffer.slice(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
      else if (mediaBuffer.slice(0, 3).toString('ascii') === 'GIF') mime = 'image/gif';
      else if (mediaBuffer.slice(4, 8).toString('ascii') === 'ftyp') mime = 'video/mp4';
    }
  }

  mime = mime || 'image/jpeg';
  const isAnimated = (mime && (mime.startsWith('video') || mime === 'image/gif')) || false;
  const ext = (mime ? mime.split('/')[1] : 'bin') || 'bin';
  const inputTmp = tmpFile(ext);
  fs.writeFileSync(inputTmp, mediaBuffer);

  let webpTmp = null;
  let exifTmp = null;

  try {
    const packName = metadata.pack || metadata.packname || 'Sakanaa-Whatswap';
    const author = metadata.author || 'Sakanaa Bot';
    const emojis = metadata.emojis || metadata.categories || ['🌸'];

    if (isAnimated) {
      webpTmp = await makeAnimatedWebp(inputTmp, metadata);
    } else {
      webpTmp = await imageToWebp(inputTmp, metadata);
    }

    exifTmp = await writeExif(webpTmp, packName, author, emojis);
    return fs.readFileSync(exifTmp);
  } finally {
    safeUnlink(inputTmp, webpTmp, exifTmp);
  }
}

/**
 * Explicit helper to create a sticker with watermark and custom pack/author.
 */
export async function createStickerWithWatermark(mediaBuffer, mime, options = {}) {
  if (mime && typeof mime === 'object' && !Array.isArray(mime)) {
    options = mime;
    mime = options.mimetype || options.mime || 'image/jpeg';
  }
  return makeSticker(mediaBuffer, mime, options);
}

export const stickerLib = {
  makeSticker,
  createStickerWithWatermark,
  buildExifBuffer,
  injectExif,
  writeExif,
  MAX_ANIMATED_BYTES,
  ANIMATED_TIERS,
};

export default stickerLib;
