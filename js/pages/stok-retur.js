import { StockStore } from '../stock.js';
import { TenantStore } from '../tenant.js';
import { ReturnStore, KINDS, REASONS, MAX_NOTE, customerReturnLimits } from '../returns.js';
import { UI } from '../ui.js';
import { esc, formatQty, formatWhen, formatRupiah } from '../format.js';

// ============ HALAMAN STOK RETUR ============
// Proses retur (dari pelanggan / ke supplier) dan riwayatnya untuk tenant aktif.
// Perhitungan dan aturan sebenarnya dijalankan database (process_return); halaman ini lapisan tampilan.

const HISTORY_LIMIT = 20;
const KIND_SHORT = { pelanggan: 'Pelanggan', supplier: 'Supplier' };
const REASON_LABEL = Object.fromEntries(Object.values(REASONS).flat().map((r) => [r.id, r.label]));

let kind = 'pelanggan';


// Ringkasan bulan ini (waktu lokal).
function monthStats(returns) {
  const now = new Date();
  const inMonth = returns.filter((r) => {
    const d = new Date(r.at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const byKind = (k) => inMonth.filter((r) => r.kind === k);
  return {
    customerCount: byKind('pelanggan').length,
    supplierCount: byKind('supplier').length,
    refund: byKind('pelanggan').reduce((sum, r) => sum + r.amount, 0)
  };
}

// Pilihan barang sesuai jenis: pelanggan hanya barang yang pernah terjual dan belum habis diretur;
// supplier hanya barang yang stoknya masih ada.
function itemOptions(items, limits) {
  return items.map((item) => {
    let usable;
    let detail;
    if (kind === 'pelanggan') {
      const { sold = 0, returned = 0 } = limits.get(item.id) || {};
      const left = sold - returned;
      usable = left > 0 && item.price != null;
      detail = item.price == null ? 'harga belum diisi' : left > 0 ? `bisa diretur ${formatQty(left)} ${item.unit}` : sold > 0 ? 'sudah diretur semua' : 'belum pernah terjual';
    } else {
      usable = item.qty > 0;
      detail = item.qty > 0 ? `stok ${formatQty(item.qty)} ${item.unit}` : 'stok kosong';
    }
    return `<option value="${esc(item.id)}"${usable ? '' : ' disabled'}>${esc(item.name)} — ${esc(detail)}</option>`;
  }).join('');
}

function reasonOptions() {
  return REASONS[kind].map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
}

function historyRow(ret) {
  const sign = ret.kind === 'pelanggan' ? '+' : '−';
  const money = ret.kind === 'pelanggan' ? `<span class="ret-money">${esc(formatRupiah(ret.amount))}</span>` : '';
  const note = ret.note ? ` · “${esc(ret.note)}”` : '';
  return `
    <li class="ret-row">
      <div class="ret-main">
        <p class="ret-name">${esc(ret.name)}</p>
        <p class="ret-sub">${esc(formatWhen(ret.at))} · ${esc(REASON_LABEL[ret.reason] || ret.reason)}${note}</p>
        <p class="ret-sub">${esc(ret.no)} · ${esc(ret.cashier)}</p>
      </div>
      <div class="ret-side">
        <span class="ret-badge is-${esc(ret.kind)}">${esc(KIND_SHORT[ret.kind])}</span>
        <p class="ret-qty"><strong>${sign}${esc(formatQty(ret.qty))}</strong> ${esc(ret.unit)}</p>
        ${money}
      </div>
    </li>`;
}

function historyHtml(returns) {
  if (!returns.length) return '<li class="ret-empty">Belum ada retur di tenant ini.</li>';
  return [...returns].reverse().slice(0, HISTORY_LIMIT).map(historyRow).join('');
}

function statsHtml(returns) {
  const { customerCount, supplierCount, refund } = monthStats(returns);
  return `
    <div class="rep-stats" aria-label="Ringkasan retur bulan ini">
      <div class="rep-stat is-wide">
        <span class="rep-stat-label">Uang dikembalikan bulan ini</span>
        <strong class="rep-stat-value">${esc(formatRupiah(refund))}</strong>
      </div>
      <div class="rep-stat">
        <span class="rep-stat-label">Retur pelanggan</span>
        <strong class="rep-stat-value">${customerCount}</strong>
        <span class="rep-stat-sub">bulan ini</span>
      </div>
      <div class="rep-stat">
        <span class="rep-stat-label">Retur supplier</span>
        <strong class="rep-stat-value">${supplierCount}</strong>
        <span class="rep-stat-sub">bulan ini</span>
      </div>
    </div>`;
}

export function renderStokReturPage() {
  const items = StockStore.list();
  const returns = ReturnStore.list();
  const tenant = TenantStore.getCurrent();
  const limits = customerReturnLimits();

  const tabs = KINDS.map((k) => `
    <button type="button" role="tab" aria-selected="${k.id === kind}" class="${k.id === kind ? 'is-active' : ''}" data-kind="${k.id}">${esc(k.label)}</button>`).join('');

  return `
    <div class="page-header">
      <p class="greeting">Stok · ${esc(tenant.name)}</p>
      <h1 class="page-title">Stok Retur</h1>
      <p class="page-subtitle">Proses barang yang dikembalikan pelanggan atau dikeluarkan karena rusak.</p>
    </div>

    <div class="ret-page">
      <div id="retStats">${statsHtml(returns)}</div>

      <section class="activity-card" aria-label="Proses retur">
        <h2 class="section-title" style="margin-bottom:12px;">Proses Retur</h2>
        <div class="rep-seg ret-seg" role="tablist" aria-label="Jenis retur" id="retTabs">${tabs}</div>
        <p class="field-hint" id="retKindHint" style="margin:10px 0 14px;">${esc(KINDS.find((k) => k.id === kind).hint)}</p>

        <form id="retForm" autocomplete="off" novalidate>
          <div class="form-group">
            <label for="retItem" class="form-label">Barang</label>
            <select id="retItem" class="form-input" required>
              <option value="">Pilih barang…</option>
              ${itemOptions(items, limits)}
            </select>
          </div>

          <div class="stok-fields">
            <div class="form-group">
              <label for="retQty" class="form-label">Jumlah</label>
              <input type="number" id="retQty" class="form-input" placeholder="0" min="1" max="1000000" step="1" inputmode="numeric" required />
            </div>
            <div class="form-group">
              <label for="retReason" class="form-label">Alasan</label>
              <select id="retReason" class="form-input" required>${reasonOptions()}</select>
            </div>
          </div>

          <div class="form-group">
            <label for="retNote" class="form-label">Catatan <span class="field-optional">(opsional)</span></label>
            <input type="text" id="retNote" class="form-input" maxlength="${MAX_NOTE}" placeholder="cth: kemasan sobek" />
          </div>

          <p class="ret-preview" id="retPreview" aria-live="polite"></p>
          <p class="form-error" id="retError" role="alert" hidden></p>

          <div class="stok-form-actions">
            <button type="submit" class="btn btn-primary" id="retSubmit">Proses Retur</button>
          </div>
        </form>
      </section>

      <section class="activity-card" aria-label="Riwayat retur">
        <h2 class="section-title" style="margin-bottom:8px;">Riwayat Retur <span class="stok-count" id="retCount">${returns.length} retur</span></h2>
        <ul class="ret-list" id="retList">${historyHtml(returns)}</ul>
      </section>
    </div>
  `;
}

export function initStokReturPage() {
  const form = document.getElementById('retForm');
  if (!form) return;

  const itemSelect = document.getElementById('retItem');
  const qtyInput = document.getElementById('retQty');
  const reasonSelect = document.getElementById('retReason');
  const noteInput = document.getElementById('retNote');
  const preview = document.getElementById('retPreview');
  const errorEl = document.getElementById('retError');
  const submitBtn = document.getElementById('retSubmit');
  const tabs = document.getElementById('retTabs');
  let busy = false;

  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  };

  const selectedItem = () => StockStore.list().find((item) => item.id === itemSelect.value) || null;

  // Pratinjau: stok sesudah retur dan nilai uang (pelanggan).
  function updatePreview() {
    const item = selectedItem();
    const qty = Number(qtyInput.value);
    if (!item || !Number.isInteger(qty) || qty < 1) { preview.textContent = ''; return; }
    if (kind === 'pelanggan') {
      const { sold = 0, returned = 0 } = customerReturnLimits().get(item.id) || {};
      const over = qty > sold - returned;
      preview.textContent = over
        ? `Melebihi batas: maksimal ${formatQty(sold - returned)} ${item.unit} yang bisa diretur.`
        : `Stok ${formatQty(item.qty)} → ${formatQty(item.qty + qty)} ${item.unit} · uang dikembalikan ${formatRupiah(qty * (item.price || 0))}`;
      preview.classList.toggle('is-warn', over);
    } else {
      const over = qty > item.qty;
      preview.textContent = over
        ? `Melebihi stok: tinggal ${formatQty(item.qty)} ${item.unit}.`
        : `Stok ${formatQty(item.qty)} → ${formatQty(item.qty - qty)} ${item.unit}`;
      preview.classList.toggle('is-warn', over);
    }
  }

  function refresh() {
    const returns = ReturnStore.list();
    document.getElementById('retStats').innerHTML = statsHtml(returns);
    document.getElementById('retList').innerHTML = historyHtml(returns);
    document.getElementById('retCount').textContent = `${returns.length} retur`;
    const keep = itemSelect.value;
    itemSelect.innerHTML = `<option value="">Pilih barang…</option>${itemOptions(StockStore.list(), customerReturnLimits())}`;
    if ([...itemSelect.options].some((o) => o.value === keep && !o.disabled)) itemSelect.value = keep;
    updatePreview();
  }

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-kind]');
    if (!button || button.dataset.kind === kind) return;
    kind = button.dataset.kind;
    tabs.querySelectorAll('[data-kind]').forEach((el) => {
      const active = el.dataset.kind === kind;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-selected', String(active));
    });
    document.getElementById('retKindHint').textContent = KINDS.find((k) => k.id === kind).hint;
    reasonSelect.innerHTML = reasonOptions();
    itemSelect.value = '';
    showError('');
    refresh();
  });

  itemSelect.addEventListener('change', () => { showError(''); updatePreview(); });
  qtyInput.addEventListener('input', updatePreview);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    showError('');

    const item = selectedItem();
    const qty = Number(qtyInput.value);
    if (!item) return showError('Pilih barang yang diretur.');
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) return showError('Jumlah harus bilangan bulat 1 – 1.000.000.');

    busy = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses…';
    const result = await ReturnStore.process({ kind, itemId: item.id, qty, reason: reasonSelect.value, note: noteInput.value.trim() });
    busy = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Proses Retur';

    if (!result.success) {
      showError(result.error);
      await StockStore.load(); // stok mungkin sudah berubah di perangkat lain
      refresh();
      return;
    }

    const { ret, stockAfter } = result;
    const refund = ret.kind === 'pelanggan' ? ` · kembalikan ${formatRupiah(ret.amount)}` : '';
    UI.toast(`Retur ${ret.name} ${formatQty(ret.qty)} ${ret.unit} tercatat${refund}. Stok kini ${formatQty(stockAfter)}.`, { type: 'success', duration: 5000 });
    qtyInput.value = '';
    noteInput.value = '';
    itemSelect.value = '';
    refresh();
  });

  updatePreview();
}
