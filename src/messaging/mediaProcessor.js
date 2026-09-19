/**
 * Sakanaa-Whatswap - Media Processor
 * Pure-JS & system FFmpeg/FFprobe based media processing designed for Termux & Linux.
 * Zero native C++ node-gyp dependencies.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import webpmux from 'node-webpmux';
import { logger as defaultLogger } from '../core/logger.js';
import { makeSticker } from './stickerLib.js';

export class MediaProcessor {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
    this.tmpDir = path.join(process.cwd(), 'tmp');
    this.defaultPack = options.pack || 'Sakanaa-Whatswap';
    this.defaultAuthor = options.author || 'Sakanaa Bot';
    this.ensureTmpDir();
  }

  /**
   * Ensures the local isolated ./tmp directory exists.
   */
  ensureTmpDir() {
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  /**
   * Generates a unique temporary file path within ./tmp.
   * @param {string} [extension='tmp']
   * @returns {string}
   */
  getTmpFilePath(extension = 'tmp') {
    this.ensureTmpDir();
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const randomName = `sakanaa_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    return path.join(this.tmpDir, randomName);
  }

  /**
   * Safely deletes a temporary file.
   * @param {string} filePath
   */
  async cleanupTmpFile(filePath) {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      this.logger.debug('SISTEM', `Gagal membersihkan file tmp ${filePath}: ${err.message}`);
    }
  }

  /**
   * Cleans all temporary files inside the isolated ./tmp directory.
   */
  cleanupAllTmp() {
    try {
      if (fs.existsSync(this.tmpDir)) {
        const files = fs.readdirSync(this.tmpDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.tmpDir, file));
          } catch {
            // ignore individual unlinks
          }
        }
      }
    } catch (err) {
      this.logger.debug('SISTEM', `Error membersihkan folder tmp: ${err.message}`);
    }
  }

  /**
   * Converts Buffer, local file path, or remote URL to a Buffer.
   * @param {Buffer|string} source
   * @returns {Promise<Buffer>}
   */
  async toBuffer(source) {
    if (!source) {
      throw new Error('Sumber media tidak boleh kosong.');
    }

    if (Buffer.isBuffer(source)) {
      return source;
    }

    if (typeof source === 'string') {
      const trimmed = source.trim();

      // Remote HTTP/HTTPS URL
      if (/^https?:\/\//i.test(trimmed)) {
        const response = await fetch(trimmed, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0',
          },
        });
        if (!response.ok) {
          throw new Error(`Gagal mengunduh media dari URL: HTTP ${response.status} ${response.statusText}`);
        }
        const arrayBuf = await response.arrayBuffer();
        return Buffer.from(arrayBuf);
      }

      // Local file path
      const resolved = path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
      if (fs.existsSync(resolved)) {
        return await fs.promises.readFile(resolved);
      }

      // Base64 data URL
      if (trimmed.startsWith('data:')) {
        const base64Part = trimmed.split(',')[1];
        return Buffer.from(base64Part, 'base64');
      }

      // Raw base64 string check
      if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 100) {
        return Buffer.from(trimmed, 'base64');
      }
    }

    throw new Error('Format sumber media tidak dikenali (harus Buffer, path lokal, atau URL).');
  }

  /**
   * Executes an external process (FFmpeg / FFprobe) and returns stdout buffer.
   * @param {string} command - 'ffmpeg' or 'ffprobe'
   * @param {string[]} args
   * @returns {Promise<{ stdout: string, stderr: string }>}
   */
  runProcess(command, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Gagal menjalankan ${command}: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`${command} keluar dengan kode ${code}: ${stderr.slice(-300)}`));
        }
      });
    });
  }

  /**
   * Probes video file to inspect video codec using ffprobe.
   * @param {string} filePath
   * @returns {Promise<string>} codec name (e.g. 'h264', 'hevc', 'vp9')
   */
  async probeVideoCodec(filePath) {
    try {
      const { stdout } = await this.runProcess('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      return stdout.trim().toLowerCase();
    } catch (err) {
      this.logger.debug('MSG', `ffprobe gagal membaca codec: ${err.message}`);
      return 'unknown';
    }
  }

  /**
   * Processes input audio/video into Ogg/Opus mono for voice notes (PTT).
   * Command: ffmpeg -i input -c:a libopus -ac 1 -avoid_negative_ts make_zero output.ogg
   * @param {Buffer|string} source
   * @returns {Promise<{ buffer: Buffer, mimetype: string, ptt: boolean }>}
   */
  async processVoice(source) {
    const inputBuf = await this.toBuffer(source);
    const inputPath = this.getTmpFilePath('input_audio');
    const outputPath = this.getTmpFilePath('ogg');

    await fs.promises.writeFile(inputPath, inputBuf);

    try {
      await this.runProcess('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-c:a',
        'libopus',
        '-ac',
        '1',
        '-b:a',
        '48k',
        '-avoid_negative_ts',
        'make_zero',
        outputPath,
      ]);

      const buffer = await fs.promises.readFile(outputPath);
      return {
        buffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      };
    } finally {
      await this.cleanupTmpFile(inputPath);
      await this.cleanupTmpFile(outputPath);
    }
  }

  /**
   * Processes video, auto-transcoding H.265/HEVC to H.264 (yuv420p).
   * If already H.264, returns source buffer without re-encoding to save CPU.
   * @param {Buffer|string} source
   * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
   */
  async processVideo(source) {
    const inputBuf = await this.toBuffer(source);
    const inputPath = this.getTmpFilePath('mp4');
    await fs.promises.writeFile(inputPath, inputBuf);

    try {
      const codec = await this.probeVideoCodec(inputPath);
      const isH265 = codec === 'hevc' || codec === 'h265';

      if (!isH265 && (codec === 'h264' || codec === 'avc1')) {
        // Fast-path: already valid H.264, no re-encoding required
        return {
          buffer: inputBuf,
          mimetype: 'video/mp4',
        };
      }

      // Transcode HEVC / other non-standard codecs to standard H.264 + yuv420p
      this.logger.info('MSG', `Transcoding video (${codec || 'non-h264'} -> H.264 yuv420p)...`);
      const outputPath = this.getTmpFilePath('mp4');

      try {
        await this.runProcess('ffmpeg', [
          '-y',
          '-i',
          inputPath,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-preset',
          'ultrafast',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath,
        ]);

        const buffer = await fs.promises.readFile(outputPath);
        return {
          buffer,
          mimetype: 'video/mp4',
        };
      } finally {
        await this.cleanupTmpFile(outputPath);
      }
    } finally {
      await this.cleanupTmpFile(inputPath);
    }
  }

  /**
   * Generates WhatsApp EXIF metadata buffer.
   * @param {object} metadata
   * @returns {Buffer}
   */
  createExifBuffer(metadata = {}) {
    const pack = metadata.pack || this.defaultPack;
    const author = metadata.author || this.defaultAuthor;
    const categories = Array.isArray(metadata.categories) ? metadata.categories : ['🤖'];

    const json = {
      'sticker-pack-id': metadata.id || `sakanaa_${Date.now()}`,
      'sticker-pack-name': pack,
      'sticker-pack-publisher': author,
      'emojis': categories,
    };

    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);

    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    return exif;
  }

  /**
   * Creates a WebP WhatsApp sticker with injected EXIF metadata.
   * Supports 1:1 crop or auto aspect ratio, animated tiers, and watermarks (text/image).
   * @param {Buffer|string} source - Image, GIF, or short video
   * @param {object} [metadata={}] - { pack, author, categories, emojis, aspect, watermark, ... }
   * @returns {Promise<Buffer>} WebP Buffer with EXIF
   */
  async createSticker(source, metadata = {}) {
    const inputBuf = await this.toBuffer(source);

    let mime = metadata.mimetype || metadata.mime || 'image/jpeg';
    if (inputBuf.length > 4) {
      if (inputBuf[0] === 0xff && inputBuf[1] === 0xd8) mime = 'image/jpeg';
      else if (inputBuf[0] === 0x89 && inputBuf[1] === 0x50 && inputBuf[2] === 0x4e && inputBuf[3] === 0x47) mime = 'image/png';
      else if (inputBuf.slice(0, 4).toString('ascii') === 'RIFF' && inputBuf.slice(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
      else if (inputBuf.slice(0, 3).toString('ascii') === 'GIF') mime = 'image/gif';
      else if (inputBuf.slice(4, 8).toString('ascii') === 'ftyp') mime = 'video/mp4';
    }

    const pack = metadata.pack || metadata.packname || this.defaultPack;
    const author = metadata.author || this.defaultAuthor;

    return await makeSticker(inputBuf, mime, {
      pack,
      author,
      emojis: metadata.categories || metadata.emojis,
      ...metadata,
    });
  }
}

export const mediaProcessor = new MediaProcessor();
export default mediaProcessor;
