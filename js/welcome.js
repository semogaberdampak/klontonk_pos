import { Auth } from './auth.js';
import { TenantStore } from './tenant.js';
import { UI } from './ui.js';
import { UpdateStore } from './updates.js';

// ============ Welcome Popup — sapaan login + info update & maintenance ============
// Isi popup diambil dari UpdateStore (tabel app_updates; diubah admin lewat menu Info Update).

const toPopupItem = (row) => ({ ...row, desc: row.description });

export async function showWelcomePopup() {
  const user = Auth.getCurrentUser();
  if (!user) return;

  // Muncul sekali per sesi login (key = waktu login)
  const seenKey = `klontonk:welcome:${user.loginTime || ''}`;
  try {
    if (sessionStorage.getItem(seenKey)) return;
  } catch (e) { /* storage tidak tersedia — popup tetap tampil */ }

  await UpdateStore.load(); // gagal → tetap pakai isi terakhir / bawaan

  UI.welcome({
    name: user.name,
    tenantName: TenantStore.getCurrent().name,
    avatar: user.avatar || 'A',
    updates: UpdateStore.list('update').map(toPopupItem),
    maintenance: UpdateStore.list('maintenance').map(toPopupItem)
  }).then(() => {
    try { sessionStorage.setItem(seenKey, '1'); } catch (e) { /* abaikan */ }
  });
}
