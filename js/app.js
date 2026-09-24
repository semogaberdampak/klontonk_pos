import { ThemeManager } from './theme.js';
import { TenantStore } from './tenant.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { StockStore } from './stock.js';
import { SalesStore } from './sales.js';
import { ReturnStore } from './returns.js';
import { renderLogin, initLoginPage } from './pages/login.js';
import { registerServiceWorker, watchConnectivity } from './pwa.js';
import { setupShell } from './shell.js';
import { startRouter } from './routes.js';
import { showWelcomePopup } from './welcome.js';

// ============ TITIK MASUK APLIKASI ============
// Urutan: sistem inti → PWA → cek login → (bila login) muat data dari database → pasang cangkang & rute.

ThemeManager.init();
TenantStore.init();

// PWA: service worker + pantau koneksi (aktif juga di halaman login)
registerServiceWorker();
watchConnectivity();

// Gagal menyimpan stok/harga ke database (server mati, offline, atau ditolak)
StockStore.onSaveError((message) => UI.toast(message, { type: 'danger', duration: 9000 }));

// Sesi login habis / tidak berlaku lagi → keluar dan kembali ke halaman login.
function forceRelogin() {
  Auth.logout();
  window.location.reload();
}

// Jangan biarkan satu error inisialisasi mematikan seluruh app (beranda kosong + nav mati):
// tampilkan pesan yang jelas agar mudah didiagnosis.
function showInitError(err) {
  console.error('[App] Gagal inisialisasi aplikasi:', err);
  const main = document.getElementById('appMain');
  if (!main) return;
  main.innerHTML = `
    <div class="page-header">
      <p class="greeting">Terjadi Kesalahan</p>
      <h1 class="page-title">Gagal Memuat</h1>
      <p class="page-subtitle">${UI._escape(String((err && err.message) || err))}</p>
    </div>
    <div class="activity-card" style="text-align:center; padding: 40px 20px;">
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
        Coba muat ulang halaman. Jika berlanjut, buka Console (F12) untuk detail.
      </p>
      <button class="btn btn-primary" id="errReloadBtn">Muat Ulang</button>
    </div>
  `;
  // CSP: JANGAN pakai inline onclick — pasang listener setelah render
  document.getElementById('errReloadBtn')?.addEventListener('click', () => window.location.reload());
}

function startAuthenticatedApp() {
  try {
    // Tenant aktif = tenant milik user yang login
    const user = Auth.getCurrentUser();
    if (user) TenantStore.setCurrent(user.tenant);

    setupShell();
    startRouter();
    setTimeout(showWelcomePopup, 350);
  } catch (err) {
    showInitError(err);
  }
}

// Daftar tenant dimuat dulu (stok/penjualan/retur dikelompokkan per tenant memakainya), lalu ketiganya paralel.
// Mengembalikan false bila sesi tidak berlaku (harus login ulang).
async function loadData() {
  const tenants = await TenantStore.load();
  if (tenants.expired) return false;

  const [stock, sales, returns] = await Promise.all([StockStore.load(), SalesStore.load(), ReturnStore.load()]);
  if (stock.expired || sales.expired || returns.expired) return false;

  const failed = [tenants, stock, sales, returns].find((result) => !result.success);
  if (failed) UI.toast(`Data belum bisa dimuat: ${failed.error}`, { type: 'danger', duration: 9000 });
  return true;
}

// WAJIB menunggu inisialisasi auth selesai (verifikasi sesi bersifat async). Tanpa await ini, status login
// dibaca terlalu dini dan user yang sudah login selalu "dilempar kembali" ke halaman login.
await Auth.ready;

if (!Auth.isAuthenticated()) {
  document.getElementById('app').style.display = 'none';
  document.body.insertAdjacentHTML('beforeend', `<div id="loginRoot">${renderLogin()}</div>`);
  initLoginPage();
} else if (await loadData()) {
  startAuthenticatedApp();
} else {
  forceRelogin();
}
