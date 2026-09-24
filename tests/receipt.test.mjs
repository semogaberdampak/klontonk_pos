import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptPrintHtml, createAutoPrintSetting } from '../js/receipt.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
};

const receipt = {
  no: 'TRX-20260924-101500',
  at: new Date('2026-09-24T03:15:00.000Z'),
  cashier: 'Sari',
  tenant: 'Cabang 1',
  lines: [
    { name: 'Beras', unit: 'kg', qty: 2, price: 10000 },
    { name: 'Gula Pasir', unit: 'kg', qty: 1, price: 15000 }
  ],
  itemCount: 3,
  total: 35000,
  method: 'tunai',
  paid: 50000,
  change: 15000,
  pending: false
};

test('struk memuat nama tenant, nomor, kasir, dan setiap barang', () => {
  const html = receiptPrintHtml(receipt);
  for (const text of ['Cabang 1', 'TRX-20260924-101500', 'Sari', 'Beras', 'Gula Pasir']) {
    assert.ok(html.includes(text), `harus memuat: ${text}`);
  }
});

test('jumlah per barang dihitung dari qty x harga, tidak bergantung pada field subtotal', () => {
  const html = receiptPrintHtml(receipt);
  assert.ok(html.includes('Rp 20.000'), 'Beras 2 x 10.000');
  assert.ok(html.includes('Rp 15.000'), 'Gula 1 x 15.000');
  assert.ok(!html.includes('NaN'), 'tidak boleh ada NaN');
});

test('tunai menampilkan total, uang diterima, dan kembalian', () => {
  const html = receiptPrintHtml(receipt);
  assert.ok(html.includes('Rp 35.000'));
  assert.ok(html.includes('Rp 50.000'));
  assert.ok(html.includes('Kembalian'));
  assert.ok(html.includes('Rp 15.000'));
});

test('nontunai menampilkan metode dan tidak menampilkan kembalian', () => {
  const html = receiptPrintHtml({ ...receipt, method: 'nontunai', paid: 35000, change: 0 });
  assert.ok(html.includes('QRIS / Transfer'));
  assert.ok(!html.includes('Kembalian'));
});

test('struk penjualan offline diberi catatan sementara', () => {
  const html = receiptPrintHtml({ ...receipt, no: 'OFF-27F69142', pending: true });
  assert.match(html, /sementara/i);
  assert.ok(html.includes('OFF-27F69142'));
});

test('struk biasa tidak memuat catatan sementara', () => {
  assert.doesNotMatch(receiptPrintHtml(receipt), /sementara/i);
});

test('teks dari data di-escape agar tidak bisa menyisipkan HTML', () => {
  const html = receiptPrintHtml({
    ...receipt,
    tenant: '<img src=x onerror=alert(1)>',
    cashier: '"><script>alert(1)</script>',
    lines: [{ name: '<b>Beras</b>', unit: 'kg', qty: 1, price: 1000 }]
  });
  assert.ok(!html.includes('<img'), 'tag img harus di-escape');
  assert.ok(!html.includes('<script'), 'tag script harus di-escape');
  assert.ok(!html.includes('<b>Beras'), 'tag b harus di-escape');
});

test('receiptPrintHtml tidak mengubah data masukan', () => {
  const input = structuredClone(receipt);
  receiptPrintHtml(input);
  assert.deepEqual(input, structuredClone(receipt));
});

test('cetak otomatis mati secara bawaan', () => {
  assert.equal(createAutoPrintSetting(memoryStorage()).isOn(), false);
});

test('cetak otomatis bisa dinyalakan lalu dimatikan lagi', () => {
  const setting = createAutoPrintSetting(memoryStorage());
  setting.set(true);
  assert.equal(setting.isOn(), true);
  setting.set(false);
  assert.equal(setting.isOn(), false);
});

test('pengaturan cetak otomatis tahan terhadap penyimpanan yang menolak', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('diblokir'); };
  storage.getItem = () => { throw new Error('diblokir'); };
  const setting = createAutoPrintSetting(storage);
  assert.doesNotThrow(() => setting.set(true));
  assert.equal(setting.isOn(), false);
});
