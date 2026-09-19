# 📱 Panduan Interactive Message Builder (`AIRich`, `Button`, `Carousel`)

`sakanaa-whatswap` menyediakan antarmuka builder pesan interaktif modern untuk membuat tampilan WhatsApp kaya (Rich AI responses, buttons, horizontal carousel, interactive cards, live message editing, code highlighting, tables, widgets, dan media).

---

## 🚀 Import Modul

```javascript
import {
  AIRich,
  Button,
  ButtonV2,
  Carousel,
  Toolkit,
} from 'sakanaa-whatswap';
```

---

## 💡 Contoh Interaktif Lengkap (Live Message Tour)

Pesan berikut mendemonstrasikan pembuatan pesan kaya (`AIRich`) yang dapat diperbarui secara live (`sendEdit`) dengan *placeholder loading*, blok kode, tabel, kartu carousel terintegrasi, widget, dan tombol aksi footer.

```javascript
import { BaileysConnection, AIRich } from 'sakanaa-whatswap';
import { delay } from '@whiskeysockets/baileys';

const client = new BaileysConnection({ sessionName: 'session' });
await client.connectWithPairing('6281234567890');

client.on('messages.upsert', async ({ messages }) => {
  const m = messages[0];
  if (!m.message || m.key.fromMe) return;

  const jid = m.key.remoteJid;
  const text = m.message.conversation || m.message.extendedTextMessage?.text;

  if (text === '!tour') {
    const conn = client.sock;

    // 1. Inisialisasi pesan awal
    const rich = new AIRich(conn)
      .setTitle('Interactive Message Builder')
      .addText('Halo! Selamat datang di **Interactive Message Builder** 👋', { id: 'intro' })
      .setFooter('Dibuat dengan Sakanaa-Whatswap');

    // Kirim pesan awal
    await rich.send(jid);
    await delay(1500);

    // 2. Tambahkan teks sambutan dan saran cepat (suggestions)
    rich.addText('Ini adalah demonstrasi interaktif. Semua konten di bawah diperbarui langsung di dalam pesan ini.', {
      insertAt: 'intro',
      id: 'welcome',
    });
    rich.addSuggest(['Mulai Tour', 'Fitur Rich', 'Bantuan']);

    await rich.sendEdit();
    await delay(1800);

    // 3. Status Memuat (Loading Placeholder)
    rich.addText('Pertama, status memuat (loading states). Konten placeholder tampil terlebih dahulu, kemudian digantikan saat media siap.', {
      insertAt: 'welcome',
      id: 'loading_intro',
    });

    await rich.sendEdit();
    await delay(1500);

    // Placeholder Gambar (Generating)
    rich.addImage('', {
      status: 'GENERATING',
      update_text: 'Sedang membuat gambar...',
      insertAt: 'loading_intro',
      id: 'image1',
    });

    await rich.sendEdit();
    await delay(2500);

    // Ganti Placeholder dengan Gambar Asli
    rich.addImage('https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500', {
      replace: 'image1',
    });

    await rich.sendEdit();
    await delay(2000);

    // 4. Placeholder Video (Generating -> Selesai)
    rich.addText('Video juga mendukung alur loading yang sama.', {
      insertAt: 'image1',
      id: 'video_intro',
    });

    await rich.sendEdit();
    await delay(1500);

    rich.addVideo('', {
      status: 'GENERATING',
      estimatedTime: 3000,
      insertAt: 'video_intro',
      id: 'video1',
    });

    await rich.sendEdit();
    await delay(3000);

    rich.addVideo('https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4', {
      replace: 'video1',
    });

    await rich.sendEdit();
    await delay(2000);

    // 5. Blok Kode dengan Penyorotan Sintaks (Code Block)
    rich.addText('Mendukung blok kode dengan syntax highlighting:', {
      insertAt: 'video1',
      id: 'code_intro',
    });

    await rich.sendEdit();
    await delay(1200);

    rich.addCode(
      'javascript',
      `function sapa(nama) {\n  return \`Halo, \${nama}!\`;\n}\n\nconsole.log(sapa('Pengguna'));`,
      { insertAt: 'code_intro', id: 'code1' }
    );

    await rich.sendEdit();
    await delay(2000);

    // 6. Tabel Data
    rich.addText('Mendukung tabel data:', {
      insertAt: 'code1',
      id: 'table_intro',
    });

    await rich.sendEdit();
    await delay(1200);

    rich.addTable(
      [
        ['Nama', 'Peran'],
        ['Pengembang', 'Backend'],
        ['Asisten', 'Bot AI'],
      ],
      {
        insertAt: 'table_intro',
        id: 'table1',
      }
    );

    await rich.sendEdit();
    await delay(2000);

    // 7. Menggabungkan Konten dari Instance AIRich Lain (HScroll Layout)
    rich.addText('Anda juga dapat menyusun konten di instance AIRich terpisah lalu menggunakan kembali itemnya:', {
      insertAt: 'table1',
      id: 'mix_intro',
    });

    await rich.sendEdit();
    await delay(1800);

    const subItems = new AIRich(conn)
      .addProduct({
        title: 'Produk Layanan Bot',
        brand: 'Sakanaa',
        price: 'Gratis / Open Source',
        product_url: 'https://example.com/product',
        image_url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
      })
      .addPost({
        profile: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
        title: 'Di Balik Layar',
        username: 'sakanaa.app',
        verified: true,
        caption: 'Disusun secara terpisah, lalu digabungkan ke pesan utama.',
        thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
        url: 'https://example.com/post',
        source_app: 'INSTAGRAM',
      })
      .addReels({
        profile: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
        username: 'sakanaa.app',
        thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
        url: 'https://example.com/reel',
        verified: true,
      }).items;

    rich.addText('Kartu-kartu di bawah ini berasal dari instance AIRich yang terpisah sepenuhnya.', {
      insertAt: 'mix_intro',
      id: 'mix_note',
    });

    await rich.sendEdit();
    await delay(1500);

    rich.addSection(AIRich.newLayout('HScroll', subItems), {
      insertAt: 'mix_note',
      id: 'mixed_items',
    });

    await rich.sendEdit();
    await delay(3000);

    // 8. Komponen Tip
    rich.addTip(
      'Produk, Post, dan Reels di atas dibuat terpisah, diekstrak dengan .items, lalu dimasukkan ke sini menggunakan .addSection().',
      { insertAt: 'mixed_items', id: 'mix_explain' }
    );

    await rich.sendEdit();
    await delay(2500);

    // 9. Lanjutkan Penyusunan di Bawah Bagian Mixed
    rich.addText('Anda dapat terus menyusun konten di bawah bagian yang digabungkan secara normal.', {
      insertAt: 'mix_explain',
      id: 'after_mix',
    });

    await rich.sendEdit();
    await delay(1800);

    // 10. Kartu Sumber Tautan (Source Cards)
    rich.addSource(
      [
        {
          icon: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
          url: 'https://example.com/docs',
          title: 'Dokumentasi Resmi',
          subtitle: 'Panduan Lengkap Interactive Message',
        },
      ],
      {
        insertAt: 'after_mix',
        id: 'source1',
      }
    );

    await rich.sendEdit();
    await delay(1800);

    // 11. Multi-Item Reels Carousel
    rich.addReels(
      [
        {
          profile: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
          username: 'sakanaa.app',
          thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
          url: 'https://example.com/reel1',
          verified: true,
        },
        {
          profile: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
          username: 'sakanaa.app',
          thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
          url: 'https://example.com/reel2',
          verified: true,
        },
        {
          profile: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
          username: 'sakanaa.app',
          thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
          url: 'https://example.com/reel3',
          verified: true,
        },
        {
          profile: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
          username: 'sakanaa.app',
          thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500',
          url: 'https://example.com/reel4',
          verified: true,
        },
      ],
      {
        insertAt: 'source1',
        id: 'reels1',
      }
    );

    await rich.sendEdit();
    await delay(2200);

    // 12. Widget Aksi Cepat
    rich.addWidget(
      {
        title: 'Aksi Cepat',
        sections: [],
        actions: [
          {
            label: 'Info Lanjutan',
            kind: 'OTHER',
            state: 'PENDING',
            id: 'info_action',
          },
        ],
      },
      {
        insertAt: 'reels1',
        id: 'widget1',
      }
    );

    await rich.sendEdit();
    await delay(2000);

    // 13. Tombol Aksi Footer
    rich.addFooterAction(
      {
        text: 'Kunjungi Website',
        url: 'https://example.com',
      },
      {
        id: 'footer1',
      }
    );

    await rich.sendEdit();
    await delay(2500);

    // 14. Metadata Sementara & Penghapusan Dinamis (Dynamic Delete)
    rich.addMetadata(
      'Itulah alur kerja dasarnya: buat, sisipkan, ganti (replace), gabungkan (mix), dan terus bangun ke bawah dalam satu pesan yang dapat diedit.',
      { id: 'cleanup_intro', insertAt: 'reels1' }
    );

    await rich.sendEdit();
    await delay(3000);

    // Hapus bagian sementara secara dinamis
    rich.delete('cleanup_intro');
    await rich.sendEdit();
    await delay(400);

    // 15. Pesan Penutup
    rich.addText(
      'Selesai! Itulah seluruh demonstrasi Interactive Message Builder — dibuat langsung secara live, diedit langsung di obrolan, dan digabungkan dari instance terpisah. 🚀',
      { insertAt: 'widget1', id: 'final' }
    );

    await rich.sendEdit();
  }
});
```

---

## 🔘 Button & ButtonV2 Builder

Untuk tombol aksi interaktif (Reply, Call, Link/URL, Single Select List):

```javascript
import { Button } from 'sakanaa-whatswap';

const btn = new Button(client.sock)
  .setBody('Silakan pilih opsi berikut:')
  .setFooter('Pilihan Menu')
  .addReply('Menu 1', 'id_menu_1')
  .addReply('Menu 2', 'id_menu_2')
  .addCall('Hubungi Dukungan', '6281234567890');

// Tambahkan pilihan daftar (Single Select List)
btn.addSelection('Buka Daftar Menu')
  .makeSection('Makanan')
  .makeRow('', 'Nasi Goreng', 'Nasi goreng lezat', 'row_1')
  .makeRow('', 'Mie Goreng', 'Mie goreng spesial', 'row_2');

// Kirim ke pengguna
await btn.send(jid);
```

---

## 🎠 Carousel Builder

Untuk kartu geser horizontal (Horizontal Cards):

```javascript
import { Carousel, Button } from 'sakanaa-whatswap';

const carousel = new Carousel(client.sock)
  .setBody('Katalog Pilihan:');

// 1. Buat kartu menggunakan Button builder dengan gambar/media header
const card1 = new Button(client.sock)
  .setImage('https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500')
  .setBody('Item Pertama: Layanan Cloud & Bot')
  .setFooter('Rp 50.000')
  .addReply('Beli Sekarang', 'buy_1');

const card2 = new Button(client.sock)
  .setImage('https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500')
  .setBody('Item Kedua: Layanan API WhatsApp')
  .setFooter('Rp 75.000')
  .addReply('Beli Sekarang', 'buy_2');

// 2. Build kartu ke format pesan interaktif
const builtCard1 = await card1.build(jid);
const builtCard2 = await card2.build(jid);

// 3. Masukkan ke dalam Carousel
carousel.addCard([
  builtCard1.message.interactiveMessage,
  builtCard2.message.interactiveMessage
]);

await carousel.send(jid);
```
