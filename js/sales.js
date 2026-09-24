import { TenantStore } from './tenant.js';
import { StockStore } from './stock.js';
import { Auth } from './auth.js';
import { db, run, fetchAll, describeResult } from './supabase.js';
import { isoMillis } from './format.js';
import { createOutbox, buildEntry } from './outbox.js';
import { flushOutbox, SCHEMA_MISSING } from './sync.js';
import { browserStorage } from './snapshot.js';
import { requestOutboxSync } from './pwa.js';

// Riwayat penjualan per tenant, disimpan di tabel `sales` + `sale_lines` di Supabase (db/schema.sql).
// Di browser hanya ada salinan yang dimuat saat aplikasi dibuka (SalesStore.load), dipakai laporan
// Stok Keluar — Laku. Penjualan baru dicatat HANYA lewat checkout(): satu fungsi di database yang
// mengunci stok, memeriksa cukup, mengurangi stok, menghitung total dari harga di database, membuat
// nomor transaksi, dan menyimpan penjualannya dalam satu transaksi (semua berhasil atau semua batal).
//
// Saat perangkat OFFLINE, checkout() menyimpan penjualan ke antrean di perangkat (js/outbox.js) dan
// mengurangi stok salinan lokal; flush() mengirimnya ke database begitu ada jaringan (js/sync.js).
// Tiap penjualan membawa UUID (client_id) sehingga pengiriman ulang tidak pernah menggandakannya.
//
// Bentuk satu penjualan:
//   { no, at (ISO 8601), cashier, method: 'tunai' | 'nontunai', total, paid,
//     lines: [{ id, name, unit, qty, price }],
//     offline?: true (dibuat saat offline), reviewNote?: string (selisih yang perlu ditinjau),
//     pending?: true (masih di antrean, belum di database), failed?: true (ditolak database), clientId? }
const SELECT = 'tenant_id,no,at,cashier,method,total,paid,client_id,offline,review_note,lines:sale_lines(item_id,name,unit,qty,price)';
// Cadangan bila database belum diperbarui dengan db/schema.sql (kolom baru belum ada): tanpa penanda offline.
const SELECT_LEGACY = 'tenant_id,no,at,cashier,method,total,paid,lines:sale_lines(item_id,name,unit,qty,price)';
const COLUMN_MISSING = '42703'; // kode Postgres: undefined_column
const CHECKOUT_TIMEOUT_MS = 8000;
const OFFLINE_NO_PREFIX = 'OFF-';
const FLUSH_LOCK = 'klontonk-outbox-flush';

let data = {}; // { T001: [sale...], ... } — salinan dari database + penjualan yang masih di antrean
let syncedClientIds = new Set(); // client_id yang sudah ada di database pada load() terakhir
let flushing = null;

const outbox = createOutbox(browserStorage());
const outboxListeners = new Set();
const flushListeners = new Set();

const currentSales = () => data[TenantStore.getCurrent().id] || [];

const toLines = (lines) => lines.map(({ item_id, name, unit, qty, price }) => ({ id: item_id, name, unit, qty, price }));

const toSale = ({ no, at, cashier, method, total, paid, offline, review_note, lines }) => ({
  no, at: isoMillis(at), cashier, method, total, paid,
  ...(offline && { offline: true }),
  ...(review_note && { reviewNote: review_note }),
  lines: toLines(lines)
});

// Hasil RPC checkout() sudah berbentuk penjualan (baris memakai `id`, bukan `item_id`).
const fromRpc = ({ no, at, cashier, method, total, paid, offline, review_note, lines }) => ({
  no, at: isoMillis(at), cashier, method, total, paid,
  ...(offline && { offline: true }),
  ...(review_note && { reviewNote: review_note }),
  lines
});

// Entri antrean → penjualan sementara (nomor resmi baru terbit setelah masuk database).
const entryToSale = (entry) => ({
  no: OFFLINE_NO_PREFIX + entry.clientId.replace(/-/g, '').slice(0, 8).toUpperCase(),
  at: entry.at,
  cashier: entry.cashier,
  method: entry.method,
  total: entry.expectedTotal,
  paid: entry.paid,
  offline: true,
  pending: true,
  ...(entry.status === 'failed' && { failed: true, reviewNote: entry.error }),
  clientId: entry.clientId,
  lines: structuredClone(entry.lines)
});

const describe = (result) => describeResult(result, { forbidden: 'Tidak punya akses untuk transaksi ini.' });

// crypto.randomUUID hanya ada di konteks aman; cadangan untuk akses lewat http:// biasa.
function newClientId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// Sesi disimpan di perangkat sehingga tetap terbaca saat offline.
async function sessionUser() {
  try {
    const { data: { session } } = await db.auth.getSession();
    return session ? session.user : null;
  } catch (err) {
    return null;
  }
}

const outboxState = () => {
  const entries = outbox.list();
  return {
    pending: entries.filter((entry) => entry.status === 'pending').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    entries
  };
};

const notifyOutbox = () => outboxListeners.forEach((handler) => handler(outboxState()));

// Penjualan offline: simpan di antrean, kurangi stok lokal, minta Background Sync.
async function queueOffline({ tenant, clientId, method, paid, lines }) {
  const user = await sessionUser();
  if (!user) {
    return { success: false, error: 'Tidak ada koneksi dan sesi login tidak ditemukan. Sambungkan internet untuk masuk lagi.' };
  }

  const built = buildEntry({
    clientId, tenant, userId: user.id, cashier: (Auth.getCurrentUser() || {}).name || 'Kasir', method, paid, lines
  });
  if (!built.ok) return { success: false, error: built.error };

  const stored = outbox.add(built.entry);
  if (!stored.ok) return { success: false, error: stored.error };

  const sale = entryToSale(built.entry);
  data = { ...data, [tenant]: [...(data[tenant] || []), sale] };
  StockStore.applySale(sale.lines);
  requestOutboxSync();
  notifyOutbox();
  return { success: true, offline: true, sale: structuredClone(sale) };
}

// Kirim satu entri antrean; database mengenali client_id sehingga pengulangan aman.
const send = async (entry) => {
  const result = await run(db.rpc('checkout', {
    p_tenant: entry.tenant,
    p_method: entry.method,
    p_paid: entry.paid,
    p_lines: entry.lines.map(({ id, qty }) => ({ id, qty })),
    p_client_id: entry.clientId,
    p_offline: true,
    p_at: entry.at,
    p_expected_total: entry.expectedTotal
  }).abortSignal(timeoutSignal(CHECKOUT_TIMEOUT_MS * 2)));
  return result.ok ? result : { ...result, message: describe(result) };
};

async function reloadFromServer() {
  const [stock] = await Promise.all([StockStore.load(), SalesStore.load()]);
  // Bila jaringan putus di tengah jalan, stok berasal dari salinan offline yang sudah memuat pengurangannya.
  if (!stock.offline) SalesStore.reapplyUnsynced();
}

// Penjualan yang masih di antrean, dikelompokkan per tenant (dipakai saat database belum bisa dijangkau).
function pendingOnly() {
  const grouped = {};
  for (const entry of outbox.list()) (grouped[entry.tenant] ||= []).push(entryToSale(entry));
  return grouped;
}

export const SalesStore = {
  // Muat riwayat penjualan (RLS: admin semua tenant, kasir hanya tenant sendiri). Penjualan yang masih di
  // antrean perangkat ditambahkan agar tetap tampil di laporan.
  async load() {
    const query = (columns) => fetchAll(() => db.from('sales').select(columns).order('at').order('no'));
    let result = await query(SELECT);
    if (!result.ok && result.code === COLUMN_MISSING) result = await query(SELECT_LEGACY);
    if (!result.ok) {
      // Offline saat aplikasi dibuka: setidaknya penjualan di antrean tetap tampil.
      if (result.code === 'network' && !Object.keys(data).length) data = pendingOnly();
      return { success: false, error: describe(result), expired: !!result.expired };
    }
    const grouped = Object.fromEntries(TenantStore.getAll().map((tenant) => [tenant.id, []]));
    for (const row of result.data) (grouped[row.tenant_id] ||= []).push(toSale(row));
    syncedClientIds = new Set(result.data.map((row) => row.client_id).filter(Boolean));
    for (const entry of outbox.list()) {
      if (!syncedClientIds.has(entry.clientId)) (grouped[entry.tenant] ||= []).push(entryToSale(entry));
    }
    data = grouped;
    return { success: true };
  },

  // Penjualan tenant aktif (salinan), urutan tercatat.
  list() {
    return structuredClone(currentSales());
  },

  // Proses pembayaran. input: { method, paid, lines: [{ id, qty, price, ... }, ...] }.
  // Mengembalikan { success: true, sale } (sale dari database, lengkap dengan nomor & total) atau
  // { success: true, offline: true, sale } (tersimpan di antrean; sale.pending) atau { success: false, error }.
  async checkout({ method, paid, lines }) {
    const tenant = TenantStore.getCurrent().id;
    const clientId = newClientId();
    const call = (extra) => run(db.rpc('checkout', {
      p_tenant: tenant,
      p_method: method,
      p_paid: paid,
      p_lines: lines.map(({ id, qty }) => ({ id, qty })),
      ...extra
    }).abortSignal(timeoutSignal(CHECKOUT_TIMEOUT_MS)));

    let result = await call({ p_client_id: clientId });
    if (!result.ok && result.code === SCHEMA_MISSING) {
      // Database belum diperbarui ke checkout versi baru: pakai panggilan lama agar kasir tetap bisa berjualan.
      // Tanpa client_id tidak ada perlindungan anti-ganda pada jalur ini, sampai db/schema.sql dijalankan.
      console.warn('[Sales] checkout versi baru belum ada di database; memakai versi lama. Jalankan db/schema.sql.');
      result = await call({});
    }

    if (result.ok) {
      const sale = fromRpc(result.data);
      data = { ...data, [tenant]: [...(data[tenant] || []), sale] };
      StockStore.applySale(sale.lines);
      return { success: true, sale: structuredClone(sale) };
    }

    // Hanya gangguan jaringan yang masuk antrean. Penolakan database (stok kurang, harga kosong, dst)
    // tetap ditampilkan ke kasir. Permintaan yang terpotong mungkin sudah diterima server; client_id yang
    // sama membuat pengiriman ulang dari antrean aman.
    if (result.code !== 'network') return { success: false, error: describe(result) };
    return queueOffline({ tenant, clientId, method, paid, lines });
  },

  // Kirim antrean offline ke database. Aman dipanggil berulang / bersamaan: satu proses sekaligus.
  // Mengembalikan ringkasan { synced, failed, remaining, stopped }.
  flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const user = await sessionUser();
      const empty = { synced: [], failed: [], remaining: 0, stopped: user ? null : 'no-session' };
      if (!user || !outbox.count('pending')) return empty;

      const flushNow = () => flushOutbox({ outbox, send, userId: user.id, isOnline: () => navigator.onLine });
      const summary = navigator.locks ? await navigator.locks.request(FLUSH_LOCK, flushNow) : await flushNow();

      if (summary.synced.length) await reloadFromServer();
      if (summary.synced.length || summary.failed.length) flushListeners.forEach((handler) => handler(summary));
      notifyOutbox();
      return summary;
    })().finally(() => { flushing = null; });
    return flushing;
  },

  // Setelah stok dimuat dari database: kurangi lagi dengan penjualan yang belum ada di database
  // (masih di antrean, atau ditolak dan menunggu keputusan), agar stok di layar tidak kembali naik.
  // JANGAN dipanggil bila stok berasal dari salinan offline: salinan itu sudah memuat pengurangannya.
  reapplyUnsynced() {
    for (const entry of outbox.list()) {
      if (syncedClientIds.has(entry.clientId)) continue;
      if (entry.tenant === TenantStore.getCurrent().id) StockStore.applySale(entry.lines);
    }
  },

  outboxState,

  onOutboxChange(handler) {
    outboxListeners.add(handler);
    return () => outboxListeners.delete(handler);
  },

  onFlushed(handler) {
    flushListeners.add(handler);
    return () => flushListeners.delete(handler);
  },

  // Coba kirim ulang penjualan yang ditolak (mis. setelah admin mengisi harga barangnya).
  async retry(clientId) {
    outbox.update(clientId, { status: 'pending', error: null });
    notifyOutbox();
    return SalesStore.flush();
  },

  // Buang penjualan yang ditolak dari antrean. Penjualannya TIDAK akan tercatat di database.
  async discard(clientId) {
    outbox.remove(clientId);
    notifyOutbox();
    await reloadFromServer();
  }
};
