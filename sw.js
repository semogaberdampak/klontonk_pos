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

const CACHE_NAME = 'klontonk-pos-v3';
const OFFLINE_FALLBACK = './offline.html';
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
  './css/styles.css',
  './assets/fonts/plus-jakarta-sans-latin.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/vendor/supabase/supabase.js',
  './assets/vendor/zxing/zxing.min.js',
  './js/app.js',
  './js/auth.js',
  './js/cart.js',
  './js/config.js',
  './js/db-status.js',
  './js/format.js',
  './js/icons.js',
  './js/report.js',
  './js/returns.js',
  './js/sales.js',
  './js/pwa.js',
  './js/router.js',
  './js/routes.js',
  './js/scanner.js',
  './js/shell.js',
  './js/stock.js',
  './js/supabase.js',
  './js/tenant.js',
  './js/theme.js',
  './js/ui.js',
  './js/welcome.js',
  './js/pages/akun.js',
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
