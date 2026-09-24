import { StockStore, UNITS } from '../stock.js';
import { TenantStore } from '../tenant.js';
import { UI } from '../ui.js';
import { scanBarcode } from '../scanner.js';
import { esc, escAttr, formatQty } from '../format.js';

// ============ HALAMAN STOK AWAL ============
// Semua output dinamis di-escape. Validasi sebenarnya ada di StockStore.


const ICON_EDIT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';
const ICON_TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

const ICON_SCAN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><line x1="7" y1="8" x2="7" y2="16"></line><line x1="11" y1="8" x2="11" y2="16"></line><line x1="15" y1="8" x2="15" y2="16"></line><line x1="17.5" y1="8" x2="17.5" y2="16"></line></svg>';

let editingId = null;

function rowHtml(item) {
  const id = escAttr(item.id);
  const name = escAttr(item.name);
  const barcodeLine = item.barcode ? ` · <span class="stok-barcode">${esc(item.barcode)}</span>` : '';
  return `
    <li class="stok-row${item.id === editingId ? ' is-editing' : ''}">
      <div class="stok-meta">
        <p class="stok-name">${esc(item.name)}</p>
        <p class="stok-sub">Satuan: ${esc(item.unit)}${barcodeLine}</p>
      </div>
      <p class="stok-qty"><strong>${esc(formatQty(item.qty))}</strong> ${esc(item.unit)}</p>
      <div class="stok-actions">
        <button type="button" class="icon-action" data-edit="${id}" aria-label="Edit ${name}">${ICON_EDIT}</button>
        <button type="button" class="icon-action danger" data-delete="${id}" aria-label="Hapus ${name}">${ICON_TRASH}</button>
      </div>
    </li>`;
}

function listHtml(items) {
  if (!items.length) {
    return '<li class="stok-empty">Belum ada stok. Klik "Tambah Stok" untuk menambah barang.</li>';
  }
  return items.map(rowHtml).join('');
}

export function renderStokAwalPage() {
  const items = StockStore.list();
  const tenant = TenantStore.getCurrent();

  return `
    <div class="page-header">
      <p class="greeting">Stok · ${esc(tenant.name)}</p>
      <h1 class="page-title">Stok Awal</h1>
      <p class="page-subtitle">Kelola daftar barang dan jumlah stok awal periode untuk tenant ini.</p>
    </div>

    <div class="stok-layout">
      <section class="activity-card" aria-label="Daftar stok awal">
        <div class="stok-head">
          <h2 class="section-title">Daftar Barang <span class="stok-count" id="stokCount">${items.length} barang</span></h2>
          <button type="button" class="btn btn-primary stok-add-btn" id="stokAddBtn">+ Tambah Stok</button>
        </div>
        <ul class="stok-list" id="stokList">${listHtml(items)}</ul>
      </section>

      <section class="activity-card" id="stokFormCard" aria-label="Form stok">
        <h2 class="section-title" id="stokFormTitle" style="margin-bottom:16px;">Tambah Stok</h2>
        <form id="stokForm" autocomplete="off" novalidate>
          <div class="form-group">
            <label for="stokBarcode" class="form-label">Barcode <span class="field-optional">(opsional)</span></label>
            <div class="barcode-field">
              <input type="text" id="stokBarcode" class="form-input" placeholder="Scan atau ketik barcode" maxlength="40" autocapitalize="off" spellcheck="false" />
              <button type="button" class="btn btn-secondary" id="stokScanBtn" aria-label="Scan barcode dengan kamera">${ICON_SCAN}<span>Scan</span></button>
            </div>
          </div>

          <div class="form-group">
            <label for="stokName" class="form-label">Nama Barang</label>
            <input type="text" id="stokName" class="form-input" placeholder="cth: Beras Lahap" maxlength="60" required />
          </div>

          <div class="stok-fields">
            <div class="form-group">
              <label for="stokQty" class="form-label">Jumlah Stok</label>
              <input type="number" id="stokQty" class="form-input" placeholder="0" min="0" max="1000000" step="1" inputmode="numeric" required />
            </div>
            <div class="form-group">
              <label for="stokUnit" class="form-label">Satuan</label>
              <select id="stokUnit" class="form-input" required>
                ${UNITS.map(u => `<option value="${escAttr(u)}">${esc(u)}</option>`).join('')}
              </select>
            </div>
          </div>

          <p class="form-error" id="stokError" role="alert" hidden></p>

          <div class="stok-form-actions">
            <button type="submit" class="btn btn-primary" id="stokSubmit">Simpan</button>
            <button type="button" class="btn btn-secondary" id="stokCancel" hidden>Batal</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

// Dipanggil router setelah HTML dirender
export function initStokAwalPage() {
  const form = document.getElementById('stokForm');
  if (!form) return;

  editingId = null;

  const listEl = document.getElementById('stokList');
  const countEl = document.getElementById('stokCount');
  const titleEl = document.getElementById('stokFormTitle');
  const errorEl = document.getElementById('stokError');
  const submitBtn = document.getElementById('stokSubmit');
  const cancelBtn = document.getElementById('stokCancel');
  const barcodeInput = document.getElementById('stokBarcode');
  const scanBtn = document.getElementById('stokScanBtn');
  const nameInput = document.getElementById('stokName');
  const qtyInput = document.getElementById('stokQty');
  const unitSelect = document.getElementById('stokUnit');

  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  };

  const refreshList = () => {
    const items = StockStore.list();
    listEl.innerHTML = listHtml(items);
    countEl.textContent = `${items.length} barang`;
  };

  // item = null → mode tambah; item = objek → mode edit
  const setMode = (item) => {
    editingId = item ? item.id : null;
    titleEl.textContent = item ? 'Edit Stok' : 'Tambah Stok';
    submitBtn.textContent = item ? 'Simpan Perubahan' : 'Simpan';
    cancelBtn.hidden = !item;
    barcodeInput.value = item ? (item.barcode || '') : '';
    nameInput.value = item ? item.name : '';
    qtyInput.value = item ? String(item.qty) : '';
    unitSelect.value = item ? item.unit : UNITS[0];
    showError('');
    refreshList();
  };

  const focusForm = () => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('stokFormCard').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    nameInput.focus({ preventScroll: true });
  };

  document.getElementById('stokAddBtn').addEventListener('click', () => {
    setMode(null);
    focusForm();
  });

  cancelBtn.addEventListener('click', () => setMode(null));

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    const result = await scanBarcode();
    scanBtn.disabled = false;

    if (result.error) {
      UI.toast(result.error, { type: 'danger', duration: 6000 });
      return;
    }
    if (!result.code) return; // dibatalkan

    barcodeInput.value = result.code;
    showError('');

    const owner = StockStore.findByBarcode(result.code);
    if (owner && owner.id !== editingId) {
      UI.toast(`Barcode ini sudah dipakai: ${owner.name}`, { type: 'warning', duration: 5000 });
    } else {
      UI.toast(`Barcode terbaca: ${result.code}`, { type: 'success' });
    }
    (nameInput.value ? qtyInput : nameInput).focus({ preventScroll: true });
  });

  listEl.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit]');
    const deleteBtn = event.target.closest('[data-delete]');

    if (editBtn) {
      const item = StockStore.list().find(i => i.id === editBtn.dataset.edit);
      if (!item) return;
      setMode(item);
      focusForm();
      return;
    }

    if (deleteBtn) {
      const item = StockStore.list().find(i => i.id === deleteBtn.dataset.delete);
      if (!item) return;

      const confirmed = await UI.modal({
        title: 'Hapus Stok',
        message: `Yakin ingin menghapus "${item.name}" dari daftar stok awal? Tindakan ini tidak bisa dibatalkan.`,
        icon: 'danger',
        confirmText: 'Ya, Hapus',
        cancelText: 'Batal',
        variant: 'danger'
      });
      if (!confirmed) return;

      const result = StockStore.remove(item.id);
      if (!result.success) {
        UI.toast(result.error, { type: 'danger' });
        return;
      }
      UI.toast(`"${item.name}" dihapus`, { type: 'success' });
      if (editingId === item.id) setMode(null);
      else refreshList();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('');

    const input = { name: nameInput.value, qty: qtyInput.value, unit: unitSelect.value, barcode: barcodeInput.value };
    const wasEditing = editingId !== null;
    const result = wasEditing ? StockStore.update(editingId, input) : StockStore.add(input);

    if (!result.success) {
      showError(result.error);
      return;
    }

    UI.toast(wasEditing ? `"${result.item.name}" diperbarui` : `"${result.item.name}" ditambahkan`, { type: 'success' });
    setMode(null);
    if (!wasEditing) nameInput.focus({ preventScroll: true });
  });
}
