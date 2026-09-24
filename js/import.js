import { Auth } from './auth.js';
import { StockStore } from './stock.js';
import { UI } from './ui.js';
import { stockRowsFromCsv } from './csv.js';

// Impor stok dari berkas CSV yang dibuka dengan aplikasi (file handler di manifest.json).
// Aturan: stok tenant HANYA boleh diinput oleh tenant itu sendiri, jadi akun admin ditolak.
// Tiap barang tetap divalidasi StockStore.add (nama unik, satuan, batas jumlah); yang ditolak dilewati
// dan dilaporkan, yang lain tetap masuk.

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ERRORS_SHOWN = 3;

const summarizeErrors = (errors) => errors
  .slice(0, MAX_ERRORS_SHOWN)
  .map((error) => `baris ${error.line}: ${error.message}`)
  .join('; ') + (errors.length > MAX_ERRORS_SHOWN ? `; dan ${errors.length - MAX_ERRORS_SHOWN} lainnya` : '');

async function importStockFile(file) {
  if (Auth.isAdmin()) {
    UI.toast('Stok tenant hanya bisa diinput oleh tenant itu sendiri. Masuk dengan akun tenant untuk mengimpor.', { type: 'warning', duration: 8000 });
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    UI.toast('Berkas terlalu besar (maksimal 1 MB).', { type: 'danger' });
    return;
  }

  const { rows, errors } = stockRowsFromCsv(await file.text());
  if (!rows.length) {
    await UI.modal({
      title: 'Impor Stok', icon: 'danger', confirmText: 'OK',
      message: `Tidak ada barang yang bisa diimpor dari "${file.name}". ${summarizeErrors(errors)}`
    });
    return;
  }

  const skipped = errors.length ? ` ${errors.length} baris bermasalah akan dilewati (${summarizeErrors(errors)}).` : '';
  const confirmed = await UI.modal({
    title: 'Impor Stok dari CSV', icon: 'info', confirmText: `Impor ${rows.length} barang`, cancelText: 'Batal',
    message: `${rows.length} barang dari "${file.name}" siap ditambahkan ke stok. Barang dengan nama yang sudah ada dilewati.${skipped}`
  });
  if (!confirmed) return;

  const failed = [];
  let added = 0;
  rows.forEach((row, index) => {
    const result = StockStore.add({ name: row.name, qty: row.qty, unit: row.unit, barcode: row.barcode });
    if (!result.success) return failed.push({ line: index + 2, message: `"${row.name}": ${result.error}` });
    added += 1;
    if (row.price !== undefined) StockStore.setPrice(result.item.id, row.price);
  });

  window.location.hash = '#/stok/total';
  if (!failed.length) {
    UI.toast(`${added} barang berhasil diimpor.`, { type: 'success' });
    return;
  }
  await UI.modal({
    title: 'Impor Selesai', icon: 'warning', confirmText: 'OK',
    message: `${added} barang masuk, ${failed.length} dilewati. ${summarizeErrors(failed)}`
  });
}

// Berkas yang dibuka lewat sistem (klik dua kali .csv → "Buka dengan Klontonk") masuk lewat launchQueue.
export function registerFileHandler() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async ({ files }) => {
    for (const handle of files || []) {
      try {
        await importStockFile(await handle.getFile());
      } catch (err) {
        UI.toast('Berkas tidak bisa dibaca.', { type: 'danger' });
      }
    }
  });
}
