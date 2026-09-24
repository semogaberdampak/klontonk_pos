import { browserStorage } from './snapshot.js';

// Cara aplikasi dibuka dari luar (didaftarkan di manifest.json):
//   - Protocol handler  web+klontonk:<halaman>   → ?protocol=...   (mis. dari QR code / NFC)
//   - Share target      bagikan teks ke aplikasi → ?share_title=&share_text=&share_url=
//   - Note taking       "catatan baru" dari sistem → ?note=new
// Semua masukan berasal dari luar aplikasi, jadi hanya halaman di daftar aman (ROUTES) yang dibuka dan
// teks pencarian dibersihkan dan dibatasi. Halaman yang butuh hak khusus (mis. Pengguna) sengaja tidak ada.

const PROTOCOL = 'web+klontonk';
const ROUTES = {
  beranda: '#/beranda',
  kasir: '#/kasir',
  stok: '#/stok/total',
  catatan: '#/catatan'
};
const SEARCH_MAX_LENGTH = 60;
const PENDING_SEARCH_KEY = 'klontonk:pending-search';

// 'web+klontonk:kasir' (juga bentuk // dan garis miring akhir) → '#/kasir'; selain itu null.
export function routeFromProtocol(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text.startsWith(`${PROTOCOL}:`)) return null;
  const name = text.slice(PROTOCOL.length + 1).replace(/^\/\//, '').replace(/\/+$/, '');
  return Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
}

const cleanText = (value) => String(value ?? '')
  .replace(/[\t\n\r]+/g, ' ')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Teks pencarian dari data yang dibagikan: teks, lalu judul, lalu url. null bila kosong.
export function searchFromShare({ title, text, url } = {}) {
  const chosen = [text, title, url].map(cleanText).find(Boolean);
  return chosen ? chosen.slice(0, SEARCH_MAX_LENGTH) : null;
}

// Baca query string saat aplikasi dibuka. Mengembalikan { hash, search? } atau null bila bukan peluncuran khusus.
export function readLaunchIntent(queryString) {
  const params = new URLSearchParams(queryString);

  if (params.has('protocol')) {
    const hash = routeFromProtocol(params.get('protocol'));
    return hash ? { hash } : null;
  }

  if (params.get('note') === 'new') return { hash: ROUTES.catatan };

  const search = searchFromShare({
    title: params.get('share_title'),
    text: params.get('share_text'),
    url: params.get('share_url')
  });
  return search ? { hash: ROUTES.kasir, search } : null;
}

// Teks pencarian yang menunggu halaman Kasir terbuka; diambil satu kali lalu dihapus.
export function createPendingSearch(storage) {
  return {
    put(query) {
      try {
        storage.setItem(PENDING_SEARCH_KEY, query);
      } catch (err) {
        // penyimpanan diblokir: pencarian tidak terisi otomatis, tidak ada yang rusak
      }
    },
    take() {
      try {
        const value = storage.getItem(PENDING_SEARCH_KEY);
        storage.removeItem(PENDING_SEARCH_KEY);
        return value || null;
      } catch (err) {
        return null;
      }
    }
  };
}

export const pendingSearch = typeof window === 'undefined' ? null : createPendingSearch(browserStorage());
