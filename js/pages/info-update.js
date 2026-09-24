import { esc, escAttr } from '../format.js';
import { APP_VERSION } from '../config.js';
import { Auth } from '../auth.js';
import { UI } from '../ui.js';
import { UpdateStore, UPDATE_KINDS, UPDATE_COLORS } from '../updates.js';

// ============ HALAMAN INFO UPDATE ============
// Semua user melihat daftar; Admin juga bisa menambah / mengubah / menghapus (tersimpan di Supabase).

const ICON_EDIT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';
const ICON_TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

let editingId = null;

function rowHtml(row, isAdmin) {
  const actions = isAdmin ? `
    <div class="stok-actions">
      <button type="button" class="icon-action" data-edit="${escAttr(row.id)}" aria-label="Edit ${escAttr(row.title)}">${ICON_EDIT}</button>
      <button type="button" class="icon-action danger" data-delete="${escAttr(row.id)}" aria-label="Hapus ${escAttr(row.title)}">${ICON_TRASH}</button>
    </div>` : '';
  return `
    <li class="welcome-update-item${String(row.id) === String(editingId) ? ' is-editing' : ''}">
      <span class="welcome-update-dot" style="background:${escAttr(row.color)}"></span>
      <div style="flex:1;min-width:0;">
        <p class="welcome-update-title">${esc(row.title)}</p>
        ${row.description ? `<p class="welcome-update-desc">${esc(row.description)}</p>` : ''}
      </div>
      ${actions}
    </li>`;
}

function sectionHtml(kind, isAdmin) {
  const rows = UpdateStore.list(kind);
  const body = rows.length ? rows.map((row) => rowHtml(row, isAdmin)).join('') : '<li class="stok-empty">Belum ada data.</li>';
  return `
    <section class="activity-card" style="padding: 24px; margin-bottom: 16px;" aria-label="${escAttr(UPDATE_KINDS[kind])}">
      <h2 class="section-title" style="margin-bottom:12px;">${esc(UPDATE_KINDS[kind])}</h2>
      <ul class="welcome-updates" id="updList-${kind}">${body}</ul>
    </section>`;
}

const formHtml = () => `
  <section class="activity-card" id="updFormCard" style="padding: 24px;" aria-label="Form info update">
    <h2 class="section-title" id="updFormTitle" style="margin-bottom:16px;">Tambah Info</h2>
    <form id="updForm" autocomplete="off" novalidate>
      <div class="stok-fields">
        <div class="form-group">
          <label for="updKind" class="form-label">Jenis</label>
          <select id="updKind" class="form-input">
            ${Object.entries(UPDATE_KINDS).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="updColor" class="form-label">Warna</label>
          <select id="updColor" class="form-input">
            ${UPDATE_COLORS.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label for="updTitle" class="form-label">Judul</label>
        <input type="text" id="updTitle" class="form-input" placeholder="cth: Mode Terang Baru" maxlength="80" required />
      </div>
      <div class="form-group">
        <label for="updDesc" class="form-label">Deskripsi <span class="field-optional">(opsional)</span></label>
        <textarea id="updDesc" class="form-input" rows="3" maxlength="300" placeholder="Penjelasan singkat"></textarea>
      </div>
      <p class="form-error" id="updError" role="alert" hidden></p>
      <div class="stok-form-actions">
        <button type="submit" class="btn btn-primary" id="updSubmit">Simpan</button>
        <button type="button" class="btn btn-secondary" id="updCancel" hidden>Batal</button>
      </div>
    </form>
  </section>`;

export function renderInfoUpdatePage() {
  const isAdmin = Auth.isAdmin();
  return `
    <div class="page-header">
      <p class="greeting">Versi ${esc(APP_VERSION)}</p>
      <h1 class="page-title">Info Update</h1>
      <p class="page-subtitle">${isAdmin ? 'Ubah info yang tampil di popup sapaan dan halaman ini.' : 'Perubahan terbaru pada aplikasi dan jadwal maintenance.'}</p>
    </div>
    <div id="updLists">${Object.keys(UPDATE_KINDS).map((kind) => sectionHtml(kind, isAdmin)).join('')}</div>
    ${isAdmin ? formHtml() : ''}
  `;
}

// Dipanggil router setelah HTML dirender
export async function initInfoUpdatePage() {
  const isAdmin = Auth.isAdmin();
  const listsEl = document.getElementById('updLists');
  if (!listsEl) return;
  editingId = null;

  const renderLists = () => {
    listsEl.innerHTML = Object.keys(UPDATE_KINDS).map((kind) => sectionHtml(kind, isAdmin)).join('');
  };

  // Ambil versi terbaru dari database (gagal → tampilkan yang ada)
  const loaded = await UpdateStore.load();
  if (!document.getElementById('updLists')) return; // sudah pindah halaman
  renderLists();
  if (!loaded.success) UI.toast(`Info update belum bisa dimuat: ${loaded.error}`, { type: 'warning', duration: 6000 });
  if (!isAdmin) return;

  const form = document.getElementById('updForm');
  const $ = (id) => document.getElementById(id);
  const errorEl = $('updError');
  const showError = (message) => { errorEl.textContent = message; errorEl.hidden = !message; };
  const findRow = (id) => ['update', 'maintenance'].flatMap((k) => UpdateStore.list(k)).find((r) => String(r.id) === String(id));

  const setMode = (row) => {
    editingId = row ? row.id : null;
    $('updFormTitle').textContent = row ? 'Edit Info' : 'Tambah Info';
    $('updSubmit').textContent = row ? 'Simpan Perubahan' : 'Simpan';
    $('updCancel').hidden = !row;
    $('updKind').value = row ? row.kind : 'update';
    $('updColor').value = row ? row.color : UPDATE_COLORS[0].value;
    $('updTitle').value = row ? row.title : '';
    $('updDesc').value = row ? row.description : '';
    showError('');
    renderLists();
  };

  $('updCancel').addEventListener('click', () => setMode(null));

  listsEl.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const deleteBtn = e.target.closest('[data-delete]');
    if (editBtn) {
      const row = findRow(editBtn.dataset.edit);
      if (!row) return;
      setMode(row);
      $('updFormCard').scrollIntoView({ block: 'center' });
      $('updTitle').focus({ preventScroll: true });
    } else if (deleteBtn) {
      const row = findRow(deleteBtn.dataset.delete);
      if (!row) return;
      const confirmed = await UI.modal({
        title: 'Hapus Info',
        message: `Hapus "${row.title}"?`,
        icon: 'warning',
        confirmText: 'Ya, Hapus',
        cancelText: 'Batal',
        variant: 'danger'
      });
      if (!confirmed) return;
      const result = await UpdateStore.remove(row.id);
      if (!result.success) { UI.toast(result.error, { type: 'danger' }); return; }
      if (String(editingId) === String(row.id)) setMode(null); else renderLists();
      UI.toast('Info dihapus', { type: 'success' });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = { kind: $('updKind').value, color: $('updColor').value, title: $('updTitle').value, description: $('updDesc').value };
    const button = $('updSubmit');
    button.disabled = true;
    const result = editingId === null ? await UpdateStore.add(input) : await UpdateStore.update(editingId, input);
    button.disabled = false;
    if (!result.success) { showError(result.error); return; }
    UI.toast(editingId === null ? 'Info ditambahkan' : 'Perubahan disimpan', { type: 'success' });
    setMode(null);
  });
}
