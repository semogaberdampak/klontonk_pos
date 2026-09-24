import { db, run, describeResult } from './supabase.js';

/**
 * Multi-Tenancy Layer
 * Menyimpan konteks tenant aktif. Daftar tenant dimuat dari tabel `tenants` di Supabase
 * (TenantStore.load(), dipanggil app.js setelah login — stok/penjualan/retur dikelompokkan
 * per tenant memakai daftar ini). Sebelum load() selesai (atau bila gagal/offline), dipakai
 * daftar cadangan di bawah ini agar aplikasi tidak pernah tanpa tenant sama sekali.
 */
const FALLBACK_TENANTS = [
  { id: 'T001', name: 'Pusat' },
  { id: 'T002', name: 'Warung Merah' },
  { id: 'T003', name: 'Warung Putih' }
];

export const TenantStore = {
  _tenants: FALLBACK_TENANTS,
  _current: null,
  _listeners: new Set(),

  init() {
    let saved = null;
    try {
      saved = localStorage.getItem('klontonk:tenant');
    } catch (e) { /* storage tidak tersedia */ }
    const found = saved ? this._tenants.find(t => t.id === saved) : null;
    // GUARD: nilai tersimpan yang tidak valid (atau storage kosong) fallback ke tenant pertama.
    // Tanpa ini, _current bisa undefined dan setCurrent() crash → seluruh app mati
    // (beranda kosong, navigasi tidak terpasang).
    this._current = found || this._tenants[0];
  },

  // Muat daftar tenant dari Supabase. Dipanggil setelah login, sebelum StockStore/SalesStore/ReturnStore
  // dimuat (ketiganya memakai getAll() untuk mengelompokkan data per tenant).
  async load() {
    const result = await run(db.from('tenants').select('id,name').order('id'));
    if (!result.ok) return { success: false, error: describeResult(result), expired: !!result.expired };
    if (!result.data.length) return { success: false, error: 'Daftar tenant kosong.' };

    this._tenants = result.data;
    // Tenant aktif mungkin tidak lagi ada di daftar baru (jarang terjadi) → fallback ke yang pertama.
    if (!this._current || !this._tenants.some(t => t.id === this._current.id)) {
      this._current = this._tenants[0];
    }
    return { success: true };
  },

  getAll() { return [...this._tenants]; },

  getCurrent() {
    // GUARD: jangan pernah mengembalikan null/undefined
    if (!this._current) this.init();
    return this._current;
  },

  setCurrent(tenantId) {
    const tenant = this._tenants.find(t => t.id === tenantId);
    if (!tenant) return; // ID tak dikenal → abaikan, biarkan tenant aktif
    if (this._current && tenant.id === this._current.id) return;
    this._current = tenant;
    try {
      localStorage.setItem('klontonk:tenant', tenantId);
    } catch (e) { /* abaikan */ }
    this._listeners.forEach(fn => fn(tenant));
  },

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
};
