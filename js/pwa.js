import { UI } from './ui.js';

// ============ PWA: service worker, status koneksi, reset cache ============

const CACHE_RESET_TIMEOUT_MS = 8000;
const PERIODIC_SYNC_TAG = 'refresh-app-shell'; // harus sama dengan sw.js
const PERIODIC_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const OUTBOX_SYNC_TAG = 'flush-sales-outbox'; // harus sama dengan sw.js
export const FLUSH_OUTBOX_MESSAGE = 'FLUSH_OUTBOX'; // dikirim sw.js ke halaman saat event sync berjalan

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Toast "versi baru" hanya untuk pembaruan, bukan pemasangan pertama.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      UI.toast('Versi baru terpasang. Muat ulang untuk memakainya.', { type: 'info', duration: 8000 });
    }
  });

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then(registerPeriodicSync)
    .catch((err) => console.warn('[PWA] Service worker gagal didaftarkan:', err));
}

// Minta browser menyegarkan app shell tiap hari di latar belakang. Hanya berlaku bila
// didukung (Chromium) dan izinnya diberikan (PWA terpasang); selain itu diam-diam dilewati.
async function registerPeriodicSync(registration) {
  if (!registration || !('periodicSync' in registration)) return;
  try {
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state === 'granted') {
      await registration.periodicSync.register(PERIODIC_SYNC_TAG, { minInterval: PERIODIC_SYNC_INTERVAL_MS });
    }
  } catch (err) {
    console.warn('[PWA] Periodic sync tidak tersedia:', err);
  }
}

// Background Sync: minta browser membangunkan aplikasi begitu jaringan kembali untuk mengirim antrean
// penjualan offline. Service worker tidak punya sesi login, jadi ia hanya memberi tahu halaman (lihat sw.js).
// Tanpa dukungan (mis. Safari / Firefox) sinkron tetap jalan lewat event 'online' dan saat aplikasi dibuka.
export async function requestOutboxSync() {
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
    if (registration && 'sync' in registration) await registration.sync.register(OUTBOX_SYNC_TAG);
  } catch (err) {
    console.warn('[PWA] Background sync tidak tersedia:', err);
  }
}

// Panggil handler saat service worker meminta antrean dikirim.
export function onFlushRequested(handler) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === FLUSH_OUTBOX_MESSAGE) handler();
  });
}

export function watchConnectivity() {
  window.addEventListener('offline', () => {
    UI.toast('Anda offline. Penjualan tetap bisa dicatat dan dikirim otomatis saat internet kembali.', { type: 'warning', duration: 5000 });
  });
  window.addEventListener('online', () => {
    UI.toast('Kembali online.', { type: 'success' });
  });
}

export function isOnline() {
  return navigator.onLine;
}

// True bila service worker sudah aktif mengendalikan halaman ini (siap offline).
export function isOfflineReady() {
  return 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
}

// Hapus cache aplikasi (BUKAN data akun/stok, yang ada di database).
// Lewat service worker bila aktif; jika tidak, hapus langsung dari halaman.
export async function clearAppCache() {
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  const worker = registration && registration.active;

  if (worker) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve({ ok: false, precached: 0 }), CACHE_RESET_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
    });
  }

  if (typeof caches === 'undefined') return { ok: false, precached: 0 };
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  return { ok: true, precached: 0 };
}
