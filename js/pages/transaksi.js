import { StockStore, LOW_STOCK_MAX } from '../stock.js';
import { SalesStore } from '../sales.js';
import { TenantStore } from '../tenant.js';
import { UI } from '../ui.js';
import { scanBarcode } from '../scanner.js';
import {
  MAX_PAYMENT, isSellable, changeQty, removeLine, buildLines, sanitizeCart,
  summarize, balance, cashSuggestions, parseAmount
} from '../cart.js';
import { esc, escAttr, formatQty, formatRupiah } from '../format.js';
import { Auth } from '../auth.js';
import { autoPrint, printReceipt } from '../receipt.js';
import { pendingSearch } from '../deeplink.js';

// ============ HALAMAN TRANSAKSI (KASIR) ============
// Alur: pilih barang (cari / scan / ketuk kartu) → keranjang → bayar → struk.
// Barang & harga dari Stok Awal / Update Harga. Stok berkurang saat pembayaran berhasil
// dan penjualan dicatat lewat SalesStore.checkout (satu transaksi di database: kurangi stok + catat penjualan).

const SHEET_CLOSE_MS = 220;

const svg = (body, size = 20, width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON = {
  search: svg('<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>', 18),
  scan: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><line x1="7" y1="8" x2="7" y2="16"></line><line x1="11" y1="8" x2="11" y2="16"></line><line x1="15" y1="8" x2="15" y2="16"></line><line x1="17.5" y1="8" x2="17.5" y2="16"></line>'),
  cart: svg('<circle cx="9" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>', 22),
  close: svg('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 18, 2.5),
  minus: svg('<line x1="5" y1="12" x2="19" y2="12"></line>', 16, 2.5),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>', 16, 2.5),
  trash: svg('<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>', 16),
  check: svg('<polyline points="20 6 9 17 4 12"></polyline>', 34, 3),
  chevron: svg('<polyline points="9 18 15 12 9 6"></polyline>', 18, 2.5),
  empty: svg('<circle cx="9" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>', 30)
};

// --- Keadaan (bertahan selama halaman dibuka; keranjang ikut bertahan saat pindah menu) ---
let cart = new Map();
let query = '';
let payMethod = 'tunai'; // 'tunai' | 'nontunai'
let cashText = '';
let cleanup = null;

// ---------- HTML ----------

function cardHtml(item, inCart) {
  const sellable = isSellable(item);
  const hasPrice = Number.isInteger(item.price) && item.price > 0;
  const soldOut = item.qty <= 0;

  const price = hasPrice
    ? `<span class="trx-card-price">${esc(formatRupiah(item.price))}</span>`
    : '<span class="trx-card-price is-empty">Belum ada harga</span>';

  let stockClass = '';
  let stockText = `Stok ${formatQty(item.qty)} ${item.unit}`;
  if (soldOut) { stockClass = ' is-out'; stockText = 'Stok habis'; }
  else if (item.qty <= LOW_STOCK_MAX) stockClass = ' is-low';

  const badge = inCart ? `<span class="trx-card-badge" aria-hidden="true">${inCart}</span>` : '';
  const label = sellable
    ? `Tambah ${item.name}, ${formatRupiah(item.price)}, ${stockText}${inCart ? `, di keranjang ${inCart}` : ''}`
    : `${item.name}, ${hasPrice ? 'stok habis' : 'belum ada harga'}`;

  return `
    <li>
      <button type="button" class="trx-card${inCart ? ' is-in-cart' : ''}${sellable ? '' : ' is-off'}"
              data-add="${escAttr(item.id)}" aria-label="${escAttr(label)}"${sellable ? '' : ' disabled'}>
        ${badge}
        <span class="trx-card-name">${esc(item.name)}</span>
        ${price}
        <span class="trx-card-stock${stockClass}">${esc(stockText)}</span>
      </button>
    </li>`;
}

function matches(item, text) {
  if (!text) return true;
  const needle = text.toLowerCase();
  return item.name.toLowerCase().includes(needle) || String(item.barcode || '').toLowerCase().includes(needle);
}

function gridHtml(items) {
  const visible = items
    .filter((item) => matches(item, query))
    .sort((a, b) => Number(isSellable(b)) - Number(isSellable(a)) || a.name.localeCompare(b.name, 'id'));

  if (!items.length) {
    return Auth.canEditStock()
      ? '<li class="trx-empty">Belum ada barang. Tambahkan dulu di <a href="#/stok/awal">Stok Awal</a>.</li>'
      : '<li class="trx-empty">Belum ada barang. Stok diinput oleh tenantnya sendiri.</li>';
  }
  if (!visible.length) {
    return `<li class="trx-empty">Tidak ada barang untuk “${esc(query)}”.</li>`;
  }
  return visible.map((item) => cardHtml(item, cart.get(item.id) || 0)).join('');
}

const metaText = (items) => {
  const ready = items.filter(isSellable).length;
  return `${items.length} barang · ${ready} siap dijual`;
};

export function renderTransaksiPage() {
  const items = StockStore.list();
  const tenant = TenantStore.getCurrent();
  cart = sanitizeCart(items, cart);

  return `
    <div class="page-header">
      <p class="greeting">Kasir · ${esc(tenant.name)}</p>
      <h1 class="page-title">Transaksi</h1>
      <p class="page-subtitle">Cari atau scan barang, atur jumlah di keranjang, lalu terima pembayaran.</p>
    </div>

    <section class="trx-page" aria-label="Pilih barang">
      <div class="trx-toolbar">
        <div class="trx-search">
          <span class="trx-search-icon">${ICON.search}</span>
          <input type="search" id="trxSearch" class="form-input" placeholder="Cari nama atau barcode"
                 value="${escAttr(query)}" autocomplete="off" autocapitalize="off" spellcheck="false"
                 aria-label="Cari barang" enterkeyhint="search" />
        </div>
        <button type="button" class="btn btn-secondary trx-scan" id="trxScanBtn" aria-label="Scan barcode dengan kamera">${ICON.scan}</button>
      </div>
      <p class="trx-meta" id="trxMeta" aria-live="polite">${esc(metaText(items))}</p>
      <ul class="trx-grid" id="trxGrid">${gridHtml(items)}</ul>
    </section>
  `;
}

function lineHtml(line) {
  const id = escAttr(line.id);
  const name = escAttr(line.name);
  return `
    <li class="trx-line">
      <div class="trx-line-info">
        <p class="trx-line-name">${esc(line.name)}</p>
        <p class="trx-line-price">${esc(formatRupiah(line.price))} / ${esc(line.unit)}</p>
      </div>
      <p class="trx-line-sub">${esc(formatRupiah(line.subtotal))}</p>
      <div class="trx-stepper" role="group" aria-label="Jumlah ${name}">
        <button type="button" data-dec="${id}" aria-label="Kurangi ${name}">${ICON.minus}</button>
        <span class="trx-qty" aria-live="polite">${line.qty}</span>
        <button type="button" data-inc="${id}" aria-label="Tambah ${name}"${line.qty >= line.stock ? ' disabled' : ''}>${ICON.plus}</button>
      </div>
      <button type="button" class="trx-line-remove" data-remove="${id}" aria-label="Hapus ${name} dari keranjang">${ICON.trash}</button>
    </li>`;
}

function paymentHtml(total) {
  const isCash = payMethod === 'tunai';
  const seg = (method, label) =>
    `<button type="button" role="radio" aria-checked="${payMethod === method}" data-method="${method}" class="${payMethod === method ? 'is-active' : ''}">${label}</button>`;

  const cash = `
    <label for="trxCash" class="trx-field-label">Uang diterima</label>
    <div class="trx-cash-wrap">
      <span class="trx-cash-prefix" aria-hidden="true">Rp</span>
      <input type="text" id="trxCash" class="form-input" inputmode="numeric" autocomplete="off" placeholder="0"
             value="${escAttr(cashText)}" aria-describedby="trxChange" />
    </div>
    <div class="trx-chips">
      ${cashSuggestions(total).map((amount) =>
        `<button type="button" class="trx-chip" data-cash="${amount}">${amount === total ? 'Uang pas' : esc(formatRupiah(amount))}</button>`).join('')}
    </div>
    <div class="trx-change" id="trxChange" role="status" aria-live="polite"></div>`;

  const nonCash = `
    <p class="trx-note">Terima pembayaran lewat QRIS atau transfer sebesar total. Konfirmasi hanya setelah dana masuk.</p>`;

  return `
    <div class="trx-seg" role="radiogroup" aria-label="Metode pembayaran">
      ${seg('tunai', 'Tunai')}${seg('nontunai', 'QRIS / Transfer')}
    </div>
    ${isCash ? cash : nonCash}`;
}

function cartSheetHtml() {
  return `
    <header class="trx-sheet-head">
      <div class="trx-sheet-headtext">
        <h2 class="trx-sheet-title" id="trxSheetTitle">Keranjang</h2>
        <p class="trx-sheet-sub" id="trxSheetSub"></p>
      </div>
      <button type="button" class="trx-text-btn" data-clear id="trxClearBtn">Kosongkan</button>
      <button type="button" class="trx-icon-btn" data-close aria-label="Tutup keranjang">${ICON.close}</button>
    </header>
    <div class="trx-sheet-body" id="trxSheetBody">
      <ul class="trx-lines" id="trxLines"></ul>
      <div class="trx-payment" id="trxPayment"></div>
    </div>
    <footer class="trx-sheet-foot" id="trxSheetFoot">
      <div class="trx-total"><span>Total</span><strong id="trxTotal"></strong></div>
      <button type="button" class="btn btn-primary trx-pay-btn" id="trxPayBtn" data-pay></button>
    </footer>`;
}

function receiptSheetHtml(r) {
  const rows = r.lines.map((line) => `
    <li class="trx-r-line">
      <span class="trx-r-name">${esc(line.name)}<small>${line.qty} × ${esc(formatRupiah(line.price))}</small></span>
      <span class="trx-r-amt">${esc(formatRupiah(line.subtotal))}</span>
    </li>`).join('');

  const when = r.at.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const paidRows = r.method === 'tunai'
    ? `<div class="trx-r-row"><span>Tunai</span><span>${esc(formatRupiah(r.paid))}</span></div>
       <div class="trx-r-row is-strong"><span>Kembalian</span><span>${esc(formatRupiah(r.change))}</span></div>`
    : '<div class="trx-r-row"><span>Metode</span><span>QRIS / Transfer</span></div>';

  return `
    <div class="trx-sheet-body trx-receipt" id="trxSheetBody">
      <div class="trx-r-check">${ICON.check}</div>
      <h2 class="trx-sheet-title" id="trxSheetTitle">${r.pending ? 'Tersimpan Offline' : 'Pembayaran Berhasil'}</h2>
      <p class="trx-r-total">${esc(formatRupiah(r.total))}</p>
      <p class="trx-r-meta">${esc(r.no)}<br>${esc(when)} · ${esc(r.cashier)} · ${esc(r.tenant)}</p>
      ${r.pending ? '<p class="trx-r-offline" role="status">Belum terkirim ke server. Akan dikirim otomatis saat internet kembali; nomor transaksi resmi terbit setelah itu.</p>' : ''}
      <ul class="trx-r-lines">${rows}</ul>
      <div class="trx-r-summary">
        <div class="trx-r-row"><span>Total (${r.itemCount} barang)</span><span>${esc(formatRupiah(r.total))}</span></div>
        ${paidRows}
      </div>
    </div>
    <footer class="trx-sheet-foot">
      <button type="button" class="btn btn-secondary trx-pay-btn" data-print id="trxPrintBtn">Cetak Struk</button>
      <button type="button" class="btn btn-primary trx-pay-btn" data-close id="trxDoneBtn">Transaksi Baru</button>
    </footer>`;
}

// ---------- Interaksi ----------

export function initTransaksiPage() {
  const grid = document.getElementById('trxGrid');
  if (!grid) return;
  if (cleanup) cleanup(); // buang instance sebelumnya (mis. render ulang)

  const app = document.getElementById('app');
  const searchInput = document.getElementById('trxSearch');
  const scanBtn = document.getElementById('trxScanBtn');
  const metaEl = document.getElementById('trxMeta');

  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'trx-cartbar';
  bar.hidden = true;
  bar.setAttribute('aria-haspopup', 'dialog');
  document.body.appendChild(bar);

  let sheet = null; // { root, view: 'cart' | 'receipt', receipt, opener }

  const items = () => StockStore.list();
  const currentLines = () => buildLines(items(), cart);

  // --- Tampilan halaman ---
  const renderGrid = () => {
    const all = items();
    grid.innerHTML = gridHtml(all);
    metaEl.textContent = metaText(all);
  };

  const renderBar = () => {
    const { itemCount, total, lineCount } = summarize(currentLines());
    bar.hidden = lineCount === 0 || Boolean(sheet);
    if (lineCount === 0) return;
    bar.setAttribute('aria-label', `Buka keranjang, ${itemCount} barang, total ${formatRupiah(total)}`);
    bar.innerHTML = `
      <span class="trx-cartbar-icon">${ICON.cart}<span class="trx-cartbar-count">${itemCount}</span></span>
      <span class="trx-cartbar-text"><small>${itemCount} barang di keranjang</small><strong>${esc(formatRupiah(total))}</strong></span>
      <span class="trx-cartbar-cta">Lihat ${ICON.chevron}</span>`;
  };

  const syncCart = () => {
    cart = sanitizeCart(items(), cart);
    renderGrid();
    renderBar();
    if (sheet && sheet.view === 'cart') renderCartSheet();
  };

  // --- Tambah barang ---
  const addItem = (item) => {
    const before = cart.get(item.id) || 0;
    const next = changeQty(cart, item, 1);
    if ((next.get(item.id) || 0) === before) {
      UI.toast(`Stok "${item.name}" tinggal ${formatQty(item.qty)} ${item.unit}`, { type: 'warning' });
      return;
    }
    cart = next;
    renderGrid();
    renderBar();
  };

  grid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;
    const item = items().find((i) => i.id === button.dataset.add);
    if (item && isSellable(item)) addItem(item);
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim();
    renderGrid();
  });

  // Aplikasi dibuka lewat "Bagikan" dari aplikasi lain: isi pencarian dengan teks yang dibagikan.
  const shared = pendingSearch && pendingSearch.take();
  if (shared) {
    searchInput.value = shared;
    query = shared;
    renderGrid();
  }

  // Enter pada barcode yang persis cocok (mis. hasil ketik/tempel) langsung menambah barang
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const found = query ? StockStore.findByBarcode(query) : null;
    if (found && isSellable(found)) {
      addItem(found);
      query = '';
      searchInput.value = '';
      renderGrid();
    }
  });

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    const result = await scanBarcode();
    scanBtn.disabled = false;

    if (result.error) {
      UI.toast(result.error, { type: 'danger', duration: 6000 });
      return;
    }
    if (!result.code) return;

    const found = StockStore.findByBarcode(result.code);
    if (!found) {
      UI.toast(`Barcode ${result.code} belum terdaftar di Stok Awal`, { type: 'warning', duration: 4500 });
    } else if (!isSellable(found)) {
      UI.toast(`"${found.name}" ${found.price ? 'stok habis' : 'belum ada harga'}`, { type: 'warning', duration: 4500 });
    } else {
      addItem(found);
      UI.toast(`${found.name} ditambahkan`, { type: 'success', duration: 1800 });
    }
  });

  bar.addEventListener('click', () => openSheet('cart'));

  // --- Lembar keranjang / struk ---
  const setCashText = (text) => {
    const amount = parseAmount(text);
    cashText = amount === null ? '' : amount.toLocaleString('id-ID');
  };

  const payState = () => {
    const { total } = summarize(currentLines());
    if (payMethod !== 'tunai') return { total, canPay: total > 0, paid: total };
    const paid = parseAmount(cashText);
    return { total, paid, canPay: paid !== null && paid >= total && paid <= MAX_PAYMENT && total > 0 };
  };

  const updatePayControls = () => {
    if (!sheet || sheet.view !== 'cart') return;
    const { total, paid, canPay } = payState();
    const payBtn = document.getElementById('trxPayBtn');
    if (!payBtn) return;
    payBtn.disabled = !canPay;
    payBtn.textContent = canPay || payMethod !== 'tunai'
      ? `Bayar ${formatRupiah(total)}`
      : paid === null ? 'Masukkan uang diterima' : 'Uang belum cukup';

    const changeEl = document.getElementById('trxChange');
    if (!changeEl) return;
    if (paid === null) {
      changeEl.dataset.state = 'idle';
      changeEl.innerHTML = '<span>Kembalian</span><strong>—</strong>';
    } else if (paid > MAX_PAYMENT) {
      changeEl.dataset.state = 'short';
      changeEl.innerHTML = '<span>Nominal terlalu besar</span><strong></strong>';
    } else if (paid < total) {
      changeEl.dataset.state = 'short';
      changeEl.innerHTML = `<span>Kurang</span><strong>${esc(formatRupiah(total - paid))}</strong>`;
    } else {
      changeEl.dataset.state = 'ok';
      changeEl.innerHTML = `<span>Kembalian</span><strong>${esc(formatRupiah(balance(total, paid)))}</strong>`;
    }
  };

  function renderCartSheet() {
    const inner = sheet.root.querySelector('#trxSheetInner');
    const lines = currentLines();

    if (!lines.length) {
      inner.innerHTML = `
        <header class="trx-sheet-head">
          <h2 class="trx-sheet-title" id="trxSheetTitle">Keranjang</h2>
          <button type="button" class="trx-icon-btn" data-close aria-label="Tutup keranjang">${ICON.close}</button>
        </header>
        <div class="trx-sheet-body trx-cart-empty">
          <span class="trx-cart-empty-icon">${ICON.empty}</span>
          <p>Keranjang masih kosong</p>
          <button type="button" class="btn btn-secondary" data-close>Pilih barang</button>
        </div>`;
      return;
    }

    // Kerangka dibuat sekali; bagian dalam diperbarui terpisah agar isian uang tidak kehilangan fokus
    if (!inner.querySelector('#trxLines')) inner.innerHTML = cartSheetHtml();

    const { itemCount, total, lineCount } = summarize(lines);
    inner.querySelector('#trxSheetSub').textContent = `${lineCount} jenis · ${itemCount} barang`;
    inner.querySelector('#trxLines').innerHTML = lines.map(lineHtml).join('');
    inner.querySelector('#trxTotal').textContent = formatRupiah(total);

    const panel = inner.querySelector('#trxPayment');
    const focusedCash = document.activeElement && document.activeElement.id === 'trxCash';
    if (!focusedCash) panel.innerHTML = paymentHtml(total);
    updatePayControls();
  }

  function renderReceiptSheet() {
    sheet.root.querySelector('#trxSheetInner').innerHTML = receiptSheetHtml(sheet.receipt);
    document.getElementById('trxDoneBtn').focus();
  }

  const onKeydown = (event) => {
    if (event.key !== 'Escape' || !sheet) return;
    const modal = document.getElementById('modalRoot');
    if (modal && modal.classList.contains('visible')) return; // Escape milik dialog konfirmasi
    closeSheet();
  };

  function openSheet(view) {
    if (sheet) return;
    const root = document.createElement('div');
    root.className = 'trx-sheet-root';
    root.innerHTML = `
      <div class="trx-backdrop" data-close></div>
      <section class="trx-sheet" role="dialog" aria-modal="true" aria-labelledby="trxSheetTitle">
        <div class="trx-sheet-handle" aria-hidden="true"></div>
        <div class="trx-sheet-inner" id="trxSheetInner"></div>
      </section>`;
    document.body.appendChild(root);
    if (app) app.inert = true; // fokus keyboard/pembaca layar tetap di lembar
    bar.hidden = true;

    sheet = { root, view, receipt: null, opener: document.activeElement };
    root.addEventListener('click', onSheetClick);
    root.addEventListener('input', onSheetInput);
    document.addEventListener('keydown', onKeydown);

    renderCartSheet();
    requestAnimationFrame(() => root.classList.add('open'));
    const closeBtn = root.querySelector('[data-close]:not(.trx-backdrop)');
    if (closeBtn) closeBtn.focus();
  }

  function closeSheet({ immediate = false } = {}) {
    if (!sheet) return;
    const { root, opener } = sheet;
    sheet = null;
    document.removeEventListener('keydown', onKeydown);
    if (app) app.inert = false;
    root.classList.remove('open');
    if (immediate) root.remove();
    else setTimeout(() => root.remove(), SHEET_CLOSE_MS);
    renderBar();
    if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }

  async function confirmClear() {
    const confirmed = await UI.modal({
      title: 'Kosongkan Keranjang',
      message: 'Semua barang di keranjang akan dihapus. Lanjutkan?',
      icon: 'warning',
      confirmText: 'Ya, Kosongkan',
      cancelText: 'Batal',
      variant: 'danger'
    });
    if (!confirmed) return;
    cart = new Map();
    cashText = '';
    syncCart();
  }

  let paying = false;

  async function pay() {
    if (paying) return; // cegah tekan ganda selama menunggu database
    const lines = currentLines();
    const { paid, canPay } = payState();
    if (!lines.length || !canPay) return;

    paying = true;
    const payBtn = document.getElementById('trxPayBtn');
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = 'Memproses…';
    }

    // Total dihitung ulang oleh database dari harga yang tersimpan; struk memakai hasil dari database.
    const result = await SalesStore.checkout({ method: payMethod, paid, lines });
    paying = false;

    if (!result.success) {
      UI.toast(result.error, { type: 'danger', duration: 5000 });
      await StockStore.load(); // stok bisa saja berubah di perangkat lain; samakan lalu sesuaikan keranjang
      renderGrid();
      syncCart();
      return;
    }

    const { sale } = result;
    // Baris dari database tidak membawa subtotal (hanya baris keranjang yang punya); hitung di sini agar
    // jumlah per barang di struk tidak tampil "Rp NaN".
    const receiptLines = sale.lines.map((line) => ({ ...line, subtotal: line.qty * line.price }));
    const summary = summarize(receiptLines);
    const receipt = {
      no: sale.no,
      at: new Date(sale.at),
      cashier: sale.cashier,
      tenant: TenantStore.getCurrent().name,
      lines: receiptLines,
      itemCount: summary.itemCount,
      total: sale.total,
      method: sale.method,
      paid: sale.paid,
      change: sale.paid - sale.total,
      pending: !!sale.pending
    };

    cart = new Map();
    cashText = '';
    sheet.view = 'receipt';
    sheet.receipt = receipt;
    renderGrid();
    renderReceiptSheet();
    if (autoPrint && autoPrint.isOn()) printReceipt(receipt);
  }

  function onSheetClick(event) {
    const find = (selector) => event.target.closest(selector);

    if (find('[data-print]')) return printReceipt(sheet.receipt);
    if (find('[data-close]')) return closeSheet();
    if (find('[data-clear]')) return confirmClear();
    if (find('[data-pay]')) return pay();

    const method = find('[data-method]');
    if (method) {
      payMethod = method.dataset.method;
      renderCartSheet();
      return;
    }

    const chip = find('[data-cash]');
    if (chip) {
      setCashText(chip.dataset.cash);
      const input = document.getElementById('trxCash');
      if (input) input.value = cashText;
      updatePayControls();
      return;
    }

    const inc = find('[data-inc]');
    const dec = find('[data-dec]');
    const remove = find('[data-remove]');
    const source = inc || dec || remove;
    if (!source) return;

    const id = inc ? inc.dataset.inc : dec ? dec.dataset.dec : remove.dataset.remove;
    const item = items().find((i) => i.id === id);
    if (!item) return;
    cart = remove ? removeLine(cart, id) : changeQty(cart, item, inc ? 1 : -1);
    syncCart();
  }

  function onSheetInput(event) {
    if (event.target.id !== 'trxCash') return;
    setCashText(event.target.value);
    event.target.value = cashText; // tampilkan dengan pemisah ribuan
    updatePayControls();
  }

  // --- Bersihkan saat pindah halaman ---
  const onHashChange = () => {
    if (location.hash.startsWith('#/kasir')) return;
    cleanup();
  };
  window.addEventListener('hashchange', onHashChange);

  cleanup = () => {
    closeSheet({ immediate: true });
    window.removeEventListener('hashchange', onHashChange);
    document.removeEventListener('keydown', onKeydown);
    bar.remove();
    cleanup = null;
  };

  renderBar();
}
