# 🐟 sakanaa-whatswap

> Library WhatsApp Multi-Device yang tangguh, ringan, dan efisien berbasis `@whiskeysockets/baileys` v7. Dirancang dengan kompatibilitas penuh untuk **Termux (Android)**, **Linux VPS**, **Pterodactyl Panel**, dan **Docker**.

---

## 📑 Daftar Isi

- [Instalasi](#-instalasi)
- [Koneksi Akun](#-koneksi-akun)
  - [Pairing Code (Rekomendasi CLI / Termux)](#pairing-code)
  - [QR Code Terminal](#qr-code-terminal)
- [Pengiriman Pesan](#-pengiriman-pesan)
  - [Pesan Teks & Media](#pesan-teks--media)
  - [Stiker, Watermark, & Antrean Stiker](#stiker-watermark--antrean-stiker)
  - [Pesan Interaktif (`AIRich`, `Button`, `Carousel`)](#-pesan-interaktif-airich-button-carousel)
  - [Album Media (`sendAlbum`)](#album-media-sendalbum)
  - [Third-Party Sticker Pack (`sendStickerPack`)](#third-party-sticker-pack-sendstickerpack)
  - [Dokumen, Polling, & Kontak](#dokumen-polling--kontak)
- [Aksi Pesan & Chat](#-aksi-pesan--chat)
  - [Reaksi, Edit Pesan (Teks & Media), & Hapus Pesan](#reaksi-edit-pesan-teks--media--hapus-pesan)
  - [Pin, Star, Mute, & Archive](#pin-star-mute--archive)
- [Resolusi Identitas (LID ↔ PN)](#-resolusi-identitas-lid--pn)
- [Manajemen Grup](#-manajemen-grup)
- [Media & Unduhan](#-media--unduhan)
- [Daftar Method Lengkap](#-daftar-method-lengkap)
- [Catatan Teknis](#-catatan-teknis)
- [Penafian & Lisensi](#-penafian--lisensi)

---

## 📦 Instalasi

### Dari GitHub:
```bash
npm install github:SakanaaDesuKa/sakanaa-whatswap
```

> [!TIP]
> **Catatan untuk Pterodactyl / Node.js 24+ (Error `EALLOWGIT`):**  
> Pada versi npm terbaru (npm 12+), pengambilan dependensi dari GitHub dibatasi secara *default* oleh kebijakan keamanan `EALLOWGIT`. Agar dapat mengunduh library, buat berkas **`.npmrc`** di direktori utama bot Anda (sejajar dengan `package.json`) berisi:
> ```ini
> allow-git=all
> ```
> Atau set variabel lingkungan pada tab **Startup** Pterodactyl: `NPM_CONFIG_ALLOW_GIT=all`.

### Prasyarat Sistem:
- **Node.js**: Versi `≥ 20.0.0` (ESM murni)
- **FFmpeg & FFprobe**: Tersedia di PATH sistem untuk pemrosesan media.
  - Termux: `pkg install nodejs-lts ffmpeg`
  - Ubuntu / Debian: `sudo apt update && sudo apt install -y ffmpeg`

---

## ⚡ Koneksi Akun

### Pairing Code

```javascript
import { BaileysConnection } from 'sakanaa-whatswap';

const client = new BaileysConnection({
  sessionName: 'session',
});

// Masukkan nomor WhatsApp tanpa tanda '+' (contoh: 6281234567890)
await client.connectWithPairing('6281234567890');

client.on('open', ({ user }) => {
  console.log(`Bot aktif sebagai: ${user.id}`);
});

client.on('messages.upsert', async ({ messages }) => {
  const m = messages[0];
  if (!m.message || m.key.fromMe) return;

  const jid = m.key.remoteJid;
  const text = m.message.conversation || m.message.extendedTextMessage?.text;

  if (text === '!ping') {
    await client.sendText(jid, 'Pong!');
  }
});
```

### QR Code Terminal

```javascript
import { BaileysConnection } from 'sakanaa-whatswap';

const client = new BaileysConnection({
  sessionName: 'session',
});

await client.connectWithQR();
```

---

## ✉️ Pengiriman Pesan

### Pesan Teks & Media

```javascript
// Kirim Teks
await client.sendText(jid, 'Halo dari Sakanaa-Whatswap!');

// Kirim Gambar (Buffer, path file lokal, atau URL)
await client.sendImg(jid, './gambar.jpg', 'Keterangan gambar');

// Kirim Video (Otomatis transcode ke format MP4 H.264 yang didukung WhatsApp)
await client.sendVideo(jid, './video.mp4', 'Keterangan video');

// Kirim Voice Note PTT (Otomatis konversi ke Ogg/Opus mono)
await client.sendVoice(jid, './rekaman.mp3');

// Kirim Audio / Musik biasa
await client.sendAudio(jid, './lagu.mp3');
```

### Stiker, Watermark, & Antrean Stiker

`sakanaa-whatswap` dilengkapi engine pembuatan stiker tingkat lanjut (`stickerLib`) berbasis FFmpeg murni dan `node-webpmux`. Mendukung stiker gambar statis, animasi (video/GIF) dengan kompresi bertingkat otomatis (<500 KB), rasio aspek kustom (`1:1` atau `auto`), dan *watermark* dinamis (teks atau gambar transparan).

```javascript
// 1. Stiker 1:1 standar dengan custom pack & author
await client.sendSticker(jid, './gambar.jpg', {
  pack: 'My Sticker Pack',
  author: 'Sakanaa Bot',
  aspect: '1:1', // Default: potong/crop center ke rasio 1:1
});

// 2. Stiker rasio asli ("auto" / apa adanya, misal 9:16 atau 4:3)
await client.sendSticker(jid, './story_9_16.jpg', {
  pack: 'Sakanaa Pack',
  author: 'Sakanaa Bot',
  aspect: 'auto', // Mempertahankan rasio aspek gambar apa adanya tanpa pemotongan paksa
});

// 3. Stiker dengan Watermark Teks (tepat di pojok kanan bawah kecil)
// Catatan: Gambar dipotong (crop) terlebih dahulu sebelum kanvas watermark diterapkan
await client.sendSticker(jid, './foto.png', {
  pack: 'Sakanaa Pack',
  author: 'Sakanaa Bot',
  aspect: '1:1',
  watermark: {
    type: 'text',
    text: 'SakanaaBot',
    opacity: 0.85, // Transparansi halus
    color: 'white',
  },
});

// 4. Stiker dengan Watermark Gambar / Logo (dengan opacity transparan di pojok kanan bawah)
await client.sendSticker(jid, './foto.png', {
  pack: 'Sakanaa Pack',
  author: 'Sakanaa Bot',
  watermark: {
    type: 'image',
    image: './logo.png', // Buffer atau path lokal gambar watermark
    opacity: 0.6, // Transparansi sedikit transparan
    width: 70, // Ukuran kecil pas di pojok
  },
});

// 5. Stiker Animasi (Video MP4 / GIF) — Otomatis kompresi bitrate/fps agar <500 KB
await client.sendSticker(jid, './klip.mp4', {
  pack: 'Animated Pack',
  author: 'Sakanaa Bot',
});

// 6. Buat Buffer Stiker Langsung (Tanpa Kirim Chat)
import { makeSticker, createStickerWithWatermark } from 'sakanaa-whatswap';

const stickerBuffer = await makeSticker(mediaBuffer, 'image/png', {
  pack: 'Koleksi Saya',
  author: 'Nama Bot',
  aspect: '1:1',
  watermarkText: 'NamaWatermark',
});

// 7. Kirim beberapa stiker berurutan dengan jeda aman
await client.sendPackSticker(jid, [
  './stiker1.webp',
  './stiker2.webp'
]);
```

### 📱 Pesan Interaktif (`AIRich`, `Button`, `Carousel`)

Mendukung pembuatan tampilan antarmuka WhatsApp kaya menggunakan class builder `AIRich`, `Button`, `ButtonV2`, dan `Carousel`:

```javascript
import { AIRich, Button, Carousel } from 'sakanaa-whatswap';

// Contoh pesan kaya interaktif dengan pembaruan live (sendEdit)
const rich = new AIRich(client.sock)
  .setTitle('Menu Interaktif')
  .addText('Halo! Pilih layanan yang Anda butuhkan:')
  .setFooter('Dibuat dengan Sakanaa-Whatswap');

// Kirim pesan awal
const sent = await rich.send(jid);

// Perbarui pesan secara dinamis (live edit)
rich.addText('Berikut daftar pilihan terbaru:', { id: 'daftar' });
rich.addSuggest(['Menu 1', 'Menu 2', 'Bantuan']);
await rich.sendEdit();

// Contoh Tombol Aksi (Button Builder)
const btn = new Button(client.sock)
  .setBody('Silakan klik tombol di bawah:')
  .addReply('Mulai Sekarang', 'btn_start')
  .addCall('Hubungi CS', '6281234567890');
await btn.send(jid);

// Contoh HTML Webview Interaktif (Mini App / Kalkulator / Widget)
import { sendWebview } from 'sakanaa-whatswap';

await sendWebview(client.sock, jid, '<h1>Widget Interaktif</h1><p>Konten HTML langsung di WA</p>', {
  title: 'Interactive View',
  quoted: m,
});
```

> 📖 **Panduan Contoh Lengkap:** Lihat [Panduan Message Builder](docs/MESSAGE_BUILDER.md) untuk demonstrasi lengkap tur interaktif, HTML Webview mini-app (kalkulator), *placeholder loading*, blok kode syntax highlighting, tabel data, widget, dan kartu carousel.

### Album Media (`sendAlbum`)
> Fitur ekstensi khusus: Mengirim beberapa gambar dan video dalam satu pesan album WhatsApp.

```javascript
await client.sendAlbum(jid, [
  { image: './foto1.jpg', caption: 'Foto 1' },
  { image: 'https://example.com/foto2.jpg', caption: 'Foto 2' },
  { video: './video.mp4', caption: 'Video Dokumentasi' }
], { quoted: m });
```

### Third-Party Sticker Pack (`sendStickerPack`)
> Fitur ekstensi khusus: Mengirim sticker pack WhatsApp resmi lengkap dengan cover, publisher, dan mapping emoji.

```javascript
await client.sendStickerPack(jid, {
  name: 'Sakanaa Sticker Pack',
  publisher: 'Sakanaa Team',
  description: 'Koleksi stiker resmi',
  cover: './cover.webp', // Buffer, path lokal, atau URL
  stickers: [
    { data: './stiker1.webp', emojis: ['🔥', '✨'] },
    { data: './stiker2.webp', emojis: ['😂'] },
    './stiker3.webp'
  ]
}, { quoted: m });
```

### Dokumen, Polling, & Kontak

```javascript
// Dokumen / File
await client.sendDoc(jid, './laporan.pdf', 'Laporan.pdf', 'application/pdf', 'Ini laporannya');

// Polling WhatsApp
await client.sendPoll(jid, 'Pilih menu makan siang:', [
  'Nasi Padang',
  'Ayam Bakar',
  'Sate Ayam'
], 1); // 1 = pilihan tunggal

// Kartu Kontak (vCard)
await client.sendContact(jid, {
  displayName: 'Admin Sakanaa',
  phoneNumber: '6281234567890'
});
```

---

## 🎯 Aksi Pesan & Chat

### Reaksi, Edit Pesan (Teks & Media), & Hapus Pesan

`editMessage` (dan aliasnya `messageEdit`) mendukung pengeditan pesan teks biasa maupun pesan media (gambar, video) beserta keterangan (*caption*).

```javascript
// 1. Beri Reaksi Emoji & Hapus Reaksi
await client.react(jid, m.key, '👍');
await client.unreact(jid, m.key);

// 2. Edit Pesan Teks Biasa
await client.editMessage(jid, m.key, 'Teks telah diperbarui.');

// 3. Edit Pesan Media (Perbarui Gambar & Caption Sekaligus)
await client.editMessage(jid, m.key, {
  image: './gambar_baru.jpg',
  caption: 'Keterangan gambar yang telah diedit'
});

// 4. Edit Caption / Keterangan Pesan
await client.editMessage(jid, m.key, {
  caption: 'Hanya memperbarui teks keterangan'
});

// 5. Menggunakan Alias messageEdit
await client.messageEdit(jid, m.key, 'Teks via alias messageEdit');

// 6. Hapus Pesan untuk Semua Orang (Revoke)
await client.deleteMessage(jid, m.key);
```

### Pin, Star, Mute, & Archive

```javascript
// Pin Pesan (durasi detik: 86400 = 24 jam, 604800 = 7 hari, 2592000 = 30 hari)
await client.pinMessage(jid, m.key, 86400);
await client.unpinMessage(jid, m.key);

// Bintang / Star Pesan
await client.starMessage(jid, m.key, true);

// Mute & Unmute Chat
await client.muteChat(jid, 8 * 3600 * 1000, [m]); // Mute 8 jam
await client.unmuteChat(jid, [m]);

// Archive & Unarchive Chat
await client.archiveChat(jid, [m]);
await client.unarchiveChat(jid, [m]);
```

---

## 🆔 Resolusi Identitas (LID ↔ PN)

Baileys v7 menggunakan identitas **LID** (`12345@lid`) secara default pada grup. Resolver dua arah ini mengelola cache secara otomatis:

```javascript
// Resolusi nomor telepon (PN) ke LID
const lid = await client.convertPn('6281234567890');

// Resolusi LID ke nomor telepon (PN)
const pn = await client.convertLid('1234567890@lid');

// Resolusi lengkap
const identity = await client.resolveIdentity('6281234567890');
// Hasil: { pn: '6281234567890@s.whatsapp.net', lid: '...', exists: true, isGroup: false }
```

---

## 👥 Manajemen Grup

Metadata grup di-cache secara otomatis dengan pembaruan *real-time* via event socket:

```javascript
// Ambil metadata grup (cache-first)
const metadata = await client.getGroupMetadata(groupJid);

// Cek status admin
const isAdmin = client.isParticipantAdmin(metadata, senderJid);
const isBotAdmin = client.isBotAdmin(metadata);

// Kelola partisipan
await client.groupAdd(groupJid, ['62812xxx@s.whatsapp.net']);
await client.groupKick(groupJid, ['62812xxx@s.whatsapp.net']);
await client.groupPromote(groupJid, ['62812xxx@s.whatsapp.net']);
await client.groupDemote(groupJid, ['62812xxx@s.whatsapp.net']);

// Pengaturan grup
await client.updateGroupSubject(groupJid, 'Nama Grup Baru');
await client.updateGroupDescription(groupJid, 'Deskripsi baru');
await client.updateGroupSetting(groupJid, 'announcement'); // 'announcement' | 'not_announcement'

// Link Undangan
const inviteCode = await client.getGroupInviteCode(groupJid);
await client.revokeGroupInviteCode(groupJid);
await client.acceptGroupInvite('https://chat.whatsapp.com/xxx');
```

---

## 📥 Media & Unduhan

Mengunduh media pesan (gambar, video, audio, stiker, dokumen) secara langsung:

```javascript
const buffer = await client.downloadMediaMessage(m);
```

---

## 📋 Daftar Method Lengkap

| Kategori | Method | Deskripsi |
|---|---|---|
| **Koneksi** | `connectWithPairing(number, opts)` | Hubungkan via 8-digit Pairing Code |
| | `connectWithQR(opts)` | Hubungkan via QR Code di terminal |
| | `disconnect()` | Putuskan koneksi soket dengan bersih |
| | `getSocket()` | Dapatkan instance raw Baileys WASocket |
| **Pesan** | `sendText(jid, text, opts)` | Kirim teks |
| | `sendImg(jid, src, caption, opts)` | Kirim gambar |
| | `sendVideo(jid, src, caption, opts)` | Kirim video |
| | `sendVoice(jid, src, opts)` | Kirim VN / voice note (PTT) |
| | `sendAudio(jid, src, opts)` | Kirim audio |
| | `sendSticker(jid, src, opts)` | Kirim stiker WebP |
| | `sendPackSticker(jid, arraySrc, opts)` | Kirim stiker berurutan |
| | `sendAlbum(jid, items, opts)` | Kirim album media |
| | `sendStickerPack(jid, packData, opts)` | Kirim third-party sticker pack resmi |
| | `sendDoc(jid, src, filename, mime, caption, opts)` | Kirim dokumen |
| | `sendPoll(jid, name, options, count, opts)` | Kirim polling |
| | `sendContact(jid, contactData, opts)` | Kirim kontak vCard |
| | `sendStatus(content, statusJidList, opts)` | Kirim status story WhatsApp |
| **Aksi Pesan** | `react(jid, key, emoji)` | Reaksi emoji |
| | `unreact(jid, key)` | Hapus reaksi emoji |
| | `editMessage(jid, key, newText)` | Edit teks pesan |
| | `deleteMessage(jid, key)` | Hapus pesan untuk semua orang |
| | `pinMessage(jid, key, durationSeconds)` | Sematkan (pin) pesan |
| | `unpinMessage(jid, key)` | Lepas sematan pesan |
| | `starMessage(jid, key, star)` | Tandai / lepas bintang pesan |
| **Chat & Privasi** | `muteChat(jid, durationMs, lastMsgs)` | Mute obrolan |
| | `unmuteChat(jid, lastMsgs)` | Unmute obrolan |
| | `archiveChat(jid, lastMsgs)` | Arsipkan obrolan |
| | `unarchiveChat(jid, lastMsgs)` | Buka arsip obrolan |
| | `blockUser(jid)` / `unblockUser(jid)` | Blokir / buka blokir pengguna |
| | `fetchPrivacySettings()` | Ambil konfigurasi privasi akun |
| **Identitas** | `convertPn(pnJidOrNumber)` | Konversi nomor ke LID |
| | `convertLid(lidJid)` | Konversi LID ke nomor |
| | `resolveIdentity(jidOrNumber)` | Resolusi dua arah PN & LID |
| **Grup** | `getGroupMetadata(jid, forceRefresh)` | Ambil metadata grup dari cache |
| | `isParticipantAdmin(metadata, participantJid)` | Periksa status admin pengguna |
| | `isBotAdmin(metadata)` | Periksa status admin bot |
| | `groupAdd` / `groupKick` / `groupPromote` / `groupDemote` | Manajemen peserta grup |
| | `updateGroupSubject` / `updateGroupDescription` | Ubah subjek / deskripsi grup |
| | `getGroupInviteCode` / `revokeGroupInviteCode` | Kelola link undangan grup |
| | `acceptGroupInvite(code)` | Masuk grup lewat kode/link |

---

## ⚙️ Catatan Teknis

- **Baileys v7 Core**: Menggunakan `@whiskeysockets/baileys: 7.0.0-rc14` yang terhindar dari celah keamanan `CVE-2026-48063`.
- **Termux Wake-Lock**: Otomatis mengaktifkan `termux-wake-lock` saat berjalan di Android untuk mencegah Android Doze mematikan proses koneksi.
- **Pure JavaScript Dependencies**: Tidak memerlukan build tools C++ (`node-gyp`), memastikan instalasi tanpa error di seluruh arsitektur ARM/x64.
- **Smart Reconnection**: Dilengkapi Watchdog timer dan pemulihan koneksi otomatis dengan exponential backoff dan jitter.

---

## 📄 Penafian & Lisensi

Proyek ini dirilis di bawah lisensi [MIT](LICENSE).

**Penafian (*Disclaimer*):**  
Proyek ini **tidak berafiliasi, disponsori, atau didukung secara resmi oleh WhatsApp Inc. atau Meta Platforms, Inc.** Penggunaan otomatisasi WhatsApp adalah tanggung jawab pribadi pengguna masing-masing sesuai Ketentuan Layanan WhatsApp. Dilarang menggunakan library ini untuk spamming atau aktivitas ilegal.
