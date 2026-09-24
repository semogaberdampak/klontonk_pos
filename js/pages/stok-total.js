import { StockStore, LOW_STOCK_MAX } from '../stock.js';
import { SalesStore } from '../sales.js';
import { TenantStore } from '../tenant.js';
import { esc, formatQty } from '../format.js';

// ============ HALAMAN STOK TOTAL ============
// Sisa stok terakhir per barang. StockStore sudah dikurangi otomatis tiap transaksi kasir,
// jadi jumlah di sini = stok setelah semua penjualan. Halaman ini hanya membaca.

const FILTERS = [
  { id: 'semua', label: 'Semua' },
  { id: 'menipis', label: 'Menipis' },
  { id: 'habis', label: 'Habis' }
];

const ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

let filter = 'semua';
let query = '';

const statusOf = (qty) => (qty <= 0 ? 'habis' : qty <= LOW_STOCK_MAX ? 'menipis' : 'aman');
const STATUS_TEXT = { habis: 'Habis', menipis: 'Menipis', aman: 'Aman' };

// Total terjual per id barang dari seluruh riwayat penjualan tenant aktif.
function soldById() {
  const sold = new Map();
  for (const sale of SalesStore.list()) {
    for (const line of sale.lines) sold.set(line.id, (sold.get(line.id) || 0) + line.qty);
  }
  return sold;
}

function summarize(items) {
  return items.reduce((sum, item) => {
    const status = statusOf(item.qty);
    return {
      low: sum.low + (status === 'menipis' ? 1 : 0),
      out: sum.out + (status === 'habis' ? 1 : 0)
    };
  }, { low: 0, out: 0 });
}

function matches(item) {
  const status = statusOf(item.qty);
  if (filter !== 'semua' && status !== filter) return false;
  const needle = query.trim().toLowerCase();
  return !needle || item.name.toLowerCase().includes(needle) || (item.barcode || '').includes(needle);
}

function rowHtml(item, sold) {
  const status = statusOf(item.qty);
  const soldQty = sold.get(item.id) || 0;
  const barcode = item.barcode ? ` · <span class="stok-barcode">${esc(item.barcode)}</span>` : '';
  return `
    <li class="stt-row is-${status}">
      <div class="stt-meta">
        <p class="stt-name">${esc(item.name)}</p>
        <p class="stt-sub">Terjual ${esc(formatQty(soldQty))} ${esc(item.unit)}${barcode}</p>
      </div>
      <div class="stt-qty">
        <p class="stt-qty-num"><strong>${esc(formatQty(item.qty))}</strong> ${esc(item.unit)}</p>
        <span class="stt-badge is-${status}">${STATUS_TEXT[status]}</span>
      </div>
    </li>`;
}

function listHtml(items, sold) {
  const shown = items.filter(matches);
  if (!items.length) return '<li class="stt-empty">Belum ada barang. Tambahkan lewat menu Stok Awal.</li>';
  if (!shown.length) return '<li class="stt-empty">Tidak ada barang yang cocok.</li>';
  return shown.map((item) => rowHtml(item, sold)).join('');
}

export function renderStokTotalPage() {
  const items = StockStore.list();
  const tenant = TenantStore.getCurrent();
  const { low, out } = summarize(items);

  const chips = FILTERS.map((f) => `
    <button type="button" class="stt-chip${f.id === filter ? ' is-active' : ''}" data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('');

  return `
    <div class="page-header">
      <p class="greeting">Stok · ${esc(tenant.name)}</p>
      <h1 class="page-title">Stok Total</h1>
      <p class="page-subtitle">Sisa stok terakhir setelah semua transaksi kasir.</p>
    </div>

    <div class="stt-page">
      <div class="rep-stats" aria-label="Ringkasan stok">
        <div class="rep-stat is-wide">
          <span class="rep-stat-label">Jenis barang</span>
          <span class="rep-stat-value">${items.length}</span>
        </div>
        <div class="rep-stat">
          <span class="rep-stat-label">Menipis</span>
          <span class="rep-stat-value">${low}</span>
          <span class="rep-stat-sub">sisa ≤ ${LOW_STOCK_MAX}</span>
        </div>
        <div class="rep-stat">
          <span class="rep-stat-label">Habis</span>
          <span class="rep-stat-value">${out}</span>
          <span class="rep-stat-sub">sisa 0</span>
        </div>
      </div>

      <section class="activity-card" aria-label="Daftar sisa stok">
        <div class="stt-tools">
          <div class="stt-search">
            <span class="stt-search-icon">${ICON_SEARCH}</span>
            <input type="search" id="sttSearch" class="form-input" placeholder="Cari nama atau barcode" value="${esc(query)}" autocomplete="off" aria-label="Cari barang" />
          </div>
          <div class="stt-chips" id="sttChips" role="group" aria-label="Filter status stok">${chips}</div>
        </div>
        <ul class="stt-list" id="sttList" aria-live="polite">${listHtml(items, soldById())}</ul>
      </section>
    </div>
  `;
}

export function initStokTotalPage() {
  const list = document.getElementById('sttList');
  const chips = document.getElementById('sttChips');
  const search = document.getElementById('sttSearch');
  if (!list || !chips || !search) return;

  const refresh = () => { list.innerHTML = listHtml(StockStore.list(), soldById()); };

  search.addEventListener('input', () => { query = search.value; refresh(); });

  chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    chips.querySelectorAll('[data-filter]').forEach((el) => {
      const active = el.dataset.filter === filter;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-pressed', String(active));
    });
    refresh();
  });
}
