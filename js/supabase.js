import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Koneksi ke Supabase memakai SDK resmi @supabase/supabase-js (assets/vendor/supabase, dimuat index.html
// sebagai skrip klasik sebelum js/app.js sehingga tersedia sebagai global `supabase`).
// SDK mengurus sesi (disimpan di localStorage, diperbarui otomatis), header, dan PostgREST.
// Modul ini menyediakan SATU klien bersama (`db`) dan menormalkan hasilnya agar seluruh aplikasi
// memakai bentuk yang sama, tanpa pernah melempar error:
//   { ok: true,  status, data }
//   { ok: false, status, code, message, expired }   (status 0 = tidak ada jaringan; expired = sesi tidak berlaku)

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  throw new Error('SDK Supabase tidak termuat (assets/vendor/supabase/supabase.js).');
}

const PAGE_SIZE = 1000; // batas baris per permintaan di Supabase
const NETWORK_MESSAGE = 'Server tidak terjangkau. Periksa koneksi lalu coba lagi.';

const AUTH_OPTIONS = {
  storageKey: 'klontonk:sb-auth',
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false
};

export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: AUTH_OPTIONS });

// ---------- Hasil query → bentuk seragam ----------

const isNetworkError = (error, status) =>
  !status && (error.name === 'AuthRetryableFetchError' || /fetch|network|load failed/i.test(error.message || ''));

function normalize({ data, error, status }) {
  if (!error) return { ok: true, status: status || 200, data };
  const httpStatus = error.status ?? status ?? 0;
  if (isNetworkError(error, httpStatus)) return { ok: false, status: 0, code: 'network', message: NETWORK_MESSAGE, expired: false };
  return {
    ok: false,
    status: httpStatus,
    code: String(error.code || ''),
    message: error.message || `Permintaan gagal (kode ${httpStatus}).`,
    expired: httpStatus === 401 || /jwt expired/i.test(error.message || '')
  };
}

// Jalankan satu query SDK (builder / rpc) dan normalkan hasilnya.
export const run = async (query) => normalize(await query);

// Ambil semua baris (Supabase membatasi 1000 per permintaan): halaman demi halaman sampai habis.
// makeQuery = () => db.from(...).select(...) — dipanggil ulang per halaman karena builder hanya sekali pakai.
export async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await run(makeQuery().range(from, from + PAGE_SIZE - 1));
    if (!page.ok) return page;
    rows.push(...page.data);
    if (page.data.length < PAGE_SIZE) return { ok: true, status: 200, data: rows };
  }
}

// Pesan galat untuk pengguna. `byCode` = pesan khusus per kode galat Postgres; `forbidden` = pesan saat ditolak RLS.
export function describeResult(result, { byCode = {}, forbidden = 'Tidak punya akses untuk tindakan ini.' } = {}) {
  if (result.expired) return 'Sesi berakhir. Silakan login ulang.';
  if (byCode[result.code]) return byCode[result.code];
  if (result.status === 403 || result.code === '42501') return forbidden;
  return result.message;
}

// ---------- Auth ----------

export async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  return normalize({ data, error, status: error ? undefined : 200 });
}

// Keluar dari perangkat ini saja (scope lokal), agar sesi di perangkat lain tidak ikut terputus.
export const signOut = () => db.auth.signOut({ scope: 'local' }).catch(() => {});

export async function hasSession() {
  const { data } = await db.auth.getSession();
  return !!data.session;
}

// Buat akun baru TANPA mengganti sesi yang sedang aktif (admin tidak ikut keluar): klien terpisah tanpa penyimpanan sesi.
export async function signUpDetached(email, password) {
  const detached = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await detached.auth.signUp({ email, password });
  return normalize({ data, error, status: error ? undefined : 200 });
}
