// Logika murni Edge Function `push` (tanpa jaringan dan tanpa Deno), dipisah agar bisa diuji di Node
// (tests/push-payload.test.mjs). Diimpor oleh index.ts.

export const MAX_TITLE = 60;
export const MAX_BODY = 140;

// Rapikan teks untuk notifikasi: spasi dan baris baru diringkas, lalu dipotong dengan elipsis.
const clip = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

// Kejadian dari pemicu database → isi notifikasi. Mengembalikan null bila jenisnya tidak dikenal.
//   announcement : info update baru (app_updates), untuk semua perangkat
//   sale_review  : penjualan offline dengan selisih (sales.review_note), hanya untuk admin
export function buildNotification(kind, record) {
  if (kind === 'announcement') {
    return {
      title: clip(record?.title, MAX_TITLE) || 'Info Klontonk',
      body: clip(record?.description, MAX_BODY),
      url: './index.html#/info-update',
      tag: 'announcement',
      audience: 'all'
    };
  }
  if (kind === 'sale_review') {
    return {
      title: 'Penjualan perlu ditinjau',
      body: clip(`${record?.no ?? ''}: ${record?.review_note ?? ''}`, MAX_BODY),
      url: './index.html#/stok/keluar-laku',
      tag: 'sale-review',
      audience: 'admin'
    };
  }
  return null;
}

// Audiens yang tidak dikenal tidak mengirim ke siapa pun.
export function pickRecipients(subscriptions, audience) {
  const list = subscriptions ?? [];
  if (audience === 'all') return list;
  if (audience === 'admin') return list.filter((sub) => sub.role === 'admin');
  return [];
}

// Layanan push menjawab 404/410 bila perangkat sudah berhenti berlangganan / aplikasi dihapus.
export const isGone = (status) => status === 404 || status === 410;

// Bandingkan rahasia dengan waktu tetap (tidak bocor lewat lamanya pembandingan). Rahasia kosong tidak pernah cocok.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
