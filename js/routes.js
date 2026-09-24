import { Router } from './router.js';
import { Auth } from './auth.js';
import { renderHome } from './pages/home.js';
import { renderUsersPage, initUsersPage } from './pages/users.js';
import { renderStokAwalPage, initStokAwalPage } from './pages/stok-awal.js';
import { renderHargaPage, initHargaPage } from './pages/update-harga.js';
import { renderTransaksiPage, initTransaksiPage } from './pages/transaksi.js';
import { renderStokKeluarPage, initStokKeluarPage } from './pages/stok-keluar.js';
import { renderStokTotalPage, initStokTotalPage } from './pages/stok-total.js';
import { renderStokReturPage, initStokReturPage } from './pages/stok-retur.js';
import { renderInfoUpdatePage, initInfoUpdatePage } from './pages/info-update.js';
import { renderCatatanPage, initCatatanPage } from './pages/catatan.js';
import { renderAkunPage, renderPengaturanPage, initPengaturanPage } from './pages/akun.js';
import {
  renderLaporanStokAwalPage, initLaporanStokAwalPage,
  renderLaporanStokKeluarPage, initLaporanStokKeluarPage,
  renderLaporanStokReturPage, initLaporanStokReturPage,
  renderLaporanStokTotalPage, initLaporanStokTotalPage
} from './pages/laporan.js';

// ============ TABEL RUTE ============
// Halaman dirender sinkron; init dijalankan setelah DOM terpasang (setTimeout, seperti sebelumnya).
const INIT_DELAY_MS = 150;

const page = (render, init) => () => {
  if (init) setTimeout(init, INIT_DELAY_MS);
  return render();
};

// Guard: halaman admin ditolak untuk non-admin (dicek ulang tiap route diakses).
const adminOnly = (render, init) => () => (Auth.isAdmin() ? page(render, init)() : forbiddenPage());

// Halaman input stok / harga: hanya akun tenant. Admin hanya membaca stok (dashboard admin terpisah).
const TENANT_ONLY_TEXT = {
  subtitle: 'Stok tenant hanya bisa diinput oleh tenant itu sendiri.',
  title: 'Khusus Akun Tenant',
  hint: 'Akun admin hanya dapat melihat stok. Masuk dengan akun tenant untuk mengubahnya.'
};
const tenantOnly = (render, init) => () => (Auth.canEditStock() ? page(render, init)() : forbiddenPage(TENANT_ONLY_TEXT));

function forbiddenPage({
  subtitle = 'Halaman ini hanya dapat diakses oleh Admin.',
  title = 'Butuh Hak Akses Admin',
  hint = 'Jika Anda merasa ini keliru, hubungi admin pusat Anda.'
} = {}) {
  return `
    <div class="page-header">
      <p class="greeting">Akses Ditolak</p>
      <h1 class="page-title">403</h1>
      <p class="page-subtitle">${subtitle}</p>
    </div>
    <div class="activity-card" style="text-align:center; padding: 40px 20px;">
      <div style="width:64px;height:64px;border-radius:var(--radius-lg);background:rgba(220,38,38,0.12);color:var(--color-danger);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
        </svg>
      </div>
      <h3 style="font-size:16px;font-weight:700;margin-bottom:8px;">${title}</h3>
      <p style="font-size:13px;color:var(--text-secondary);max-width:320px;margin:0 auto;">
        ${hint}
      </p>
    </div>
  `;
}

function notFoundPage() {
  return `
    <div class="page-header">
      <p class="greeting">Tidak Ditemukan</p>
      <h1 class="page-title">404</h1>
      <p class="page-subtitle">Halaman yang Anda tuju tidak ditemukan.</p>
    </div>
    <div class="activity-card" style="text-align:center; padding: 40px 20px;">
      <p style="font-size:13px;color:var(--text-secondary);max-width:320px;margin:0 auto 16px;">
        Alamat halaman mungkin salah atau halaman sudah dipindahkan.
      </p>
      <button type="button" class="btn btn-primary" data-navigate="#/beranda">Kembali ke Beranda</button>
    </div>
  `;
}

export function startRouter() {
  new Router()
    .add('/beranda', renderHome)
    .add('/kasir', page(renderTransaksiPage, initTransaksiPage))
    .add('/akun', renderAkunPage)
    .add('/pengaturan', page(renderPengaturanPage, initPengaturanPage))
    .add('/stok/awal', tenantOnly(renderStokAwalPage, initStokAwalPage))
    .add('/stok/keluar-laku', page(renderStokKeluarPage, initStokKeluarPage))
    .add('/stok/retur', page(renderStokReturPage, initStokReturPage))
    .add('/stok/total', page(renderStokTotalPage, initStokTotalPage))
    .add('/info-update', page(renderInfoUpdatePage, initInfoUpdatePage))
    .add('/catatan', page(renderCatatanPage, initCatatanPage))
    .add('/harga', tenantOnly(renderHargaPage, initHargaPage))
    .add('/laporan/stok-awal', page(renderLaporanStokAwalPage, initLaporanStokAwalPage))
    .add('/laporan/stok-keluar', page(renderLaporanStokKeluarPage, initLaporanStokKeluarPage))
    .add('/laporan/stok-retur', page(renderLaporanStokReturPage, initLaporanStokReturPage))
    .add('/laporan/stok-total', page(renderLaporanStokTotalPage, initLaporanStokTotalPage))
    .add('/users', adminOnly(renderUsersPage, initUsersPage))
    .setNotFound(notFoundPage)
    .start();
}
