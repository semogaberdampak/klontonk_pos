import { TenantStore } from './tenant.js';
import { StockStore } from './stock.js';
import { SalesStore } from './sales.js';
import { db, run, fetchAll, describeResult } from './supabase.js';
import { isoMillis } from './format.js';

// Retur stok per tenant, disimpan di tabel `stock_returns` di Supabase (db/schema.sql).
//   pelanggan: barang dikembalikan pembeli → stok BERTAMBAH, ada nilai pengembalian uang.
//              Jumlah kumulatif retur tidak boleh melebihi yang pernah terjual untuk barang itu.
//   supplier : barang rusak / kedaluwarsa keluar dari stok → stok BERKURANG, tanpa uang.
// Retur dicatat HANYA lewat fungsi database process_return() (atomik: kunci stok, periksa, ubah stok, catat).
//
// Bentuk satu retur:
//   { no, at (ISO 8601), cashier, kind, id (barang), name, unit, qty, amount (rupiah), reason, note }

export const KINDS = [
  { id: 'pelanggan', label: 'Dari Pelanggan', hint: 'Barang dikembalikan pembeli. Stok bertambah, uang dikembalikan.' },
  { id: 'supplier', label: 'Ke Supplier / Rusak', hint: 'Barang rusak atau kedaluwarsa keluar dari stok. Tidak ada uang.' }
];

export const REASONS = {
  pelanggan: [
    { id: 'rusak', label: 'Barang rusak' },
    { id: 'salah_barang', label: 'Salah barang' },
    { id: 'tidak_sesuai', label: 'Tidak sesuai pesanan' },
    { id: 'lainnya', label: 'Lainnya' }
  ],
  supplier: [
    { id: 'rusak', label: 'Barang rusak' },
    { id: 'kedaluwarsa', label: 'Kedaluwarsa' },
    { id: 'lainnya', label: 'Lainnya' }
  ]
};

export const MAX_NOTE = 100;

const SELECT = 'tenant_id,no,at,cashier,kind,item_id,name,unit,qty,amount,reason,note';

let data = {}; // { T001: [retur...], ... } — salinan dari database

const currentReturns = () => data[TenantStore.getCurrent().id] || [];

const toReturn = ({ no, at, cashier, kind, item_id, name, unit, qty, amount, reason, note }) => ({
  no, at: isoMillis(at), cashier, kind, id: item_id, name, unit, qty, amount, reason, note
});

const describe = (result) => describeResult(result, { forbidden: 'Tidak punya akses untuk retur ini.' });

// Jumlah per barang: yang pernah terjual dan yang sudah diretur pelanggan (tenant aktif).
// Retur pelanggan berikutnya dibatasi sold - returned.
export function customerReturnLimits() {
  const limits = new Map();
  const entry = (id) => {
    if (!limits.has(id)) limits.set(id, { sold: 0, returned: 0 });
    return limits.get(id);
  };
  for (const sale of SalesStore.list()) for (const line of sale.lines) entry(line.id).sold += line.qty;
  for (const ret of currentReturns()) if (ret.kind === 'pelanggan') entry(ret.id).returned += ret.qty;
  return limits;
}

export const ReturnStore = {
  async load() {
    const result = await fetchAll(() => db.from('stock_returns').select(SELECT).order('at').order('no'));
    if (!result.ok) return { success: false, error: describe(result), expired: !!result.expired };
    const grouped = Object.fromEntries(TenantStore.getAll().map((tenant) => [tenant.id, []]));
    for (const row of result.data) (grouped[row.tenant_id] ||= []).push(toReturn(row));
    data = grouped;
    return { success: true };
  },

  // Retur tenant aktif (salinan), urutan tercatat.
  list() {
    return structuredClone(currentReturns());
  },

  // input: { kind, itemId, qty, reason, note }. Mengembalikan { success: true, ret, stockAfter } atau { success: false, error }.
  async process({ kind, itemId, qty, reason, note }) {
    const tenant = TenantStore.getCurrent().id;
    const result = await run(db.rpc('process_return', {
      p_tenant: tenant,
      p_kind: kind,
      p_item_id: itemId,
      p_qty: qty,
      p_reason: reason,
      p_note: note || null
    }));
    if (!result.ok) return { success: false, error: describe(result) };

    const ret = toReturn(result.data);
    data = { ...data, [tenant]: [...(data[tenant] || []), ret] };
    StockStore.applyDelta(itemId, kind === 'pelanggan' ? qty : -qty);
    return { success: true, ret: structuredClone(ret), stockAfter: result.data.stock_after };
  }
};
