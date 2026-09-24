import { Auth } from './auth.js';
import { TenantStore } from './tenant.js';
import { UI } from './ui.js';
import { SHEET_ICONS } from './icons.js';
import { APP_VERSION } from './config.js';
import { checkDbStatus, describeDb } from './db-status.js';

// ============ CANGKANG APLIKASI (navigasi & menu) ============
// Bottom navigation + sheet sub-menu (Stok, Laporan, Lainnya), sheet akun (burger), chip tenant,
// dan navigasi kartu cepat. Dipasang sekali setelah login lewat setupShell().

const navigate = (path) => { window.location.hash = path; };

const STOK_MENU = [
  { id: '/stok/awal', label: 'Stok Awal', desc: 'Input & lihat stok awal periode' },
  { id: '/stok/keluar-laku', label: 'Stok Keluar (Laku)', desc: 'Stok keluar akibat penjualan' },
  { id: '/stok/retur', label: 'Stok Retur', desc: 'Retur pelanggan & barang rusak' },
  { id: '/stok/total', label: 'Stok Total', desc: 'Sisa stok terakhir setelah transaksi' }
];

const LAPORAN_MENU = [
  { id: '/laporan/stok-awal', label: 'Stok Awal', desc: 'Laporan stok awal periode' },
  { id: '/laporan/stok-keluar', label: 'Stok Keluar (Laku)', desc: 'Laporan stok keluar akibat penjualan' },
  { id: '/laporan/stok-retur', label: 'Stok Retur', desc: 'Laporan retur pelanggan & barang rusak' },
  { id: '/laporan/stok-total', label: 'Stok Total', desc: 'Laporan sisa stok terkini' }
];

// Tab → sheet sub-menu; memilih satu item berpindah ke rutenya.
function bindSheetTab(bottomNav, tab, title, items) {
  const button = bottomNav.querySelector(`[data-tab="${tab}"]`);
  if (!button) return;
  button.addEventListener('click', async () => {
    const sel = await UI.sheet({ title, items: items.map((item) => ({ ...item, icon: SHEET_ICONS.box })) });
    if (sel) navigate(sel.id);
  });
}

function setupBottomNav() {
  const bottomNav = document.getElementById('bottomNav');
  if (!bottomNav) return;

  // Tab langsung: Beranda, Transaksi
  bottomNav.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  bindSheetTab(bottomNav, 'stok', 'Menu Stok', STOK_MENU);
  bindSheetTab(bottomNav, 'laporan', 'Menu Laporan', LAPORAN_MENU);

  // Tab Lainnya → menu sekunder (Tambah User hanya admin)
  const lainnyaTab = bottomNav.querySelector('[data-tab="lainnya"]');
  if (lainnyaTab) lainnyaTab.addEventListener('click', async () => {
    const items = [
      { id: '/harga', label: 'Update Harga', desc: 'Atur harga jual per barang', icon: SHEET_ICONS.dollar },
      { id: '/info-update', label: 'Info Update', desc: 'Perubahan terbaru & maintenance', icon: SHEET_ICONS.info }
    ];
    if (Auth.isAdmin()) {
      items.push({ id: '/users', label: 'Tambah User', desc: 'Kelola akun admin & kasir', icon: SHEET_ICONS.userPlus });
    }
    const sel = await UI.sheet({ title: 'Lainnya', items });
    if (sel) navigate(sel.id);
  });
}

// Logout (konfirmasi) — dipakai sheet akun.
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
      setTimeout(() => { window.location.reload(); }, 300);
    }
  });
}

// Tombol akun (burger) → sheet akun. Status koneksi dicek di latar belakang; sheet langsung tampil "Memeriksa…".
function setupAccountSheet() {
  const accountBtn = document.getElementById('accountBtn');
  if (!accountBtn) return;

  accountBtn.addEventListener('click', async () => {
    const user = Auth.getCurrentUser();
    if (!user) return;
    const tenant = TenantStore.getCurrent();
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
      const { tone, text } = describeDb(dbStatus || { state: 'unreachable' });
      UI.toast('Database: ' + text, { type: tone === 'ok' ? 'success' : 'warning' });
    } else if (sel.id === 'akun') navigate('/akun');
    else if (sel.id === 'pengaturan') navigate('/pengaturan');
    else if (sel.id === 'versi') UI.toast('Klontonk POS v' + APP_VERSION, { type: 'info' });
    else if (sel.id === 'logout') confirmLogout();
  });
}

// Chip tenant di header (hanya tampilan). GUARD: elemen ini hanya ada di header.
function setupTenantChip() {
  const tenantNameEl = document.getElementById('tenantName');
  const update = (tenant) => { if (tenantNameEl) tenantNameEl.textContent = tenant.name; };
  TenantStore.subscribe(update);
  update(TenantStore.getCurrent());
}

// Kartu cepat di halaman mana pun: [data-navigate="#/rute"].
function setupQuickCards() {
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-navigate]');
    if (card) window.location.hash = card.dataset.navigate.slice(1);
  });
}

export function setupShell() {
  setupBottomNav();
  setupAccountSheet();
  setupTenantChip();
  setupQuickCards();
}
