import { StockStore, MAX_PRICE } from '../stock.js';
import { TenantStore } from '../tenant.js';
import { UI } from '../ui.js';
import { esc, escAttr, formatQty, formatRupiah } from '../format.js';

// ============ HALAMAN UPDATE HARGA ============
// Daftar barang diambil dari Stok Awal. Tiap baris punya tombol Edit untuk
// mengisi harga, lalu Simpan. Validasi sebenarnya ada di StockStore.setPrice.

const hasPrice = (item) => Number.isInteger(item.price) && item.price > 0;

const ICON_EDIT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';

let editingId = null;

function stockLine(item) {
  return `<p class="stok-sub">Stok: ${esc(formatQty(item.qty))} ${esc(item.unit)}</p>`;
}

function viewRowHtml(item) {
  const id = escAttr(item.id);
  const name = escAttr(item.name);
  const price = hasPrice(item)
    ? `<p class="harga-value">${esc(formatRupiah(item.price))}</p>`
    : '<p class="harga-value is-empty">Belum ada harga</p>';

  return `
    <li class="stok-row harga-row">
      <div class="stok-meta">
        <p class="stok-name">${esc(item.name)}</p>
        ${stockLine(item)}
      </div>
      ${price}
      <div class="stok-actions">
        <button type="button" class="icon-action" data-edit-price="${id}" aria-label="Edit harga ${name}">${ICON_EDIT}</button>
      </div>
    </li>`;
}

function editRowHtml(item) {
  const id = escAttr(item.id);
  const name = escAttr(item.name);
  const value = hasPrice(item) ? escAttr(item.price) : '';

  return `
    <li class="stok-row harga-row is-editing">
      <div class="stok-meta">
        <p class="stok-name">${esc(item.name)}</p>
        ${stockLine(item)}
      </div>
      <form class="harga-edit-form" data-price-form="${id}" novalidate>
        <div class="harga-input-wrap">
          <span class="harga-prefix" aria-hidden="true">Rp</span>
          <input type="number" class="form-input harga-input" inputmode="numeric" min="1" max="${MAX_PRICE}" step="1"
                 placeholder="0" value="${value}" aria-label="Harga ${name}" required />
        </div>
        <button type="submit" class="btn btn-primary">Simpan</button>
        <button type="button" class="btn btn-secondary" data-cancel-price>Batal</button>
      </form>
      <p class="form-error harga-error" role="alert" hidden></p>
    </li>`;
}

function listHtml(items) {
  if (!items.length) {
    return '<li class="stok-empty">Belum ada barang. Tambahkan dulu di <a href="#/stok/awal">Stok Awal</a>.</li>';
  }
  return items.map(item => (item.id === editingId ? editRowHtml(item) : viewRowHtml(item))).join('');
}

const summary = (items) => `${items.filter(hasPrice).length} dari ${items.length} barang sudah berharga`;

export function renderHargaPage() {
  const items = StockStore.list();
  const tenant = TenantStore.getCurrent();

  return `
    <div class="page-header">
      <p class="greeting">Harga · ${esc(tenant.name)}</p>
      <h1 class="page-title">Update Harga</h1>
      <p class="page-subtitle">Isi atau ubah harga jual tiap barang. Daftar barang mengikuti Stok Awal.</p>
    </div>

    <section class="activity-card" aria-label="Daftar harga barang">
      <div class="stok-head">
        <h2 class="section-title">Daftar Harga <span class="stok-count" id="hargaCount">${esc(summary(items))}</span></h2>
      </div>
      <ul class="stok-list" id="hargaList">${listHtml(items)}</ul>
    </section>
  `;
}

// Dipanggil router setelah HTML dirender
export function initHargaPage() {
  const listEl = document.getElementById('hargaList');
  if (!listEl) return;

  editingId = null;
  const countEl = document.getElementById('hargaCount');

  const refresh = (focusInput = false) => {
    const items = StockStore.list();
    listEl.innerHTML = listHtml(items);
    countEl.textContent = summary(items);
    if (focusInput) {
      const input = listEl.querySelector('.harga-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  };

  listEl.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-edit-price]');
    if (editBtn) {
      editingId = editBtn.dataset.editPrice;
      refresh(true);
      return;
    }
    if (event.target.closest('[data-cancel-price]')) {
      editingId = null;
      refresh();
    }
  });

  listEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editingId) {
      editingId = null;
      refresh();
    }
  });

  listEl.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-price-form]');
    if (!form) return;
    event.preventDefault();

    const input = form.querySelector('.harga-input');
    const errorEl = form.parentElement.querySelector('.harga-error');
    const result = StockStore.setPrice(form.dataset.priceForm, input.value);

    if (!result.success) {
      errorEl.textContent = result.error;
      errorEl.hidden = false;
      input.focus();
      return;
    }

    UI.toast(`Harga "${result.item.name}" disimpan: ${formatRupiah(result.item.price)}`, { type: 'success' });
    editingId = null;
    refresh();
  });
}
