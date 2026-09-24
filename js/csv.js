// Membaca berkas CSV untuk impor stok (dibuka lewat file handler di manifest.json). Fungsi murni tanpa
// DOM; validasi akhir tiap barang tetap dilakukan StockStore.add (nama unik, satuan, batas jumlah, dst).

export const MAX_IMPORT_ROWS = 500;

// Nama kolom yang dikenali (huruf besar/kecil tidak dibedakan, urutan kolom bebas).
const HEADERS = {
  name: ['nama', 'name', 'barang', 'nama barang'],
  qty: ['jumlah', 'qty', 'stok', 'stock'],
  unit: ['satuan', 'unit'],
  price: ['harga', 'price'],
  barcode: ['barcode', 'kode']
};
const REQUIRED_LABEL = { name: 'nama', qty: 'jumlah', unit: 'satuan' };

// Teks CSV → larik baris (larik kolom). Mengenali koma atau titik koma (Excel bahasa Indonesia),
// tanda kutip (termasuk kutip ganda dan baris baru di dalamnya), BOM, dan CRLF. Baris kosong dilewati.
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  endRow();
  return rows;
}

// Teks CSV → { rows: [{ name, qty, unit, price?, barcode? }], errors: [{ line, message }] }.
// Baris yang bermasalah dilaporkan dengan nomornya dan dilewati; baris lain tetap diproses.
export function stockRowsFromCsv(text) {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'Berkas kosong.' }] };

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const index = Object.fromEntries(Object.entries(HEADERS).map(([field, names]) => [field, header.findIndex((cell) => names.includes(cell))]));

  const missing = Object.keys(REQUIRED_LABEL).filter((field) => index[field] === -1);
  if (missing.length) {
    return { rows: [], errors: [{ line: 1, message: `Kolom wajib tidak ditemukan: ${missing.map((field) => REQUIRED_LABEL[field]).join(', ')}.` }] };
  }

  const rows = [];
  const errors = [];

  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({ line, message: `Impor dibatasi maksimal ${MAX_IMPORT_ROWS} barang per berkas; sisanya diabaikan.` });
      break;
    }

    const cell = (field) => (index[field] === -1 ? '' : String(table[i][index[field]] ?? '').trim());
    const name = cell('name');
    const qty = cell('qty');
    const unit = cell('unit');
    const priceText = cell('price');
    const barcode = cell('barcode');

    if (!name) { errors.push({ line, message: 'Nama barang kosong.' }); continue; }
    if (!/^\d+$/.test(qty)) { errors.push({ line, message: `Jumlah "${qty}" harus bilangan bulat 0 atau lebih.` }); continue; }
    if (!unit) { errors.push({ line, message: 'Satuan kosong.' }); continue; }
    if (priceText !== '' && !/^\d+$/.test(priceText)) { errors.push({ line, message: `Harga "${priceText}" harus bilangan bulat positif.` }); continue; }
    if (priceText !== '' && Number(priceText) < 1) { errors.push({ line, message: 'Harga harus lebih dari 0.' }); continue; }

    rows.push({
      name, qty, unit,
      ...(barcode && { barcode }),
      ...(priceText !== '' && { price: Number(priceText) })
    });
  }

  return { rows, errors };
}
