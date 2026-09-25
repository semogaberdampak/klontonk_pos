# Klontonk POS

Aplikasi kasir (Point of Sales) untuk warung multi-cabang. Berupa **PWA statis** (HTML, CSS, dan modul ES
JavaScript tanpa proses build) dengan **Supabase** sebagai database dan login. Bisa dipasang di HP, dan
penjualan tetap bisa dicatat saat tidak ada internet.

## Fitur

- **Kasir**: cari barang atau scan barcode (kamera), keranjang, pembayaran tunai atau QRIS/transfer, struk.
- **Struk cetak** 58 mm lewat dialog cetak browser (printer thermal, printer biasa, atau simpan sebagai PDF),
  dengan pilihan cetak otomatis.
- **Stok**: stok awal, stok total, retur (pelanggan dan supplier), update harga, impor stok dari CSV.
- **Laporan** siap cetak: stok awal, barang keluar/laku, retur, dan stok total.
- **Multi-tenant**: tiap cabang punya stok dan penjualan sendiri. Kasir hanya melihat cabangnya; admin melihat semua.
- **Offline**: penjualan disimpan di perangkat lalu dikirim otomatis saat internet kembali (lihat di bawah).
- **PWA**: bisa dipasang, halaman offline, Background Sync, share target, protocol handler, file handler (CSV),
  catatan kasir, widget Windows, dan tab strip.

## Menjalankan secara lokal

Tidak ada langkah build. Sajikan folder ini lewat server statis, lalu buka di browser.

```bash
podman compose up -d          # nginx di http://localhost:8080  (hentikan: podman compose down)
# atau, tanpa container:
python3 -m http.server 8080
```

Kamera (scanner) dan Service Worker hanya jalan di **HTTPS atau `localhost`**.

## Menyiapkan database (Supabase)

1. Buat proyek di [Supabase](https://supabase.com).
2. Buka **SQL Editor**, tempel seluruh isi [db/schema.sql](db/schema.sql), lalu **Run**. Berkas ini
   idempoten (aman dijalankan ulang) dan sekaligus menjadi migrasi bila skema berubah.
3. Isi [js/config.js](js/config.js) dengan `SUPABASE_URL` dan kunci **publishable** proyekmu. Kedua nilai itu
   memang publik; keamanan data dijaga oleh RLS di database. **Jangan** menaruh kunci `service_role` atau
   `secret` di repo.
4. Akun dibuat admin lewat halaman **Pengguna**. Akun admin pertama dibuat manual: buat user di
   Authentication (email `<username>@klontonk.local`), lalu tambahkan baris di tabel `profiles` dengan
   peran `admin`. Akun tanpa baris `profiles` tidak punya akses apa pun.

## Cara kerja penjualan dan mode offline

- Penjualan dicatat lewat fungsi database `checkout()`: satu transaksi yang mengunci stok, memeriksa cukup,
  mengurangi stok, menghitung total dari **harga di database**, dan membuat nomor transaksi.
- Setiap penjualan membawa UUID (`client_id`), sehingga mengirim ulang tidak pernah menggandakannya.
- Saat offline, penjualan masuk antrean di perangkat (`localStorage`) dan stok lokal dikurangi. Antrean
  dikirim lewat Background Sync, saat internet kembali, tiap menit, dan saat aplikasi dibuka.
- Bila saat sinkron stok ternyata kurang, penjualan **tetap dicatat** (stok jadi 0) dan diberi catatan
  "perlu ditinjau" di laporan. Harga tidak pernah dipercaya dari perangkat.
- Penjualan yang belum terkirim hilang jika data situs dihapus dari browser, jadi jangan menghapus data
  situs sebelum antrean kosong (kartu **Penjualan Offline** di Pengaturan).

## Notifikasi push

Perangkat yang mengaktifkan **Notifikasi** di Pengaturan menerima: info update dari admin (semua perangkat)
dan penjualan offline yang perlu ditinjau (hanya admin).

Alur: pemicu di database (`app_updates` dan `sales`) memanggil Edge Function `push` lewat `pg_net`; fungsi itu
menandatangani (VAPID) dan mengirim ke layanan push browser. Perangkat mendaftar lewat
`register_push_subscription()`. Kunci VAPID dibuat otomatis oleh fungsi saat pertama dipakai dan disimpan di
`push_config`, tabel yang tertutup untuk semua pengguna (tidak ada kunci rahasia di repo).

Penyiapan proyek baru (setelah menjalankan `db/schema.sql`):

1. Isi konfigurasi. Rahasia dibuat di dalam database, ganti alamat dengan proyekmu:
   ```sql
   insert into public.push_config (id, function_url, webhook_secret)
   values (1, 'https://<ref-proyek>.supabase.co/functions/v1/push', encode(extensions.gen_random_bytes(32), 'hex'))
   on conflict (id) do nothing;
   ```
2. Deploy fungsi dari `supabase/functions/push` dengan verifikasi JWT **dimatikan** (fungsi memeriksa
   otorisasinya sendiri: rahasia bersama untuk database, token login untuk notifikasi uji):
   ```bash
   supabase functions deploy push --no-verify-jwt
   ```

Catatan: di iPhone notifikasi hanya jalan bila aplikasi dipasang ke Layar Utama (iOS 16.4 ke atas). Langganan
dilepas dari perangkat saat logout, jadi pengguna berikutnya tidak menerima notifikasi akun sebelumnya.
Kegagalan notifikasi tidak pernah menggagalkan penjualan atau info update.

## Struktur proyek

| Lokasi | Isi |
|---|---|
| `index.html`, `manifest.json`, `sw.js`, `offline.html` | Titik masuk, manifest PWA, Service Worker, halaman offline |
| `js/` | Logika aplikasi (modul ES). `app.js` adalah titik masuk |
| `js/pages/` | Satu berkas per halaman (kasir, stok, laporan, akun, catatan, dan seterusnya) |
| `css/` | Gaya, dipecah per bagian. **Urutan** pemuatan di `index.html` menentukan cascade |
| `db/schema.sql` | Skema, kebijakan RLS, dan fungsi database |
| `supabase/functions/push/` | Edge Function pengirim notifikasi push (Deno) |
| `widgets/` | Templat widget Windows |
| `assets/` | Font, ikon, tangkapan layar, dan pustaka vendor (Supabase SDK, ZXing) |
| `tests/` | Tes otomatis |

## Pengujian

Tes memakai `node:test` bawaan Node (tanpa dependensi, butuh Node 22 atau lebih baru):

```bash
node --test tests/*.test.mjs
```

Yang diuji: antrean dan sinkron offline, salinan lokal, struk, pengurai CSV, deeplink, catatan,
kelengkapan daftar precache, dan alur penjualan (`sales.js`) memakai klien Supabase palsu di
`tests/helpers/fake-browser.mjs`, termasuk cadangan saat database belum diperbarui. Kebijakan RLS dan
fungsi SQL tidak diuji oleh tes ini; keduanya diuji langsung di Postgres.

## Deploy

Unggah berkas statis ke hosting statis mana pun dengan **HTTPS** (mis. GitHub Pages, Cloudflare Pages).
Jangan sertakan `db/`, `tests/`, dan `supabase/` bila tidak perlu.

Setiap kali menambah berkas aplikasi baru:

1. Tambahkan ke daftar `PRECACHE` di `sw.js` (tes `precache.test.mjs` akan gagal bila terlewat).
2. Naikkan `CACHE_NAME` di `sw.js` agar pengguna mendapat versi baru.
3. Naikkan `APP_VERSION` di `js/config.js` bila perlu.

## Catatan keamanan

- Semua akses data dijaga RLS. Fungsi `checkout`, `process_return`, dan `delete_app_user` berjalan sebagai
  `SECURITY DEFINER` dengan pemeriksaan hak akses di dalamnya.
- Stok tenant hanya bisa **ditulis** (tambah, ubah, hapus, harga) oleh akun kasir dari tenant itu sendiri.
  Admin hanya membaca stok; aturan ini ditegakkan oleh RLS (`is_tenant_cashier`) dan disembunyikan di tampilan.
  Penjualan dan retur tidak terpengaruh karena berjalan lewat fungsi `SECURITY DEFINER`.
- Login memakai Supabase Auth. Pendaftaran umum tidak memberi akses karena wajib punya baris `profiles`.
- Berkas `.mcp.json` dan `.codegraph/` bersifat lokal dan tidak ikut ke repo.
