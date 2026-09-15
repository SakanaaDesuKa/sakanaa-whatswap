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
  - [Stiker & Antrean Stiker](#stiker--antrean-stiker)
  - [Album Media (`sendAlbum`)](#album-media-sendalbum)
  - [Third-Party Sticker Pack (`sendStickerPack`)](#third-party-sticker-pack-sendstickerpack)
  - [Dokumen, Polling, & Kontak](#dokumen-polling--kontak)
- [Aksi Pesan & Chat](#-aksi-pesan--chat)
  - [Reaksi, Edit, & Hapus Pesan](#reaksi-edit--hapus-pesan)
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

### Stiker & Antrean Stiker

```javascript
// Kirim Stiker WebP dengan metadata EXIF (packname & author)
await client.sendSticker(jid, './gambar.png', {
  pack: 'My Sticker Pack',
  author: 'Sakanaa Bot'
});

// Kirim beberapa stiker berurutan dengan jeda aman
await client.sendPackSticker(jid, [
  './stiker1.webp',
  './stiker2.webp'
]);
```

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

### Reaksi, Edit, & Hapus Pesan

```javascript
// Beri Reaksi Emoji
await client.react(jid, m.key, '👍');

// Hapus Reaksi
await client.unreact(jid, m.key);

// Edit Pesan Terkirim
await client.editMessage(jid, m.key, 'Teks telah diperbarui');

// Hapus Pesan untuk Semua Orang (Revoke)
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
