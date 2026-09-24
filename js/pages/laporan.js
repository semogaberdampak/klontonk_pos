import { StockStore, LOW_STOCK_MAX } from '../stock.js';
import { SalesStore } from '../sales.js';
import { ReturnStore, REASONS } from '../returns.js';
import { TenantStore } from '../tenant.js';
import { Auth } from '../auth.js';
import { PERIODS, periodRange, periodLabel, containsDate, aggregate } from '../report.js';
import { esc, formatQty, formatWhen, formatRupiah } from '../format.js';

// ============ HALAMAN LAPORAN ============
// Empat laporan siap cetak, dibuka lewat sheet "Menu Laporan": Stok Awal, Stok Keluar (Laku),
// Stok Retur, Stok Total. Semuanya hanya membaca data yang sudah dimuat (StockStore/SalesStore/
// ReturnStore) — tidak ada panggilan jaringan tambahan. Tombol Cetak memakai window.print().

const REASON_LABEL = Object.fromEntries(Object.values(REASONS).flat().map((r) => [r.id, r.label]));

const now = () => new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Periode aktif per laporan (bertahan selama sesi, selalu periode berjalan — laporan cetak, bukan penjelajah riwayat).
let kindKeluar = 'harian';
let kindRetur = 'harian';

function headerHtml(title) {
  const tenant = TenantStore.getCurrent();
  const user = Auth.getCurrentUser();
  return `
    <div class="lap-card-head">
      <div>
        <h2 class="section-title">${esc(title)}</h2>
        <p class="lap-meta">${esc(tenant.name)} · Dicetak ${esc(now())}${user ? ` oleh ${esc(user.name)}` : ''}</p>
      </div>
      <button type="button" class="btn btn-secondary lap-print-btn" data-print>Cetak</button>
    </div>`;
}

function periodTabsHtml(kind) {
  const tabs = PERIODS.map((period) => `
    <button type="button" role="tab" aria-selected="${period.id === kind}" class="${period.id === kind ? 'is-active' : ''}" data-period="${period.id}">${esc(period.label)}</button>`).join('');
  return `<div class="rep-seg" role="tablist" aria-label="Periode laporan">${tabs}</div>`;
}

function bindPrintAndTabs(root, onPeriodChange) {
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-print]')) { window.print(); return; }
    const tab = event.target.closest('[data-period]');
    if (tab && onPeriodChange) onPeriodChange(tab.dataset.period);
  });
}

// ---------- Laporan Stok Awal ----------

function stokAwalSummarize(items) {
  return items.reduce((sum, item) => ({
    priced: sum.priced + (item.price != null ? 1 : 0),
    value: sum.value + (item.price != null ? item.qty * item.price : 0)
  }), { priced: 0, value: 0 });
}

function stokAwalTableHtml(items) {
  if (!items.length) return '<p class="lap-empty">Belum ada barang di Stok Awal.</p>';
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return `
    <div class="lap-table-wrap">
      <table class="lap-table">
        <thead><tr><th>Nama Barang</th><th>Jumlah</th><th>Harga</th><th>Subtotal</th></tr></thead>
        <tbody>${sorted.map((item) => `
          <tr>
            <td class="lap-cell-name">${esc(item.name)}</td>
            <td class="lap-cell-num">${esc(formatQty(item.qty))} ${esc(item.unit)}</td>
            <td class="lap-cell-num">${item.price != null ? esc(formatRupiah(item.price)) : '—'}</td>
            <td class="lap-cell-num">${item.price != null ? esc(formatRupiah(item.qty * item.price)) : '—'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

export function renderLaporanStokAwalPage() {
  const items = StockStore.list();
  const { priced, value } = stokAwalSummarize(items);
  return `
    <div class="page-header">
      <p class="greeting">Laporan · ${esc(TenantStore.getCurrent().name)}</p>
      <h1 class="page-title">Laporan Stok Awal</h1>
      <p class="page-subtitle">Daftar stok saat ini, siap cetak.</p>
    </div>
    <div class="lap-page" id="lapPage">
      <section class="activity-card lap-card" aria-label="Laporan Stok Awal">
        ${headerHtml('Laporan Stok Awal')}
        <div class="rep-stats">
          <div class="rep-stat"><span class="rep-stat-label">Jenis Barang</span><strong class="rep-stat-value">${items.length}</strong></div>
          <div class="rep-stat"><span class="rep-stat-label">Sudah Berharga</span><strong class="rep-stat-value">${priced}</strong><span class="rep-stat-sub">dari ${items.length} barang</span></div>
          <div class="rep-stat is-wide"><span class="rep-stat-label">Estimasi Nilai Stok</span><strong class="rep-stat-value">${esc(formatRupiah(value))}</strong></div>
        </div>
        ${stokAwalTableHtml(items)}
      </section>
    </div>`;
}

export function initLaporanStokAwalPage() {
  const page = document.getElementById('lapPage');
  if (page) bindPrintAndTabs(page, null);
}

// ---------- Laporan Stok Keluar (Laku) ----------

function keluarSectionHtml() {
  const range = periodRange(kindKeluar, new Date());
  const data = aggregate(kindKeluar, range, SalesStore.list());
  const ranked = [...data.items].sort((a, b) => b.qty - a.qty);

  const table = !ranked.length ? '<p class="lap-empty">Belum ada penjualan di periode ini.</p>' : `
    <div class="lap-table-wrap">
      <table class="lap-table">
        <thead><tr><th>Nama Barang</th><th>Terjual</th><th>Omzet</th></tr></thead>
        <tbody>${ranked.map((item) => `
          <tr>
            <td class="lap-cell-name">${esc(item.name)}</td>
            <td class="lap-cell-num">${esc(formatQty(item.qty))} ${esc(item.unit)}</td>
            <td class="lap-cell-num">${esc(formatRupiah(item.revenue))}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;

  return `
    <section class="activity-card lap-card" aria-label="Laporan Stok Keluar (Laku)" id="lapKeluarCard">
      ${headerHtml('Laporan Stok Keluar (Laku)')}
      <p class="lap-period-label">${esc(periodLabel(kindKeluar, range))}</p>
      ${periodTabsHtml(kindKeluar)}
      <div class="rep-stats">
        <div class="rep-stat"><span class="rep-stat-label">Item Terjual</span><strong class="rep-stat-value">${esc(formatQty(data.itemCount))}</strong><span class="rep-stat-sub">${data.kindCount} jenis barang</span></div>
        <div class="rep-stat"><span class="rep-stat-label">Transaksi</span><strong class="rep-stat-value">${esc(formatQty(data.trxCount))}</strong></div>
        <div class="rep-stat is-wide"><span class="rep-stat-label">Omzet</span><strong class="rep-stat-value">${esc(formatRupiah(data.revenue))}</strong></div>
      </div>
      ${table}
    </section>`;
}

export function renderLaporanStokKeluarPage() {
  return `
    <div class="page-header">
      <p class="greeting">Laporan · ${esc(TenantStore.getCurrent().name)}</p>
      <h1 class="page-title">Laporan Stok Keluar (Laku)</h1>
      <p class="page-subtitle">Barang keluar akibat penjualan, siap cetak.</p>
    </div>
    <div class="lap-page" id="lapPage">${keluarSectionHtml()}</div>`;
}

export function initLaporanStokKeluarPage() {
  const page = document.getElementById('lapPage');
  if (!page) return;
  bindPrintAndTabs(page, (period) => {
    kindKeluar = period;
    page.innerHTML = keluarSectionHtml();
  });
}

// ---------- Laporan Stok Retur ----------

function returSectionHtml() {
  const range = periodRange(kindRetur, new Date());
  const returns = ReturnStore.list().filter((ret) => containsDate(range, new Date(ret.at)));
  const customer = returns.filter((r) => r.kind === 'pelanggan');
  const supplier = returns.filter((r) => r.kind === 'supplier');
  const refund = customer.reduce((sum, r) => sum + r.amount, 0);
  const sorted = [...returns].sort((a, b) => new Date(b.at) - new Date(a.at));

  const table = !sorted.length ? '<p class="lap-empty">Belum ada retur di periode ini.</p>' : `
    <div class="lap-table-wrap">
      <table class="lap-table">
        <thead><tr><th>Barang</th><th>Waktu</th><th>Jenis</th><th>Jumlah</th><th>Nilai</th></tr></thead>
        <tbody>${sorted.map((r) => `
          <tr>
            <td class="lap-cell-name">${esc(r.name)}<br><span class="lap-cell-sub">${esc(REASON_LABEL[r.reason] || r.reason)}</span></td>
            <td class="lap-cell-num">${esc(formatWhen(r.at))}</td>
            <td class="lap-cell-num">${r.kind === 'pelanggan' ? 'Pelanggan' : 'Supplier'}</td>
            <td class="lap-cell-num">${esc(formatQty(r.qty))} ${esc(r.unit)}</td>
            <td class="lap-cell-num">${r.kind === 'pelanggan' ? esc(formatRupiah(r.amount)) : '—'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;

  return `
    <section class="activity-card lap-card" aria-label="Laporan Stok Retur" id="lapReturCard">
      ${headerHtml('Laporan Stok Retur')}
      <p class="lap-period-label">${esc(periodLabel(kindRetur, range))}</p>
      ${periodTabsHtml(kindRetur)}
      <div class="rep-stats">
        <div class="rep-stat"><span class="rep-stat-label">Retur Pelanggan</span><strong class="rep-stat-value">${customer.length}</strong></div>
        <div class="rep-stat"><span class="rep-stat-label">Retur Supplier</span><strong class="rep-stat-value">${supplier.length}</strong></div>
        <div class="rep-stat is-wide"><span class="rep-stat-label">Uang Dikembalikan</span><strong class="rep-stat-value">${esc(formatRupiah(refund))}</strong></div>
      </div>
      ${table}
    </section>`;
}

export function renderLaporanStokReturPage() {
  return `
    <div class="page-header">
      <p class="greeting">Laporan · ${esc(TenantStore.getCurrent().name)}</p>
      <h1 class="page-title">Laporan Stok Retur</h1>
      <p class="page-subtitle">Retur pelanggan & barang rusak, siap cetak.</p>
    </div>
    <div class="lap-page" id="lapPage">${returSectionHtml()}</div>`;
}

export function initLaporanStokReturPage() {
  const page = document.getElementById('lapPage');
  if (!page) return;
  bindPrintAndTabs(page, (period) => {
    kindRetur = period;
    page.innerHTML = returSectionHtml();
  });
}

// ---------- Laporan Stok Total ----------

const statusOf = (qty) => (qty <= 0 ? 'habis' : qty <= LOW_STOCK_MAX ? 'menipis' : 'aman');
const STATUS_TEXT = { habis: 'Habis', menipis: 'Menipis', aman: 'Aman' };

export function renderLaporanStokTotalPage() {
  const items = [...StockStore.list()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const low = items.filter((i) => statusOf(i.qty) === 'menipis').length;
  const out = items.filter((i) => statusOf(i.qty) === 'habis').length;

  const table = !items.length ? '<p class="lap-empty">Belum ada barang di Stok Awal.</p>' : `
    <div class="lap-table-wrap">
      <table class="lap-table">
        <thead><tr><th>Nama Barang</th><th>Sisa Stok</th><th>Status</th></tr></thead>
        <tbody>${items.map((item) => `
          <tr>
            <td class="lap-cell-name">${esc(item.name)}</td>
            <td class="lap-cell-num">${esc(formatQty(item.qty))} ${esc(item.unit)}</td>
            <td class="lap-cell-num">${esc(STATUS_TEXT[statusOf(item.qty)])}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;

  return `
    <div class="page-header">
      <p class="greeting">Laporan · ${esc(TenantStore.getCurrent().name)}</p>
      <h1 class="page-title">Laporan Stok Total</h1>
      <p class="page-subtitle">Sisa stok terakhir setelah semua transaksi, siap cetak.</p>
    </div>
    <div class="lap-page" id="lapPage">
      <section class="activity-card lap-card" aria-label="Laporan Stok Total">
        ${headerHtml('Laporan Stok Total')}
        <div class="rep-stats">
          <div class="rep-stat"><span class="rep-stat-label">Jenis Barang</span><strong class="rep-stat-value">${items.length}</strong></div>
          <div class="rep-stat"><span class="rep-stat-label">Menipis</span><strong class="rep-stat-value">${low}</strong><span class="rep-stat-sub">sisa ≤ ${LOW_STOCK_MAX}</span></div>
          <div class="rep-stat"><span class="rep-stat-label">Habis</span><strong class="rep-stat-value">${out}</strong></div>
        </div>
        ${table}
      </section>
    </div>`;
}

export function initLaporanStokTotalPage() {
  const page = document.getElementById('lapPage');
  if (page) bindPrintAndTabs(page, null);
}
