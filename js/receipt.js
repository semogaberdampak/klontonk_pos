import { esc, formatQty, formatRupiah } from './format.js';
import { browserStorage } from './snapshot.js';

// Cetak struk penjualan. Struk dicetak lewat dialog cetak browser (window.print), jadi bisa ke printer
// thermal yang terpasang di perangkat lewat drivernya, ke printer biasa, atau "Simpan sebagai PDF".
// Tata letak 58 mm (ukuran printer thermal yang umum di warung); aturan cetaknya ada di css/reports.css
// (#receiptPrint), sehingga tidak mengganggu cetak Laporan.
//
// Bentuk struk (dari js/pages/transaksi.js):
//   { no, at: Date, cashier, tenant, lines: [{ name, unit, qty, price }], total, method, paid, change, pending }
// Jumlah per barang dihitung ulang dari qty x harga; tidak bergantung pada field lain di baris.

const AUTO_PRINT_KEY = 'klontonk:autoprint';
const CLEANUP_FALLBACK_MS = 30000;

const PAYMENT_LABEL = { nontunai: 'QRIS / Transfer' };

export function receiptPrintHtml(r) {
  const when = r.at.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  const rows = r.lines.map((line) => `
    <li class="rp-line">
      <span class="rp-name">${esc(line.name)}</span>
      <span class="rp-detail">${esc(formatQty(line.qty))} ${esc(line.unit)} × ${esc(formatRupiah(line.price))}</span>
      <span class="rp-amt">${esc(formatRupiah(line.qty * line.price))}</span>
    </li>`).join('');

  const paymentRows = r.method === 'tunai'
    ? `<div class="rp-row"><span>Tunai</span><span>${esc(formatRupiah(r.paid))}</span></div>
       <div class="rp-row"><span>Kembalian</span><span>${esc(formatRupiah(r.change))}</span></div>`
    : `<div class="rp-row"><span>Metode</span><span>${esc(PAYMENT_LABEL[r.method] || r.method)}</span></div>`;

  return `
    <div class="rp-head">
      <p class="rp-store">${esc(r.tenant)}</p>
      <p>${esc(r.no)}</p>
      <p>${esc(when)}</p>
      <p>Kasir: ${esc(r.cashier)}</p>
    </div>
    <ul class="rp-lines">${rows}</ul>
    <div class="rp-sum">
      <div class="rp-row rp-total"><span>Total</span><span>${esc(formatRupiah(r.total))}</span></div>
      ${paymentRows}
    </div>
    ${r.pending ? '<p class="rp-note">Struk sementara. Nomor transaksi resmi terbit setelah data terkirim ke server.</p>' : ''}
    <p class="rp-thanks">Terima kasih</p>`;
}

// Pengaturan "cetak otomatis setelah pembayaran". Mati secara bawaan agar dialog cetak tidak muncul
// tanpa diminta; penyimpanan yang diblokir dianggap mati dan tidak membuat aplikasi error.
export function createAutoPrintSetting(storage) {
  return {
    isOn() {
      try {
        return storage.getItem(AUTO_PRINT_KEY) === '1';
      } catch (err) {
        return false;
      }
    },
    set(on) {
      try {
        storage.setItem(AUTO_PRINT_KEY, on ? '1' : '0');
      } catch (err) {
        // penyimpanan diblokir: pengaturan tidak tersimpan, tidak ada yang perlu dilakukan
      }
    }
  };
}

export const autoPrint = typeof window === 'undefined' ? null : createAutoPrintSetting(browserStorage());

// Cetak struk: siapkan wadah khusus cetak, tandai halaman, lalu buka dialog cetak. Wadah dan tanda dibuang
// setelah selesai. `afterprint` tidak dipicu di semua browser, jadi ada pembersihan cadangan; tanpa itu
// tanda yang tertinggal akan membuat cetak Laporan berikutnya kosong.
export function printReceipt(receipt) {
  const root = document.createElement('div');
  root.id = 'receiptPrint';
  root.innerHTML = receiptPrintHtml(receipt);
  document.body.appendChild(root);
  document.documentElement.classList.add('printing-receipt');

  let timer = null;
  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener('afterprint', cleanup);
    root.remove();
    document.documentElement.classList.remove('printing-receipt');
  };
  window.addEventListener('afterprint', cleanup);
  timer = setTimeout(cleanup, CLEANUP_FALLBACK_MS);
  window.print();
}
