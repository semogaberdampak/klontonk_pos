import { TenantStore } from './tenant.js';
import { StockStore } from './stock.js';
import { db, run, fetchAll, describeResult } from './supabase.js';
import { isoMillis } from './format.js';

// Riwayat penjualan per tenant, disimpan di tabel `sales` + `sale_lines` di Supabase (db/schema.sql).
// Di browser hanya ada salinan yang dimuat saat aplikasi dibuka (SalesStore.load), dipakai laporan
// Stok Keluar — Laku. Penjualan baru dicatat HANYA lewat checkout(): satu fungsi di database yang
// mengunci stok, memeriksa cukup, mengurangi stok, menghitung total dari harga di database, membuat
// nomor transaksi, dan menyimpan penjualannya dalam satu transaksi (semua berhasil atau semua batal).
//
// Bentuk satu penjualan:
//   { no, at (ISO 8601), cashier, method: 'tunai' | 'nontunai', total, paid,
//     lines: [{ id, name, unit, qty, price }] }
const SELECT = 'tenant_id,no,at,cashier,method,total,paid,lines:sale_lines(item_id,name,unit,qty,price)';

let data = {}; // { T001: [sale...], ... } — salinan dari database

const currentSales = () => data[TenantStore.getCurrent().id] || [];

const toSale = ({ no, at, cashier, method, total, paid, lines }) => ({
  no, at: isoMillis(at), cashier, method, total, paid,
  lines: lines.map(({ item_id, name, unit, qty, price }) => ({ id: item_id, name, unit, qty, price }))
});

const describe = (result) => describeResult(result, { forbidden: 'Tidak punya akses untuk transaksi ini.' });

export const SalesStore = {
  // Muat riwayat penjualan (RLS: admin semua tenant, kasir hanya tenant sendiri).
  async load() {
    const result = await fetchAll(() => db.from('sales').select(SELECT).order('at').order('no'));
    if (!result.ok) return { success: false, error: describe(result), expired: !!result.expired };
    const grouped = Object.fromEntries(TenantStore.getAll().map((tenant) => [tenant.id, []]));
    for (const row of result.data) (grouped[row.tenant_id] ||= []).push(toSale(row));
    data = grouped;
    return { success: true };
  },

  // Penjualan tenant aktif (salinan), urutan tercatat.
  list() {
    return structuredClone(currentSales());
  },

  // Proses pembayaran. input: { method, paid, lines: [{ id, qty }, ...] }.
  // Mengembalikan { success: true, sale } (sale dari database, lengkap dengan nomor & total) atau { success: false, error }.
  async checkout({ method, paid, lines }) {
    const tenant = TenantStore.getCurrent().id;
    const result = await run(db.rpc('checkout', {
      p_tenant: tenant,
      p_method: method,
      p_paid: paid,
      p_lines: lines.map(({ id, qty }) => ({ id, qty }))
    }));
    if (!result.ok) return { success: false, error: describe(result) };

    const sale = { ...result.data, at: isoMillis(result.data.at) };
    data = { ...data, [tenant]: [...(data[tenant] || []), sale] };
    StockStore.applySale(sale.lines);
    return { success: true, sale: structuredClone(sale) };
  }
};
