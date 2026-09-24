import { SalesStore } from '../sales.js';
import { TenantStore } from '../tenant.js';
import { PERIODS, periodRange, shiftAnchor, periodLabel, containsDate, aggregate } from '../report.js';
import { esc, formatQty, formatRupiah } from '../format.js';

// ============ HALAMAN STOK KELUAR — LAKU ============
// Laporan barang yang keluar karena penjualan kasir, per hari / minggu / bulan.
// Data dari SalesStore (riwayat penjualan); halaman ini hanya membaca.

const INITIAL_TRX_ROWS = 8;

const CURRENT_TEXT = { harian: 'Hari ini', mingguan: 'Minggu ini', bulanan: 'Bulan ini' };
const CHART_TITLE = { harian: 'Per jam', mingguan: 'Per hari', bulanan: 'Per tanggal' };

const ICON_PREV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const ICON_NEXT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

// --- Keadaan (kunci periode bertahan selama sesi; tanggal selalu mulai dari hari ini) ---
let kind = 'harian';
let anchor = new Date();
let showAllTrx = false;

// ---------- HTML ----------

function controlsHtml(range, isCurrent) {
  const tabs = PERIODS.map((period) => `
    <button type="button" role="tab" id="repTab-${period.id}" aria-selected="${period.id === kind}"
            class="${period.id === kind ? 'is-active' : ''}" data-period="${period.id}">${period.label}</button>`).join('');

  return `
    <div class="rep-seg" role="tablist" aria-label="Periode laporan">${tabs}</div>
    <div class="rep-nav">
      <button type="button" class="rep-nav-btn" data-prev aria-label="Periode sebelumnya">${ICON_PREV}</button>
      <div class="rep-nav-label" aria-live="polite">
        <strong>${esc(periodLabel(kind, range))}</strong>
        ${isCurrent ? `<span class="rep-now">${CURRENT_TEXT[kind]}</span>` : `<button type="button" class="rep-today" data-today>Kembali ke ${CURRENT_TEXT[kind].toLowerCase()}</button>`}
      </div>
      <button type="button" class="rep-nav-btn" data-next aria-label="Periode berikutnya"${isCurrent ? ' disabled' : ''}>${ICON_NEXT}</button>
    </div>`;
}

function statsHtml(data) {
  return `
    <div class="rep-stats">
      <div class="rep-stat">
        <span class="rep-stat-label">Item terjual</span>
        <strong class="rep-stat-value">${esc(formatQty(data.itemCount))}</strong>
        <span class="rep-stat-sub">${esc(formatQty(data.kindCount))} jenis barang</span>
      </div>
      <div class="rep-stat">
        <span class="rep-stat-label">Transaksi</span>
        <strong class="rep-stat-value">${esc(formatQty(data.trxCount))}</strong>
        <span class="rep-stat-sub">${data.trxCount ? `rata-rata ${esc(formatQty(Math.round(data.itemCount / data.trxCount * 10) / 10))} item` : 'belum ada'}</span>
      </div>
      <div class="rep-stat is-wide">
        <span class="rep-stat-label">Omzet</span>
        <strong class="rep-stat-value">${esc(formatRupiah(data.revenue))}</strong>
      </div>
    </div>`;
}

function barLabel(bucket, index) {
  if (kind === 'mingguan') return `<span class="rep-bar-day">${esc(bucket.label)}</span><span class="rep-bar-date">${esc(bucket.sub)}</span>`;
  const show = kind === 'harian' ? index % 3 === 0 : (index === 0 || (index + 1) % 5 === 0);
  return show ? `<span class="rep-bar-day">${esc(bucket.label)}</span>` : '';
}

function chartHtml(data) {
  const bars = data.buckets.map((bucket, index) => {
    const percent = data.peakQty ? Math.round((bucket.qty / data.peakQty) * 100) : 0;
    const height = bucket.qty ? Math.max(percent, 4) : 0;
    const hint = `${kind === 'harian' ? `Jam ${bucket.label}` : kind === 'mingguan' ? `${bucket.label} ${bucket.sub}` : `Tanggal ${bucket.label}`}: ${formatQty(bucket.qty)} item, ${bucket.trx} transaksi, ${formatRupiah(bucket.revenue)}`;
    const value = kind === 'mingguan' && bucket.qty ? `<span class="rep-bar-value">${esc(formatQty(bucket.qty))}</span>` : '';
    return `
      <div class="rep-bar${bucket.qty ? ' has-value' : ''}" style="--h:${height}%" title="${esc(hint)}" role="img" aria-label="${esc(hint)}">
        <div class="rep-bar-track">${value}<span class="rep-bar-fill"></span></div>
        <div class="rep-bar-label">${barLabel(bucket, index)}</div>
      </div>`;
  }).join('');

  return `
    <section class="activity-card rep-card" aria-label="Grafik item terjual">
      <div class="stok-head"><h2 class="section-title">Item Terjual <span class="stok-count">${CHART_TITLE[kind]}</span></h2></div>
      <div class="rep-chart rep-chart-${kind}">${bars}</div>
    </section>`;
}

function itemsHtml(data) {
  const max = data.items[0] ? data.items[0].qty : 0;
  const rows = data.items.map((item, index) => `
    <li class="rep-item">
      <span class="rep-rank${index < 3 ? ' is-top' : ''}">${index + 1}</span>
      <div class="rep-item-main">
        <p class="rep-item-name">${esc(item.name)}</p>
        <div class="rep-meter" aria-hidden="true"><span style="width:${max ? Math.max(Math.round((item.qty / max) * 100), 3) : 0}%"></span></div>
      </div>
      <div class="rep-item-figs">
        <strong>${esc(formatQty(item.qty))} ${esc(item.unit)}</strong>
        <small>${esc(formatRupiah(item.revenue))}</small>
      </div>
    </li>`).join('');

  return `
    <section class="activity-card rep-card" aria-label="Barang keluar">
      <div class="stok-head"><h2 class="section-title">Barang Keluar <span class="stok-count">${data.kindCount} jenis</span></h2></div>
      <ol class="rep-items">${rows}</ol>
    </section>`;
}

function saleTime(sale) {
  const date = new Date(sale.at);
  const time = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (kind === 'harian') return time;
  return `${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}, ${time}`;
}

function salesListHtml(data) {
  const shown = showAllTrx ? data.sales : data.sales.slice(0, INITIAL_TRX_ROWS);
  const rows = shown.map((sale) => {
    const qty = sale.lines.reduce((sum, line) => sum + line.qty, 0);
    const lines = sale.lines.map((line) => `
      <li><span>${esc(line.name)} <small>${esc(formatQty(line.qty))} ${esc(line.unit)} × ${esc(formatRupiah(line.price))}</small></span><span>${esc(formatRupiah(line.qty * line.price))}</span></li>`).join('');
    return `
      <li>
        <details class="rep-trx">
          <summary>
            <span class="rep-trx-main"><strong>${esc(saleTime(sale))}</strong><small>${esc(sale.no)}</small></span>
            <span class="rep-trx-side"><strong>${esc(formatRupiah(sale.total))}</strong><small>${esc(formatQty(qty))} item · ${sale.method === 'tunai' ? 'Tunai' : 'QRIS/Transfer'}</small></span>
          </summary>
          <ul class="rep-trx-lines">${lines}</ul>
          <p class="rep-trx-foot">Kasir: ${esc(sale.cashier)}</p>
        </details>
      </li>`;
  }).join('');

  const more = data.sales.length > INITIAL_TRX_ROWS
    ? `<button type="button" class="btn btn-secondary rep-more" data-more>${showAllTrx ? 'Tampilkan lebih sedikit' : `Tampilkan semua (${data.sales.length})`}</button>`
    : '';

  return `
    <section class="activity-card rep-card" aria-label="Riwayat penjualan">
      <div class="stok-head"><h2 class="section-title">Riwayat Penjualan <span class="stok-count">${data.sales.length} transaksi</span></h2></div>
      <ul class="rep-trx-list">${rows}</ul>
      ${more}
    </section>`;
}

function emptyHtml(isCurrent) {
  return `
    <section class="activity-card rep-empty" aria-label="Belum ada penjualan">
      <div class="rep-empty-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
      </div>
      <h3>Belum ada penjualan</h3>
      <p>${isCurrent ? 'Penjualan dari menu Transaksi akan muncul di sini.' : 'Tidak ada barang keluar pada periode ini.'}</p>
      <a class="btn btn-primary" href="#/kasir">Buka Transaksi</a>
    </section>`;
}

function bodyHtml(data, isCurrent) {
  if (!data.trxCount) return statsHtml(data) + emptyHtml(isCurrent);
  return statsHtml(data) + chartHtml(data) + itemsHtml(data) + salesListHtml(data);
}

export function renderStokKeluarPage() {
  const tenant = TenantStore.getCurrent();
  anchor = new Date();
  showAllTrx = false;

  return `
    <div class="page-header">
      <p class="greeting">Stok · ${esc(tenant.name)}</p>
      <h1 class="page-title">Stok Keluar · Laku</h1>
      <p class="page-subtitle">Barang yang keluar karena penjualan kasir, per hari, minggu, atau bulan.</p>
    </div>
    <div class="rep-page" id="repRoot"></div>
  `;
}

// ---------- Interaksi ----------

export function initStokKeluarPage() {
  const root = document.getElementById('repRoot');
  if (!root) return;

  const focusActiveTab = () => {
    const active = document.getElementById(`repTab-${kind}`);
    if (active) active.focus({ preventScroll: true });
  };

  const render = () => {
    const range = periodRange(kind, anchor);
    const isCurrent = containsDate(range, new Date());
    const data = aggregate(kind, range, SalesStore.list());

    root.innerHTML = `
      <div class="rep-controls">${controlsHtml(range, isCurrent)}</div>
      <div class="rep-body">${bodyHtml(data, isCurrent)}</div>`;
  };

  const setKind = (next) => {
    kind = next;
    anchor = new Date();
    showAllTrx = false;
    render();
    focusActiveTab();
  };

  root.addEventListener('click', (event) => {
    const find = (selector) => event.target.closest(selector);

    const tab = find('[data-period]');
    if (tab) return setKind(tab.dataset.period);
    if (find('[data-prev]')) { anchor = shiftAnchor(kind, anchor, -1); showAllTrx = false; return render(); }
    if (find('[data-next]')) { anchor = shiftAnchor(kind, anchor, 1); showAllTrx = false; return render(); }
    if (find('[data-today]')) { anchor = new Date(); showAllTrx = false; return render(); }
    if (find('[data-more]')) { showAllTrx = !showAllTrx; render(); }
  });

  // Panah kiri/kanan pada tab berpindah periode (pola WAI-ARIA tabs)
  root.addEventListener('keydown', (event) => {
    if (!event.target.closest('[role="tab"]')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = PERIODS.findIndex((period) => period.id === kind);
    const step = event.key === 'ArrowRight' ? 1 : PERIODS.length - 1;
    setKind(PERIODS[(index + step) % PERIODS.length].id);
  });

  render();
}
