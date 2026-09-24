import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, stockRowsFromCsv, MAX_IMPORT_ROWS } from '../js/csv.js';

test('parseCsv membaca baris dan kolom dengan pemisah koma', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv mengenali pemisah titik koma (Excel bahasa Indonesia)', () => {
  assert.deepEqual(parseCsv('nama;jumlah\nBeras;10'), [['nama', 'jumlah'], ['Beras', '10']]);
});

test('parseCsv menangani tanda kutip, koma di dalam kutip, dan kutip ganda', () => {
  assert.deepEqual(parseCsv('a,b\n"Beras, Premium","5"" pipa"'), [['a', 'b'], ['Beras, Premium', '5" pipa']]);
});

test('parseCsv menangani CRLF, BOM, dan baris kosong', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,2\r\n\r\n3,4\r\n'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseCsv menangani baris baru di dalam kutip', () => {
  assert.deepEqual(parseCsv('a,b\n"baris 1\nbaris 2",x'), [['a', 'b'], ['baris 1\nbaris 2', 'x']]);
});

test('parseCsv pada teks kosong menghasilkan larik kosong', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('stockRowsFromCsv memetakan kolom menurut nama header, tanpa peduli huruf besar dan urutan', () => {
  const { rows, errors } = stockRowsFromCsv('Satuan,NAMA,Jumlah,Harga,Barcode\nkg,Beras,10,12000,8991234\npcs,Sabun,5,,');
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { name: 'Beras', qty: '10', unit: 'kg', price: 12000, barcode: '8991234' },
    { name: 'Sabun', qty: '5', unit: 'pcs' }
  ]);
});

test('stockRowsFromCsv menerima nama header alternatif', () => {
  const { rows } = stockRowsFromCsv('barang,stok,unit\nGula,3,kg');
  assert.deepEqual(rows, [{ name: 'Gula', qty: '3', unit: 'kg' }]);
});

test('stockRowsFromCsv melaporkan header wajib yang hilang', () => {
  const { rows, errors } = stockRowsFromCsv('nama,jumlah\nBeras,10');
  assert.deepEqual(rows, []);
  assert.match(errors[0].message, /satuan/i);
});

test('stockRowsFromCsv melaporkan baris bermasalah dengan nomor baris, dan tetap memproses baris lain', () => {
  const { rows, errors } = stockRowsFromCsv('nama,jumlah,satuan\nBeras,10,kg\n,5,kg\nGula,abc,kg\nMinyak,2,liter');
  assert.deepEqual(rows.map((row) => row.name), ['Beras', 'Minyak']);
  assert.deepEqual(errors.map((error) => error.line), [3, 4]);
});

test('stockRowsFromCsv menolak harga yang bukan bilangan bulat positif', () => {
  const { rows, errors } = stockRowsFromCsv('nama,jumlah,satuan,harga\nBeras,10,kg,abc\nGula,3,kg,-5');
  assert.deepEqual(rows, []);
  assert.equal(errors.length, 2);
});

test('stockRowsFromCsv membatasi jumlah baris impor', () => {
  const body = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `Barang ${i},1,pcs`).join('\n');
  const { rows, errors } = stockRowsFromCsv('nama,jumlah,satuan\n' + body);
  assert.equal(rows.length, MAX_IMPORT_ROWS);
  assert.ok(errors.some((error) => /maksimal/i.test(error.message)));
});

test('stockRowsFromCsv pada berkas kosong melaporkan galat', () => {
  const { rows, errors } = stockRowsFromCsv('');
  assert.deepEqual(rows, []);
  assert.equal(errors.length, 1);
});
