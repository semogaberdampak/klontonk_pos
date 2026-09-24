// Service worker Klontonk POS.
//
// Strategi: NETWORK-FIRST. Saat online selalu ambil versi terbaru, cache hanya
// dipakai sebagai cadangan saat offline. (Strategi cache-first sebelumnya bikin
// perubahan file tidak muncul.)
//
// Pengaman cache (agar aplikasi tidak berat / tidak "nyangkut" versi lama):
//   1. Cache versi lama otomatis dihapus saat CACHE_NAME dinaikkan.
//   2. Cache runtime dibatasi MAX_ENTRIES; entri terlama dibuang.
//   3. Pesan { type: 'CLEAR_CACHE' } dari halaman → hapus semua cache lalu isi ulang.
//   4. Darurat (bila aplikasi rusak dan menu Pengaturan tak bisa dibuka):
//      buka  <alamat-app>/index.html?reset-cache=1

const CACHE_NAME = 'klontonk-pos-v5';
const OFFLINE_FALLBACK = './offline.html';
const PERIODIC_SYNC_TAG = 'refresh-app-shell';
const OUTBOX_SYNC_TAG = 'flush-sales-outbox'; // harus sama dengan js/pwa.js
const MAX_ENTRIES = 60;
const NETWORK_TIMEOUT_MS = 5000;
const RESET_PARAM = 'reset-cache';

// App shell untuk offline. Tambahkan file baru di sini; file yang terlewat
// tetap masuk cache saat pertama kali dimuat online.
const PRECACHE = [
  './',
  './index.html',
  OFFLINE_FALLBACK,
  './manifest.json',
  './widgets/quick-actions.json',
  './widgets/quick-actions-data.json',
  './css/base.css',
  './css/navigation.css',
  './css/home.css',
  './css/overlays.css',
  './css/forms.css',
  './css/common.css',
  './css/transaksi.css',
  './css/reports.css',
  './assets/fonts/plus-jakarta-sans-latin.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/vendor/supabase/supabase.js',
  './assets/vendor/zxing/zxing.min.js',
  './js/app.js',
  './js/auth.js',
  './js/cart.js',
  './js/config.js',
  './js/csv.js',
  './js/db-status.js',
  './js/deeplink.js',
  './js/format.js',
  './js/icons.js',
  './js/import.js',
  './js/notes.js',
  './js/outbox.js',
  './js/receipt.js',
  './js/report.js',
  './js/returns.js',
  './js/sales.js',
  './js/pwa.js',
  './js/router.js',
  './js/routes.js',
  './js/scanner.js',
  './js/shell.js',
  './js/snapshot.js',
  './js/stock.js',
  './js/supabase.js',
  './js/sync.js',
  './js/tenant.js',
  './js/theme.js',
  './js/ui.js',
  './js/welcome.js',
  './js/pages/akun.js',
  './js/pages/catatan.js',
  './js/pages/info-update.js',
  './js/updates.js',
  './js/pages/home.js',
  './js/pages/laporan.js',
  './js/pages/login.js',
  './js/pages/stok-awal.js',
  './js/pages/stok-keluar.js',
  './js/pages/stok-retur.js',
  './js/pages/stok-total.js',
  './js/pages/transaksi.js',
  './js/pages/update-harga.js',
  './js/pages/users.js'
];

const PROTECTED_PATHS = new Set(PRECACHE.map((path) => new URL(path, self.location).pathname));

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    PRECACHE.map((path) => cache.add(new Request(path, { cache: 'reload' })))
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}

async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const removable = keys.filter((req) => !PROTECTED_PATHS.has(new URL(req.url).pathname));
  const extra = keys.length - MAX_ENTRIES;
  if (extra > 0) {
    await Promise.all(removable.slice(0, extra).map((req) => cache.delete(req)));
  }
}

function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  // 'no-cache' = selalu tanya server (304 bila tak berubah), agar tidak memakai cache HTTP yang basi.
  return fetch(request, { signal: controller.signal, cache: 'no-cache' }).finally(() => clearTimeout(timer));
}

async function networkFirst(event) {
  const { request } = event;
  try {
    const response = await fetchWithTimeout(request);
    if (response.status === 200) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
          await cache.put(request, copy);
          await trimCache(cache);
        })
      );
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
      const offlinePage = await caches.match(OFFLINE_FALLBACK);
      if (offlinePage) return offlinePage;
    }
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function resetAndRedirect(url) {
  await clearAllCaches();
  // Isi ulang app shell: file yang dilayani dari cache memori browser tidak lewat SW,
  // jadi tanpa ini cache tetap hampir kosong dan aplikasi belum siap offline.
  await precache();
  const clean = new URL(url.href);
  clean.searchParams.delete(RESET_PARAM);
  return Response.redirect(clean.href, 302);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.searchParams.has(RESET_PARAM)) {
    event.respondWith(resetAndRedirect(url));
    return;
  }

  event.respondWith(networkFirst(event));
});

// Periodic Background Sync: segarkan app shell di latar belakang agar versi terbaru siap dipakai
// (hanya jalan pada PWA yang terpasang di Chromium; didaftarkan dari js/pwa.js).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) event.waitUntil(precache());
});

// Background Sync: antrean penjualan offline ada di localStorage dan butuh sesi login, keduanya hanya
// bisa dijangkau halaman. Jadi SW cukup membangunkan halaman yang terbuka. Bila tidak ada halaman terbuka,
// event digagalkan agar browser mencoba lagi nanti; saat aplikasi dibuka, antrean tetap dikirim otomatis.
self.addEventListener('sync', (event) => {
  if (event.tag !== OUTBOX_SYNC_TAG) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      if (!windows.length) throw new Error('Tidak ada halaman terbuka untuk mengirim antrean.');
      windows.forEach((client) => client.postMessage({ type: 'FLUSH_OUTBOX' }));
    })
  );
});

// Widget Windows 11 "Aksi Cepat" (manifest.json → widgets): mengisi kartu saat dipasang / dilanjutkan, dan
// membuka halaman yang dipilih saat tombolnya diketuk. Hanya jalan di Edge/Windows 11; tempat lain diabaikan.
const WIDGET_ACTIONS = { 'open-kasir': './index.html#/kasir', 'open-stok': './index.html#/stok/total' };

async function refreshWidget(widget) {
  if (!self.widgets || !widget) return;
  const { msAcTemplate, data, tag } = widget.definition;
  const [template, payload] = await Promise.all([
    fetch(msAcTemplate).then((response) => response.text()),
    fetch(data).then((response) => response.text())
  ]);
  await self.widgets.updateByTag(tag, { template, data: payload });
}

self.addEventListener('widgetinstall', (event) => event.waitUntil(refreshWidget(event.widget)));
self.addEventListener('widgetresume', (event) => event.waitUntil(refreshWidget(event.widget)));
self.addEventListener('widgetclick', (event) => {
  const url = WIDGET_ACTIONS[event.action];
  if (url) event.waitUntil(self.clients.openWindow(url));
});

// Push: sisi penerima. Server pengirim (VAPID + Edge Function) belum ada, jadi belum ada
// yang berlangganan; handler ini siap menampilkan notifikasi begitu pengirimnya dibuat.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Klontonk POS', {
      body: payload.body || '',
      icon: './assets/icons/icon-192.png',
      data: { url: payload.url || './index.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || './index.html', self.location).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (payload) => event.ports && event.ports[0] && event.ports[0].postMessage(payload);

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      clearAllCaches()
        .then(precache)
        .then((count) => reply({ ok: true, precached: count }))
        .catch(() => reply({ ok: false, precached: 0 }))
    );
  }
});
