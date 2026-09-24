import { Auth } from '../auth.js';
import { TenantStore } from '../tenant.js';
import { ThemeManager } from '../theme.js';
import { UI } from '../ui.js';
import { esc, escAttr, formatRupiah } from '../format.js';
import { SalesStore } from '../sales.js';
import { autoPrint } from '../receipt.js';
import { isOnline, isOfflineReady, clearAppCache } from '../pwa.js';

// ============ HALAMAN INFORMASI AKUN & PENGATURAN ============
// Logout & versi aplikasi ada di sheet akun (js/shell.js), bukan di halaman ini.

export function renderAkunPage() {
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
        <div class="avatar account-avatar">${esc(user.avatar || 'A')}</div>
        <div>
          <p class="profile-name" style="font-size:18px;">${esc(user.name || '-')}</p>
          <p class="profile-role">${esc(roleLabel)} · @${esc(user.username || '-')}</p>
        </div>
      </div>
      <div class="account-rows" style="margin-bottom:0;">
        <div class="account-row"><span>Role</span><span class="role-badge ${user.role === 'admin' ? 'role-admin' : 'role-cashier'}">${esc(roleLabel)}</span></div>
        <div class="account-row"><span>Tenant</span><span>${esc(tenant.name || '-')}</span></div>
        <div class="account-row" style="border-bottom:none;"><span>Login terakhir</span><span>${esc(loginAt)}</span></div>
      </div>
    </div>
  `;
}

// Kartu antrean penjualan offline: yang menunggu dikirim, dan yang ditolak database (perlu keputusan kasir).
function offlineQueueHtml({ pending, failed, entries }) {
  const failedRows = entries.filter((entry) => entry.status === 'failed').map((entry) => {
    const total = formatRupiah(entry.expectedTotal);
    const when = new Date(entry.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <li class="offline-fail">
        <p class="offline-fail-title">${esc(total)} · ${esc(when)}</p>
        <p class="field-hint">${esc(entry.error || 'Ditolak database.')}</p>
        <div class="offline-fail-actions">
          <button type="button" class="btn btn-secondary" data-retry="${escAttr(entry.clientId)}">Coba lagi</button>
          <button type="button" class="btn btn-secondary" data-discard="${escAttr(entry.clientId)}">Buang</button>
        </div>
      </li>`;
  }).join('');

  return `
    <h2 class="section-title" style="margin-bottom:12px;">Penjualan Offline</h2>
    <div class="account-rows" style="margin-bottom:16px;">
      <div class="account-row"><span>Menunggu dikirim</span><span>${pending}</span></div>
      <div class="account-row" style="border-bottom:none;"><span>Ditolak database</span><span>${failed}</span></div>
    </div>
    ${pending ? '<button type="button" class="btn btn-secondary btn-large" id="flushNowBtn" style="margin-bottom:12px;">Kirim Sekarang</button>' : ''}
    ${failedRows ? `<ul class="offline-fail-list">${failedRows}</ul>` : ''}
    <p class="field-hint">Penjualan yang dibuat saat offline tersimpan di perangkat ini sampai terkirim. Jangan hapus data situs atau cache browser sebelum semuanya terkirim.</p>`;
}

export function renderPengaturanPage() {
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
        <div class="account-row" style="border-bottom:none;"><span>Tenant aktif</span><span>${esc(tenant.name || '-')}</span></div>
      </div>
    </div>
    <div class="activity-card" style="padding: 24px; margin-top: 16px;">
      <h2 class="section-title" style="margin-bottom:12px;">Catatan Kasir</h2>
      <p class="field-hint" style="margin-bottom:12px;">Catatan singkat untuk serah terima shift. Tersimpan di perangkat ini.</p>
      <button type="button" class="btn btn-secondary btn-large" data-navigate="#/catatan">Buka Catatan</button>
    </div>
    <div class="activity-card" style="padding: 24px; margin-top: 16px;">
      <h2 class="section-title" style="margin-bottom:12px;">Struk</h2>
      <div class="account-rows" style="margin-bottom:12px;">
        <div class="account-row" style="border-bottom:none;">
          <span>Cetak otomatis setelah bayar</span>
          <button type="button" class="btn btn-secondary" id="autoPrintBtn" aria-pressed="${autoPrint && autoPrint.isOn()}">${autoPrint && autoPrint.isOn() ? 'Nyala' : 'Mati'}</button>
        </div>
      </div>
      <p class="field-hint">Struk dicetak lewat dialog cetak browser, lebar kertas 58 mm. Pilih printer thermal yang terpasang, atau "Simpan sebagai PDF".</p>
    </div>
    <div class="activity-card" style="padding: 24px; margin-top: 16px;" id="offlineQueueCard">
      ${offlineQueueHtml(SalesStore.outboxState())}
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

function initOfflineQueueCard() {
  const card = document.getElementById('offlineQueueCard');
  if (!card) return;

  // Halaman ini tidak punya siklus pembersihan: berhenti mendengarkan begitu kartunya tak lagi ada di layar.
  const unsubscribe = SalesStore.onOutboxChange((state) => {
    if (!card.isConnected) return unsubscribe();
    card.innerHTML = offlineQueueHtml(state);
  });

  card.addEventListener('click', async (event) => {
    const flushBtn = event.target.closest('#flushNowBtn');
    const retryBtn = event.target.closest('[data-retry]');
    const discardBtn = event.target.closest('[data-discard]');

    if (flushBtn) {
      if (!isOnline()) return UI.toast('Belum ada koneksi internet.', { type: 'warning' });
      flushBtn.disabled = true;
      const summary = await SalesStore.flush();
      if (summary.remaining) UI.toast(`${summary.remaining} penjualan masih menunggu. Coba lagi sebentar.`, { type: 'warning' });
      return;
    }

    if (retryBtn) {
      retryBtn.disabled = true;
      await SalesStore.retry(retryBtn.dataset.retry);
      return;
    }

    if (discardBtn) {
      const confirmed = await UI.modal({
        title: 'Buang Penjualan Offline',
        message: 'Penjualan ini TIDAK akan tercatat di database dan stok tidak berkurang. Pastikan barangnya memang tidak jadi dijual. Lanjutkan?',
        icon: 'danger',
        confirmText: 'Ya, Buang',
        cancelText: 'Batal',
        variant: 'danger'
      });
      if (confirmed) await SalesStore.discard(discardBtn.dataset.discard);
    }
  });
}

function initAutoPrintToggle() {
  const button = document.getElementById('autoPrintBtn');
  if (!button || !autoPrint) return;
  button.addEventListener('click', () => {
    const next = !autoPrint.isOn();
    autoPrint.set(next);
    button.textContent = next ? 'Nyala' : 'Mati';
    button.setAttribute('aria-pressed', String(next));
  });
}

export function initPengaturanPage() {
  initAutoPrintToggle();
  initOfflineQueueCard();
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
