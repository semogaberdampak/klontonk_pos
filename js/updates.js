import { db, run, describeResult } from './supabase.js';

// Info Update (perubahan aplikasi & jadwal maintenance) di tabel `app_updates` (db/schema.sql).
// Semua user boleh membaca; hanya admin yang boleh mengubah (dijaga RLS). Selama belum termuat atau
// bila database tidak bisa dijangkau, dipakai daftar bawaan di bawah agar popup sapaan tetap punya isi.
const TABLE = 'app_updates';
const COLUMNS = 'id,kind,title,description,color,sort_order';

export const UPDATE_KINDS = { update: 'Perubahan Terbaru', maintenance: 'Maintenance' };
export const UPDATE_COLORS = [
  { value: '#16A34A', label: 'Hijau' },
  { value: '#DC2626', label: 'Merah' },
  { value: '#0060AF', label: 'Biru' },
  { value: '#F59E0B', label: 'Kuning' }
];
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const MAX_TITLE = 80;
const MAX_DESC = 300;

const DEFAULTS = [
  { id: 'd1', kind: 'update', color: '#16A34A', title: 'Mode Terang Baru', description: 'Palet krem hangat yang lebih nyaman dibaca sepanjang hari.' },
  { id: 'd2', kind: 'update', color: '#DC2626', title: 'Tombol Logout Lebih Kontras', description: 'Sekarang tampil solid merah — lebih mudah ditemukan, lebih sulit salah tekan.' },
  { id: 'd3', kind: 'update', color: '#0060AF', title: 'Perbaikan Menu Stok', description: 'Sub-menu Stok tidak lagi tertutup sendiri saat dibuka di layar kecil.' },
  { id: 'd4', kind: 'update', color: '#F59E0B', title: 'Navigasi Multi-Tenant', description: 'Pindah antar cabang tetap ringan langsung dari header.' },
  { id: 'd5', kind: 'maintenance', color: '#0060AF', title: 'Maintenance Terjadwal', description: 'Minggu, 02.00–03.00 WIB — sebagian fitur mungkin tidak tersedia sementara.' },
  { id: 'd6', kind: 'maintenance', color: '#0060AF', title: 'Roadmap Berikutnya', description: 'Laporan kasir cetak dan sinkronisasi stok antar cabang.' }
];

let rows = DEFAULTS;

const toRow = ({ id, kind, title, description, color }) => ({ id, kind, title, description: description || '', color });

// Validasi tampilan; batasan yang sama diulang oleh database.
function validate({ kind, title, description, color }) {
  if (!UPDATE_KINDS[kind]) return 'Jenis tidak valid.';
  const t = String(title || '').trim();
  if (!t) return 'Judul wajib diisi.';
  if (t.length > MAX_TITLE) return `Judul maksimal ${MAX_TITLE} karakter.`;
  if (String(description || '').trim().length > MAX_DESC) return `Deskripsi maksimal ${MAX_DESC} karakter.`;
  if (!COLOR_PATTERN.test(color)) return 'Warna tidak valid.';
  return '';
}

const clean = ({ kind, title, description, color }) => ({
  kind, color, title: String(title).trim(), description: String(description || '').trim() || null
});

const describe = (result) => describeResult(result, { forbidden: 'Hanya Admin yang boleh mengubah info update.' });

export const UpdateStore = {
  list(kind) { return rows.filter((row) => row.kind === kind); },

  async load() {
    const result = await run(db.from(TABLE).select(COLUMNS).order('sort_order').order('id'));
    if (!result.ok) return { success: false, error: describe(result), expired: !!result.expired };
    if (result.data.length) rows = result.data.map(toRow);
    return { success: true };
  },

  async add(input) {
    const invalid = validate(input);
    if (invalid) return { success: false, error: invalid };
    const sortOrder = rows.filter((row) => row.kind === input.kind).length + 1;
    const result = await run(db.from(TABLE).insert({ ...clean(input), sort_order: sortOrder }));
    if (!result.ok) return { success: false, error: describe(result) };
    return this.load();
  },

  async update(id, input) {
    const invalid = validate(input);
    if (invalid) return { success: false, error: invalid };
    const result = await run(db.from(TABLE).update(clean(input)).eq('id', id));
    if (!result.ok) return { success: false, error: describe(result) };
    return this.load();
  },

  async remove(id) {
    const result = await run(db.from(TABLE).delete().eq('id', id));
    if (!result.ok) return { success: false, error: describe(result) };
    return this.load();
  }
};
