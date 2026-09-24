import { TenantStore } from './tenant.js';
import { db, run, fetchAll, describeResult } from './supabase.js';

// Stok & harga per tenant, disimpan di tabel `stock_items` di Supabase (db/schema.sql).
// Di browser hanya ada salinan yang dimuat saat aplikasi dibuka (StockStore.load). Perubahan langsung
// tampil di sini lalu dikirim ke database; bila ditolak (mis. nama ganda, atau tak punya akses),
// perubahan dibatalkan dan daftar dimuat ulang. Penjualan tidak lewat sini: fungsi checkout() di
// database yang mengurangi stok (SalesStore.checkout), lalu salinan ini disesuaikan lewat applySale().
// Validasi dilakukan di sini (untuk tampilan) dan diulang oleh batasan database.
const TABLE = 'stock_items';
const COLUMNS = 'tenant_id,id,name,qty,unit,barcode,price';
const MAX_QTY = 1000000;
export const MAX_PRICE = 100000000;
// Ambang "stok menipis" — dipakai Stok Total dan Beranda supaya definisinya satu tempat.
export const LOW_STOCK_MAX = 5;
const NAME_PATTERN = /^[\p{L}\p{N} .,'()&/+-]{2,60}$/u;
const BARCODE_PATTERN = /^[A-Za-z0-9._-]{4,40}$/;

const sameBarcode = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export const UNITS = ['pcs', 'kg', 'liter', 'pak', 'bungkus', 'dus', 'karung', 'renceng'];

let data = {}; // { T001: [item...], ... } — salinan dari database
let saveChain = Promise.resolve();
const saveErrorHandlers = new Set();

const newId = () => 'stk_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

const tenantId = () => TenantStore.getCurrent().id;

function read() {
  return data[tenantId()] || [];
}

function commit(items) {
  data = { ...data, [tenantId()]: items };
}

// Baris database → bentuk yang dipakai aplikasi (field kosong dihilangkan).
const toItem = ({ id, name, qty, unit, barcode, price }) => ({
  id, name, qty, unit,
  ...(barcode !== null && { barcode }),
  ...(price !== null && { price })
});

// Tambah atau ganti satu barang (upsert menurut kunci tenant_id + id). Tenant ditangkap saat perubahan dibuat,
// bukan saat antrean simpan berjalan.
const upsert = (tenant, item) => run(db.from(TABLE).upsert({
  tenant_id: tenant,
  id: item.id,
  name: item.name,
  qty: item.qty,
  unit: item.unit,
  barcode: item.barcode || null,
  price: item.price ?? null
}, { onConflict: 'tenant_id,id' }));

const describe = (result) => describeResult(result, {
  byCode: { 23505: 'Nama atau barcode sudah dipakai barang lain.' },
  forbidden: 'Tidak punya akses untuk perubahan ini.'
});

// Kirim perubahan secara berurutan. Bila ditolak: beri tahu, lalu samakan dengan database.
function persist(send) {
  saveChain = saveChain.then(async () => {
    const result = await send();
    if (result.ok) return;
    const message = `${describe(result)} Perubahan dibatalkan.`;
    saveErrorHandlers.forEach((handler) => handler(message));
    await StockStore.load();
  });
}

// Mengembalikan { ok: true, value } atau { ok: false, error }
function validate(input, items, ignoreId) {
  const name = String((input && input.name) ?? '').replace(/\s+/g, ' ').trim();
  const rawQty = String((input && input.qty) ?? '').trim();
  const unit = String((input && input.unit) ?? '');

  if (!name) return { ok: false, error: 'Nama barang wajib diisi.' };
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Nama barang 2–60 karakter (huruf, angka, spasi, dan tanda baca umum).' };
  }
  if (rawQty === '') return { ok: false, error: 'Jumlah stok wajib diisi.' };

  const qty = Number(rawQty);
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) {
    return { ok: false, error: 'Jumlah harus bilangan bulat 0 – 1.000.000.' };
  }
  if (!UNITS.includes(unit)) return { ok: false, error: 'Satuan tidak valid.' };

  const duplicate = items.some(i => i.id !== ignoreId && i.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return { ok: false, error: 'Barang dengan nama itu sudah ada.' };

  // Barcode opsional; bila diisi harus unik per tenant.
  const barcode = String((input && input.barcode) ?? '').trim();
  if (barcode && !BARCODE_PATTERN.test(barcode)) {
    return { ok: false, error: 'Barcode 4–40 karakter (huruf, angka, titik, minus, underscore).' };
  }
  const barcodeOwner = barcode ? items.find(i => i.id !== ignoreId && i.barcode && sameBarcode(i.barcode, barcode)) : null;
  if (barcodeOwner) return { ok: false, error: `Barcode sudah dipakai oleh "${barcodeOwner.name}".` };

  return { ok: true, value: { name, qty, unit, barcode } };
}

export const StockStore = {
  // Dipanggil bila database menolak / tidak bisa menyimpan; mengembalikan fungsi untuk berhenti mendengarkan.
  onSaveError(handler) {
    saveErrorHandlers.add(handler);
    return () => saveErrorHandlers.delete(handler);
  },

  // Muat stok dari database (RLS: admin semua tenant, kasir hanya tenant sendiri). Dipanggil saat aplikasi
  // dibuka (setelah login) dan setelah simpanan ditolak.
  async load() {
    const result = await fetchAll(() => db.from(TABLE).select(COLUMNS).order('created_at').order('name'));
    if (!result.ok) return { success: false, error: describe(result), expired: !!result.expired };
    const grouped = Object.fromEntries(TenantStore.getAll().map((tenant) => [tenant.id, []]));
    for (const row of result.data) (grouped[row.tenant_id] ||= []).push(toItem(row));
    data = grouped;
    return { success: true };
  },

  list() {
    return read().map(item => ({ ...item }));
  },

  findByBarcode(code) {
    const text = String(code || '').trim();
    if (!text) return null;
    const found = read().find(i => i.barcode && sameBarcode(i.barcode, text));
    return found ? { ...found } : null;
  },

  add(input) {
    const items = read();
    const checked = validate(input, items, null);
    if (!checked.ok) return { success: false, error: checked.error };

    const tenant = tenantId();
    const item = { id: newId(), ...checked.value };
    commit([...items, item]);
    persist(() => upsert(tenant, item));
    return { success: true, item };
  },

  update(id, input) {
    const items = read();
    if (!items.some(i => i.id === id)) return { success: false, error: 'Barang tidak ditemukan.' };

    const checked = validate(input, items, id);
    if (!checked.ok) return { success: false, error: checked.error };

    const tenant = tenantId();
    const next = items.map(i => (i.id === id ? { ...i, ...checked.value } : i));
    commit(next);
    const item = next.find(i => i.id === id);
    persist(() => upsert(tenant, item));
    return { success: true, item };
  },

  remove(id) {
    const items = read();
    if (!items.some(i => i.id === id)) return { success: false, error: 'Barang tidak ditemukan.' };
    const tenant = tenantId();
    commit(items.filter(i => i.id !== id));
    persist(() => run(db.from(TABLE).delete().eq('tenant_id', tenant).eq('id', id)));
    return { success: true };
  },

  // Harga jual per barang (rupiah, bilangan bulat).
  setPrice(id, rawPrice) {
    const items = read();
    if (!items.some(i => i.id === id)) return { success: false, error: 'Barang tidak ditemukan.' };

    const text = String(rawPrice ?? '').trim();
    if (text === '') return { success: false, error: 'Harga wajib diisi.' };

    const price = Number(text);
    if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) {
      return { success: false, error: 'Harga harus bilangan bulat Rp 1 – Rp 100.000.000.' };
    }

    const tenant = tenantId();
    const next = items.map(i => (i.id === id ? { ...i, price } : i));
    commit(next);
    persist(() => run(db.from(TABLE).update({ price }).eq('tenant_id', tenant).eq('id', id)));
    return { success: true, item: next.find(i => i.id === id) };
  },

  // Sesuaikan salinan lokal setelah penjualan berhasil dicatat database (SalesStore.checkout).
  // lines = [{ id, qty }]. Stok di database sudah dikurangi oleh fungsi checkout().
  applySale(lines) {
    const sold = new Map(lines.map(({ id, qty }) => [id, qty]));
    commit(read().map(i => (sold.has(i.id) ? { ...i, qty: Math.max(0, i.qty - sold.get(i.id)) } : i)));
  },

  // Sesuaikan salinan lokal setelah retur dicatat database (ReturnStore.process): delta + (retur pelanggan) atau - (supplier).
  applyDelta(id, delta) {
    commit(read().map(i => (i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i)));
  }
};
