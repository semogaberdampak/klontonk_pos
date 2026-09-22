import { ThemeManager } from './theme.js';
import { TenantStore } from './tenant.js';
import { UI } from './ui.js';
import { Router } from './router.js';
import { renderHome } from './pages/home.js';
import { Auth } from './auth.js';
import { renderLogin, initLoginPage } from './pages/login.js';
import { renderUsersPage, initUsersPage } from './pages/users.js';
import { renderStokAwalPage, initStokAwalPage } from './pages/stok-awal.js';
import { renderHargaPage, initHargaPage } from './pages/update-harga.js';
import { renderTransaksiPage, initTransaksiPage } from './pages/transaksi.js';
import { renderStokKeluarPage, initStokKeluarPage } from './pages/stok-keluar.js';
import { renderStokTotalPage, initStokTotalPage } from './pages/stok-total.js';
import { renderStokReturPage, initStokReturPage } from './pages/stok-retur.js';
import {
  renderLaporanStokAwalPage, initLaporanStokAwalPage,
  renderLaporanStokKeluarPage, initLaporanStokKeluarPage,
  renderLaporanStokReturPage, initLaporanStokReturPage,
  renderLaporanStokTotalPage, initLaporanStokTotalPage
} from './pages/laporan.js';
import { ReturnStore } from './returns.js';
import { checkDbStatus, describeDb } from './db-status.js';
import { SalesStore } from './sales.js';
import { StockStore } from './stock.js';
import { registerServiceWorker, watchConnectivity, isOnline, isOfflineReady, clearAppCache } from './pwa.js';

// === Initialize core systems ===
ThemeManager.init();
TenantStore.init();

// === PWA: service worker + pantau koneksi (aktif juga di halaman login) ===
registerServiceWorker();
watchConnectivity();

// === Gagal menyimpan stok/harga ke database (server mati, offline, atau ditolak) ===
StockStore.onSaveError((message) => UI.toast(message, { type: 'danger', duration: 9000 }));

// === Check Authentication — tampilkan login jika belum login ===
// WAJIB menunggu inisialisasi auth selesai (verifikasi signature session
// bersifat async). Tanpa await ini, status login dibaca terlalu dini dan
// user yang sudah login selalu "dilempar kembali" ke halaman login.
await Auth.ready;

if (!Auth.isAuthenticated()) {
  document.getElementById('app').style.display = 'none';
  document.body.insertAdjacentHTML('beforeend', `<div id="loginRoot">${renderLogin()}</div>`);
  initLoginPage();
} else {
  // Daftar tenant dimuat dulu dari database — stok, penjualan, dan retur dikelompokkan per tenant memakainya.
  const tenants = await TenantStore.load();
  if (tenants.expired) {
    Auth.logout(); // sesi Supabase sudah tidak berlaku → login ulang
    window.location.reload();
  } else {
    // Stok dan riwayat penjualan ada di database: muat dulu agar tiap halaman langsung menampilkan data terbaru.
    const [stock, sales, returns] = await Promise.all([StockStore.load(), SalesStore.load(), ReturnStore.load()]);
    if (stock.expired || sales.expired || returns.expired) {
      Auth.logout();
      window.location.reload();
    } else {
      const failed = [tenants, stock, sales, returns].find((result) => !result.success);
      if (failed) UI.toast(`Data belum bisa dimuat: ${failed.error}`, { type: 'danger', duration: 9000 });
      initAuthenticatedApp();
    }
  }
}

function initAuthenticatedApp() {

try {

// Set tenant aktif sesuai user yang login
const currentUser = Auth.getCurrentUser();
if (currentUser) TenantStore.setCurrent(currentUser.tenant);

// === Versi Aplikasi ===
const APP_VERSION = '1.2.0';

// === Ikon untuk Bottom Sheet ===
const SHEET_ICONS = {
  box: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
  dollar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
  userPlus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>',
  user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
  db: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"></path><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"></path></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  logout: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>'
};

// === Navigasi via hash ===
function navigate(path) {
  window.location.hash = path;
}

// === Bottom Navigation ===
const bottomNav = document.getElementById('bottomNav');
if (bottomNav) {
  // Tab langsung: Beranda, Transaksi, Laporan
  bottomNav.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  // Tab Stok → sheet sub-menu stok
  const stokTab = bottomNav.querySelector('[data-tab="stok"]');
  if (stokTab) stokTab.addEventListener('click', async () => {
    const sel = await UI.sheet({
      title: 'Menu Stok',
      items: [
        { id: '/stok/awal', label: 'Stok Awal', desc: 'Input & lihat stok awal periode', icon: SHEET_ICONS.box },
        { id: '/stok/keluar-laku', label: 'Stok Keluar (Laku)', desc: 'Stok keluar akibat penjualan', icon: SHEET_ICONS.box },
        { id: '/stok/retur', label: 'Stok Retur', desc: 'Retur pelanggan & barang rusak', icon: SHEET_ICONS.box },
        { id: '/stok/total', label: 'Stok Total', desc: 'Sisa stok terakhir setelah transaksi', icon: SHEET_ICONS.box }
      ]
    });
    if (sel) navigate(sel.id);
  });

  // Tab Laporan → sheet sub-menu laporan
  const laporanTab = bottomNav.querySelector('[data-tab="laporan"]');
  if (laporanTab) laporanTab.addEventListener('click', async () => {
    const sel = await UI.sheet({
      title: 'Menu Laporan',
      items: [
        { id: '/laporan/stok-awal', label: 'Stok Awal', desc: 'Laporan stok awal periode', icon: SHEET_ICONS.box },
        { id: '/laporan/stok-keluar', label: 'Stok Keluar (Laku)', desc: 'Laporan stok keluar akibat penjualan', icon: SHEET_ICONS.box },
        { id: '/laporan/stok-retur', label: 'Stok Retur', desc: 'Laporan retur pelanggan & barang rusak', icon: SHEET_ICONS.box },
        { id: '/laporan/stok-total', label: 'Stok Total', desc: 'Laporan sisa stok terkini', icon: SHEET_ICONS.box }
      ]
    });
    if (sel) navigate(sel.id);
  });

  // Tab Lainnya → sheet menu sekunder (Tambah User hanya admin)
  const lainnyaTab = bottomNav.querySelector('[data-tab="lainnya"]');
  if (lainnyaTab) lainnyaTab.addEventListener('click', async () => {
    const items = [
      { id: '/harga', label: 'Update Harga', desc: 'Atur harga jual per barang', icon: SHEET_ICONS.dollar }
    ];
    if (currentIsAdmin()) {
      items.push({ id: '/users', label: 'Tambah User', desc: 'Kelola akun admin & kasir', icon: SHEET_ICONS.userPlus });
    }
    const sel = await UI.sheet({ title: 'Lainnya', items });
    if (sel) navigate(sel.id);
  });
}

// === Tombol Akun (burger) → sheet akun ===
const accountBtn = document.getElementById('accountBtn');
if (accountBtn) {
  accountBtn.addEventListener('click', async () => {
    const user = Auth.getCurrentUser();
    if (!user) return;
    const tenant = TenantStore.getCurrent();
    // Status database dicek di latar belakang; sheet langsung tampil dengan "Memeriksa…".
    let dbStatus = null;
    const sheet = UI.sheet({
      side: 'left',
      profile: {
        avatar: user.avatar,
        name: user.name,
        role: user.role === 'admin' ? 'Admin' : 'Kasir',
        tenant: tenant ? tenant.name : ''
      },
      items: [
        { id: 'akun', label: 'Informasi Akun', desc: '@' + user.username, icon: SHEET_ICONS.user },
        { id: 'db', label: 'Koneksi', desc: 'Memeriksa koneksi…', icon: SHEET_ICONS.db, tone: 'wait' }
      ],
      // Terpin di bawah sheet, urutan dari atas: Pengaturan → Logout → Versi Aplikasi
      footer: {
        items: [
          { id: 'pengaturan', label: 'Pengaturan', desc: 'Tema & preferensi', icon: SHEET_ICONS.gear },
          { id: 'logout', label: 'Logout', danger: true, icon: SHEET_ICONS.logout },
          { id: 'versi', label: 'Versi Aplikasi', desc: 'v' + APP_VERSION + ' · Multi-Tenant', icon: SHEET_ICONS.info }
        ]
      }
    });
    checkDbStatus().then((status) => {
      dbStatus = status;
      const row = document.querySelector('#sheetRoot .sheet-item[data-id="db"]');
      if (!row) return; // sheet sudah ditutup
      const { tone, text } = describeDb(status);
      row.dataset.tone = tone;
      row.querySelector('.sheet-item-desc').textContent = text;
    });
    const sel = await sheet;
    if (!sel) return;
    if (sel.id === 'db') {
      const { tone, text } = describeDb(dbStatus || { state: 'offline' });
      UI.toast('Database: ' + text, { type: tone === 'ok' ? 'success' : 'warning' });
    } else if (sel.id === 'akun') navigate('/akun');
    else if (sel.id === 'pengaturan') navigate('/pengaturan');
    else if (sel.id === 'versi') UI.toast('Klontonk POS v' + APP_VERSION, { type: 'info' });
    else if (sel.id === 'logout') confirmLogout();
  });
}

// === Logout (konfirmasi) — dipakai sheet akun & halaman Informasi Akun ===
function confirmLogout() {
  UI.modal({
    title: 'Konfirmasi Keluar',
    message: 'Apakah Anda yakin ingin logout dari sistem?',
    icon: 'warning',
    confirmText: 'Ya, Keluar',
    cancelText: 'Batal',
    variant: 'danger'
  }).then((confirmed) => {
    if (confirmed) {
      Auth.logout();
      UI.toast('Anda telah logout', { type: 'success' });
      setTimeout(() => {
        window.location.reload();
      }, 300);
    }
  });
}

// (Navigasi drawer sidebar telah diganti Bottom Navigation + Bottom Sheet.
//  Sub-menu Stok & menu sekunder kini dibuka lewat sheet pada tab Stok/Lainnya.
//  Toggle mode terang/gelap dipindah ke halaman Pengaturan.)

// === Tenant Display (Read-only) ===
// GUARD: elemen tenant hanya ada di header — jangan referensi elemen drawer
// yang sudah dihapus (menyebabkan crash "Cannot set properties of null").
const tenantNameEl = document.getElementById('tenantName');

function updateTenantUI(tenant) {
  if (tenantNameEl) tenantNameEl.textContent = tenant.name;
}

TenantStore.subscribe(updateTenantUI);
updateTenantUI(TenantStore.getCurrent());

// === Quick Card Navigation ===
document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-navigate]');
  if (card) {
    window.location.hash = card.dataset.navigate.slice(1);
  }
});

// Cek admin secara defensif — kompatibel dengan semua versi Auth
// (fallback ke getCurrentUser() jika isAdmin() tidak tersedia)
function currentIsAdmin() {
  if (typeof Auth.isAdmin === 'function') return Auth.isAdmin();
  const u = Auth.getCurrentUser();
  return !!(u && u.role === 'admin');
}

// === Router Setup ===
const router = new Router();

// Guard: halaman admin ditolak untuk non-admin (cek ulang saat route diakses)
const adminGuard = (renderFn, initFn) => () => {
  if (!currentIsAdmin()) {
    return `
      <div class="page-header">
        <p class="greeting">Akses Ditolak</p>
        <h1 class="page-title">403</h1>
        <p class="page-subtitle">Halaman ini hanya dapat diakses oleh Admin.</p>
      </div>
      <div class="activity-card" style="text-align:center; padding: 40px 20px;">
        <div style="width:64px;height:64px;border-radius:var(--radius-lg);background:rgba(220,38,38,0.12);color:var(--color-danger);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
          </svg>
        </div>
        <h3 style="font-size:16px;font-weight:700;margin-bottom:8px;">Butuh Hak Akses Admin</h3>
        <p style="font-size:13px;color:var(--text-secondary);max-width:320px;margin:0 auto;">
          Jika Anda merasa ini keliru, hubungi admin pusat Anda.
        </p>
      </div>
    `;
  }
  // Render normal + init setelah DOM terpasang
  setTimeout(initFn, 150);
  return renderFn();
};

router
  .add('/beranda', renderHome)
  .add('/kasir', () => { setTimeout(initTransaksiPage, 150); return renderTransaksiPage(); })
  .add('/akun', accountPage)
  .add('/pengaturan', () => { setTimeout(initSettingsPage, 150); return settingsPage(); })
  .add('/stok/awal', () => { setTimeout(initStokAwalPage, 150); return renderStokAwalPage(); })
  .add('/stok/keluar-laku', () => { setTimeout(initStokKeluarPage, 150); return renderStokKeluarPage(); })
  .add('/stok/retur', () => { setTimeout(initStokReturPage, 150); return renderStokReturPage(); })
  .add('/stok/total', () => { setTimeout(initStokTotalPage, 150); return renderStokTotalPage(); })
  .add('/harga', () => { setTimeout(initHargaPage, 150); return renderHargaPage(); })
  .add('/laporan/stok-awal', () => { setTimeout(initLaporanStokAwalPage, 150); return renderLaporanStokAwalPage(); })
  .add('/laporan/stok-keluar', () => { setTimeout(initLaporanStokKeluarPage, 150); return renderLaporanStokKeluarPage(); })
  .add('/laporan/stok-retur', () => { setTimeout(initLaporanStokReturPage, 150); return renderLaporanStokReturPage(); })
  .add('/laporan/stok-total', () => { setTimeout(initLaporanStokTotalPage, 150); return renderLaporanStokTotalPage(); })
  .add('/users', adminGuard(renderUsersPage, initUsersPage))
  .setNotFound(() => placeholderPage('404', 'Halaman yang Anda tuju tidak ditemukan.'))
  .start();

function placeholderPage(title, description) {
  return `
    <div class="page-header">
      <p class="greeting">Dalam Pengembangan</p>
      <h1 class="page-title">${title}</h1>
      <p class="page-subtitle">${description}</p>
    </div>
    <div class="activity-card" style="text-align:center; padding: 40px 20px;">
      <div style="width:64px;height:64px;border-radius:var(--radius-lg);background:var(--color-primary-soft);color:var(--color-primary);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </div>
      <h3 style="font-size:16px;font-weight:700;margin-bottom:8px;">Segera Hadir</h3>
      <p style="font-size:13px;color:var(--text-secondary);max-width:320px;margin:0 auto;">
        UI untuk halaman ini sedang dalam tahap desain. Fokus saat ini adalah fondasi navigasi dan tema.
      </p>
    </div>
  `;
}

// === Welcome Popup — sapaan login + info update & maintenance ===
// Perbarui data di bawah ini untuk rilis / jadwal maintenance berikutnya.
const WHATS_NEW = [
  { color: '#16A34A', title: 'Mode Terang Baru', desc: 'Palet krem hangat yang lebih nyaman dibaca sepanjang hari.' },
  { color: '#DC2626', title: 'Tombol Logout Lebih Kontras', desc: 'Sekarang tampil solid merah — lebih mudah ditemukan, lebih sulit salah tekan.' },
  { color: '#0060AF', title: 'Perbaikan Menu Stok', desc: 'Sub-menu Stok tidak lagi tertutup sendiri saat dibuka di layar kecil.' },
  { color: '#F59E0B', title: 'Navigasi Multi-Tenant', desc: 'Pindah antar cabang tetap ringan langsung dari header.' }
];

const MAINTENANCE_INFO = [
  { title: 'Maintenance Terjadwal', desc: 'Minggu, 02.00–03.00 WIB — sebagian fitur mungkin tidak tersedia sementara.' },
  { title: 'Roadmap Berikutnya', desc: 'Laporan kasir cetak dan sinkronisasi stok antar cabang.' }
];

function showWelcomePopup() {
  const user = Auth.getCurrentUser();
  if (!user) return;

  // Muncul sekali per sesi login (key = waktu login)
  const seenKey = `klontonk:welcome:${user.loginTime || ''}`;
  try {
    if (sessionStorage.getItem(seenKey)) return;
  } catch (e) { /* storage tidak tersedia — popup tetap tampil */ }

  UI.welcome({
    name: user.name,
    tenantName: TenantStore.getCurrent().name,
    avatar: user.avatar || 'A',
    updates: WHATS_NEW,
    maintenance: MAINTENANCE_INFO
  }).then(() => {
    try { sessionStorage.setItem(seenKey, '1'); } catch (e) { /* abaikan */ }
  });
}

// === Halaman Informasi Akun ===
// Logout & versi aplikasi kini hanya di sheet akun (bukan di halaman ini).
function accountPage() {
  const user = Auth.getCurrentUser() || {};
  const tenant = TenantStore.getCurrent() || {};
  const roleLabel = user.role === 'admin' ? 'Admin' : 'Kasir';
  const loginAt = user.loginTime ? new Date(user.loginTime).toLocaleString('id-ID') : '-';
  return `
    <div class="page-header">
      <p class="greeting">Akun</p>
      <h1 class="page-title">Informasi Akun</h1>
      <p class="page-subtitle">Detail akun yang sedang login di perangkat ini.</p>
    </div>
    <div class="activity-card" style="padding: 24px;">
      <div class="account-head">
        <div class="avatar account-avatar">${UI._escape(user.avatar || 'A')}</div>
        <div>
          <p class="profile-name" style="font-size:18px;">${UI._escape(user.name || '-')}</p>
          <p class="profile-role">${UI._escape(roleLabel)} · @${UI._escape(user.username || '-')}</p>
        </div>
      </div>
      <div class="account-rows" style="margin-bottom:0;">
        <div class="account-row"><span>Role</span><span class="role-badge ${user.role === 'admin' ? 'role-admin' : 'role-cashier'}">${UI._escape(roleLabel)}</span></div>
        <div class="account-row"><span>Tenant</span><span>${UI._escape(tenant.name || '-')}</span></div>
        <div class="account-row" style="border-bottom:none;"><span>Login terakhir</span><span>${UI._escape(loginAt)}</span></div>
      </div>
    </div>
  `;
}

// === Halaman Pengaturan ===
function settingsPage() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const tenant = TenantStore.getCurrent() || {};
  return `
    <div class="page-header">
      <p class="greeting">Preferensi</p>
      <h1 class="page-title">Pengaturan</h1>
      <p class="page-subtitle">Sesuaikan tampilan aplikasi.</p>
    </div>
    <div class="activity-card" style="padding: 24px;">
      <h2 class="section-title" style="margin-bottom:12px;">Tema Tampilan</h2>
      <div class="theme-options">
        <button class="theme-option ${theme !== 'dark' ? 'active' : ''}" data-theme-pick="light">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
          Terang
        </button>
        <button class="theme-option ${theme === 'dark' ? 'active' : ''}" data-theme-pick="dark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          Gelap
        </button>
      </div>
      <div class="account-rows" style="margin-top:16px; margin-bottom:0;">
        <div class="account-row" style="border-bottom:none;"><span>Tenant aktif</span><span>${UI._escape(tenant.name || '-')}</span></div>
      </div>
    </div>
    <div class="activity-card" style="padding: 24px; margin-top: 16px;">
      <h2 class="section-title" style="margin-bottom:12px;">Aplikasi &amp; Cache</h2>
      <div class="account-rows" style="margin-bottom:16px;">
        <div class="account-row"><span>Koneksi</span><span>${isOnline() ? 'Online' : 'Offline'}</span></div>
        <div class="account-row"><span>Mode offline</span><span>${isOfflineReady() ? 'Siap' : 'Belum siap'}</span></div>
      </div>
      <p class="field-hint" style="margin-bottom:12px;">Hapus cache agar aplikasi tetap ringan. Data akun dan stok Anda tidak ikut terhapus.</p>
      <button type="button" class="btn btn-secondary btn-large" id="clearCacheBtn">Bersihkan Cache</button>
    </div>
  `;
}

function initSettingsPage() {
  const clearBtn = document.getElementById('clearCacheBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      // Tanpa koneksi, cache yang dihapus tidak bisa diisi ulang → aplikasi tak bisa dibuka lagi.
      if (!isOnline()) {
        UI.toast('Butuh koneksi internet untuk membersihkan cache.', { type: 'warning' });
        return;
      }
      const confirmed = await UI.modal({
        title: 'Bersihkan Cache',
        message: 'Cache aplikasi akan dihapus lalu diunduh ulang. Data akun dan stok tidak terhapus. Lanjutkan?',
        icon: 'warning',
        confirmText: 'Ya, Bersihkan',
        cancelText: 'Batal',
        variant: 'primary'
      });
      if (!confirmed) return;

      clearBtn.disabled = true;
      const result = await clearAppCache();
      if (result && result.ok) {
        UI.toast('Cache dibersihkan. Memuat ulang…', { type: 'success' });
        setTimeout(() => window.location.reload(), 800);
      } else {
        clearBtn.disabled = false;
        UI.toast('Gagal membersihkan cache. Coba lagi.', { type: 'danger' });
      }
    });
  }

  document.querySelectorAll('[data-theme-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pick = btn.dataset.themePick;
      ThemeManager.apply(pick);
      try { localStorage.setItem('klontonk:theme', pick); } catch (e) { /* abaikan */ }
      document.querySelectorAll('[data-theme-pick]').forEach(b => b.classList.toggle('active', b.dataset.themePick === pick));
    });
  });
}

setTimeout(showWelcomePopup, 350);

} catch (err) {
  // Jangan biarkan satu error mematikan seluruh app (beranda kosong + nav mati).
  // Tampilkan pesan yang jelas agar mudah didiagnosis.
  console.error('[App] Gagal inisialisasi aplikasi:', err);
  const main = document.getElementById('appMain');
  if (main) {
    main.innerHTML = `
      <div class="page-header">
        <p class="greeting">Terjadi Kesalahan</p>
        <h1 class="page-title">Gagal Memuat</h1>
        <p class="page-subtitle">${String(err && err.message || err).replace(/[<>&"]/g, '')}</p>
      </div>
      <div class="activity-card" style="text-align:center; padding: 40px 20px;">
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          Coba muat ulang halaman. Jika berlanjut, buka Console (F12) untuk detail.
        </p>
        <button class="btn btn-primary" id="errReloadBtn">Muat Ulang</button>
      </div>
    `;
    // CSP: JANGAN pakai inline onclick — pasang listener setelah render
    const reloadBtn = document.getElementById('errReloadBtn');
    if (reloadBtn) reloadBtn.addEventListener('click', () => window.location.reload());
  }
}

} // end initAuthenticatedApp