import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFromProtocol, searchFromShare, readLaunchIntent, createPendingSearch } from '../js/deeplink.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
};

test('protokol web+klontonk membuka rute yang ada di daftar aman', () => {
  assert.equal(routeFromProtocol('web+klontonk:kasir'), '#/kasir');
  assert.equal(routeFromProtocol('web+klontonk:stok'), '#/stok/total');
  assert.equal(routeFromProtocol('web+klontonk:catatan'), '#/catatan');
  assert.equal(routeFromProtocol('web+klontonk:beranda'), '#/beranda');
});

test('protokol menerima bentuk // dan garis miring akhir serta huruf besar', () => {
  assert.equal(routeFromProtocol('web+klontonk://kasir'), '#/kasir');
  assert.equal(routeFromProtocol('web+klontonk:kasir/'), '#/kasir');
  assert.equal(routeFromProtocol('WEB+KLONTONK:Kasir'), '#/kasir');
});

test('protokol menolak rute di luar daftar, protokol lain, dan upaya keluar jalur', () => {
  assert.equal(routeFromProtocol('web+klontonk:users'), null);
  assert.equal(routeFromProtocol('web+klontonk:../../x'), null);
  assert.equal(routeFromProtocol('web+klontonk:kasir?x=1'), null);
  assert.equal(routeFromProtocol('web+lain:kasir'), null);
  assert.equal(routeFromProtocol('javascript:alert(1)'), null);
  assert.equal(routeFromProtocol(''), null);
  assert.equal(routeFromProtocol(undefined), null);
});

test('berbagi memakai teks lebih dulu, lalu judul, lalu url', () => {
  assert.equal(searchFromShare({ title: 'Judul', text: 'Beras', url: 'https://x.id' }), 'Beras');
  assert.equal(searchFromShare({ title: 'Judul', text: '', url: 'https://x.id' }), 'Judul');
  assert.equal(searchFromShare({ url: 'https://x.id' }), 'https://x.id');
});

test('berbagi merapikan spasi, membuang karakter kontrol, dan membatasi panjang', () => {
  assert.equal(searchFromShare({ text: '  Gula   Pasir \n 1kg ' }), 'Gula Pasir 1kg');
  assert.equal(searchFromShare({ text: 'Be\u0000ras\u0007' }), 'Beras');
  assert.equal(searchFromShare({ text: 'a'.repeat(200) }).length, 60);
});

test('berbagi tanpa isi menghasilkan null', () => {
  assert.equal(searchFromShare({}), null);
  assert.equal(searchFromShare({ text: '   ', title: '' }), null);
  assert.equal(searchFromShare(undefined), null);
});

test('maksud peluncuran dari protokol', () => {
  assert.deepEqual(readLaunchIntent('?protocol=web%2Bklontonk%3Akasir'), { hash: '#/kasir' });
});

test('maksud peluncuran dari berbagi mengarah ke Kasir dengan pencarian', () => {
  assert.deepEqual(readLaunchIntent('?share_text=Beras%20Premium'), { hash: '#/kasir', search: 'Beras Premium' });
});

test('maksud peluncuran dari catatan baru', () => {
  assert.deepEqual(readLaunchIntent('?note=new'), { hash: '#/catatan' });
});

test('maksud peluncuran diabaikan bila tidak dikenal', () => {
  assert.equal(readLaunchIntent(''), null);
  assert.equal(readLaunchIntent('?foo=bar'), null);
  assert.equal(readLaunchIntent('?protocol=web%2Bklontonk%3Ausers'), null);
  assert.equal(readLaunchIntent('?note=lain'), null);
});

test('protokol lebih diutamakan daripada berbagi', () => {
  const intent = readLaunchIntent('?protocol=web%2Bklontonk%3Astok&share_text=Beras');
  assert.deepEqual(intent, { hash: '#/stok/total' });
});

test('pencarian tertunda diambil sekali lalu terhapus', () => {
  const pending = createPendingSearch(memoryStorage());
  assert.equal(pending.take(), null);
  pending.put('Beras');
  assert.equal(pending.take(), 'Beras');
  assert.equal(pending.take(), null);
});

test('pencarian tertunda tahan terhadap penyimpanan yang menolak', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('diblokir'); };
  storage.getItem = () => { throw new Error('diblokir'); };
  const pending = createPendingSearch(storage);
  assert.doesNotThrow(() => pending.put('Beras'));
  assert.equal(pending.take(), null);
});
