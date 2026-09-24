import { Auth } from '../auth.js';
import { TenantStore } from '../tenant.js';
import { StockStore, LOW_STOCK_MAX } from '../stock.js';
import { SalesStore } from '../sales.js';
import { ReturnStore } from '../returns.js';
import { esc, formatQty, formatRupiah } from '../format.js';

// ============ HALAMAN BERANDA ============
// Statistik dan aktivitas nyata dari data yang sudah dimuat (StockStore/SalesStore/ReturnStore),
// tanpa panggilan jaringan tambahan. Tidak ada data contoh/tetap di sini.

const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

// Perubahan dari kemarin. Tanpa pembanding (kemarin nol) angka persen tidak bermakna, jadi diberi teks netral.
function trend(today, yesterday) {
  if (yesterday <= 0) return today > 0 ? { dir: 'up', text: '↑ transaksi pertama hari ini' } : { dir: 'flat', text: 'Belum ada transaksi' };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return { dir: 'flat', text: 'Sama seperti kemarin' };
  return { dir: pct > 0 ? 'up' : 'down', text: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% dari kemarin` };
}

function statCard({ accent, bg, icon, label, value, trendInfo }) {
  return `
    <div class="stat-card" style="--accent-color: ${accent}; --accent-bg: ${bg};">
      <div class="stat-icon">${icon}</div>
      <p class="stat-label">${esc(label)}</p>
      <p class="stat-value">${esc(value)}</p>
      <span class="stat-trend ${trendInfo.dir}">${esc(trendInfo.text)}</span>
    </div>`;
}

function statsHtml() {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sales = SalesStore.list();
  const salesOn = (day) => sales.filter((sale) => isSameDay(new Date(sale.at), day));
  const todaySales = salesOn(today);
  const yesterdaySales = salesOn(yesterday);
  const omzetToday = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const omzetYesterday = yesterdaySales.reduce((sum, sale) => sum + sale.total, 0);

  const lowStockCount = StockStore.list().filter((item) => item.qty <= LOW_STOCK_MAX).length;
  const returnsToday = ReturnStore.list().filter((ret) => isSameDay(new Date(ret.at), today)).length;

  return `
    <section class="stats-grid" aria-label="Statistik hari ini">
      ${statCard({
        accent: '#0060AF', bg: '#E8F1FA',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
        label: 'Omzet Hari Ini', value: formatRupiah(omzetToday), trendInfo: trend(omzetToday, omzetYesterday)
      })}
      ${statCard({
        accent: '#16A34A', bg: 'rgba(22,163,74,0.1)',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line></svg>',
        label: 'Transaksi Hari Ini', value: String(todaySales.length), trendInfo: trend(todaySales.length, yesterdaySales.length)
      })}
      ${statCard({
        accent: '#F59E0B', bg: 'rgba(245,158,11,0.1)',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
        label: 'Item Stok Rendah', value: String(lowStockCount),
        trendInfo: lowStockCount > 0 ? { dir: 'down', text: 'Perlu restok' } : { dir: 'up', text: 'Stok aman' }
      })}
      ${statCard({
        accent: '#0891B2', bg: 'rgba(8,145,178,0.1)',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
        label: 'Retur Hari Ini', value: String(returnsToday), trendInfo: { dir: 'flat', text: 'transaksi retur' }
      })}
    </section>`;
}

// Gabungan penjualan & retur terbaru (keduanya punya waktu nyata), diurutkan terbaru dulu.
function activityHtml() {
  const sales = SalesStore.list().map((sale) => ({
    at: sale.at,
    dotStyle: '',
    title: `Transaksi ${esc(sale.no)} berhasil`,
    meta: `${relativeTime(sale.at)} · ${esc(formatRupiah(sale.total))}`
  }));
  const returns = ReturnStore.list().map((ret) => ({
    at: ret.at,
    dotStyle: ret.kind === 'pelanggan'
      ? 'background: var(--color-warning); box-shadow: 0 0 0 3px rgba(245,158,11,0.15);'
      : 'background: var(--color-info); box-shadow: 0 0 0 3px rgba(8,145,178,0.15);',
    title: `Retur ${ret.kind === 'pelanggan' ? 'dari pelanggan' : 'ke supplier'}: ${esc(ret.name)} ${esc(formatQty(ret.qty))} ${esc(ret.unit)}`,
    meta: `${relativeTime(ret.at)} · oleh ${esc(ret.cashier)}`
  }));

  const items = [...sales, ...returns].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);

  if (!items.length) {
    return '<p class="activity-empty">Belum ada transaksi atau retur di tenant ini.</p>';
  }

  return `<div class="activity-list">${items.map((item) => `
      <div class="activity-item">
        <div class="activity-dot" style="${item.dotStyle}"></div>
        <div class="activity-content">
          <div class="activity-title">${item.title}</div>
          <div class="activity-meta">${item.meta}</div>
        </div>
      </div>`).join('')}</div>`;
}

export function renderHome() {
  const tenant = TenantStore.getCurrent();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 18 ? 'Selamat Sore' : 'Selamat Malam';

  return `
    <div class="page-header">
      <p class="greeting">${greeting} · ${esc(tenant.name)}</p>
      <h1 class="page-title">Dashboard Klontonk</h1>
      <p class="page-subtitle">Ringkasan operasional hari ini, ${now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </div>

    ${statsHtml()}

    <section aria-label="Aksi cepat">
      <h2 class="section-title">Aksi Cepat</h2>
      <div class="quick-grid">
        <button class="quick-card" data-navigate="#/kasir">
          <div class="quick-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="6" width="20" height="12" rx="2"></rect>
              <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"></path>
            </svg>
          </div>
          <div>
            <div class="quick-card-title">Transaksi</div>
            <div class="quick-card-desc">Transaksi penjualan baru</div>
          </div>
        </button>

        <button class="quick-card" data-navigate="#/stok/total">
          <div class="quick-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </div>
          <div>
            <div class="quick-card-title">Cek Stok</div>
            <div class="quick-card-desc">Lihat stok total</div>
          </div>
        </button>

        ${Auth.canEditStock() ? `<button class="quick-card" data-navigate="#/harga">
          <div class="quick-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="1" x2="12" y2="23"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
          </div>
          <div>
            <div class="quick-card-title">Update Harga</div>
            <div class="quick-card-desc">Sesuaikan harga produk</div>
          </div>
        </button>` : ''}

        <button class="quick-card" data-navigate="#/laporan/stok-awal">
          <div class="quick-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
          <div>
            <div class="quick-card-title">Laporan Kasir</div>
            <div class="quick-card-desc">Cetak / preview laporan</div>
          </div>
        </button>

        <button class="quick-card" data-navigate="#/stok/retur">
          <div class="quick-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
          </div>
          <div>
            <div class="quick-card-title">Retur Barang</div>
            <div class="quick-card-desc">Proses retur cepat</div>
          </div>
        </button>
      </div>
    </section>

    <section aria-label="Aktivitas terbaru">
      <h2 class="section-title">Aktivitas Terbaru</h2>
      <div class="activity-card">
        ${activityHtml()}
      </div>
    </section>
  `;
}
