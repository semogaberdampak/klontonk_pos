import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshots } from '../js/snapshot.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; }
  };
};

test('load mengembalikan null bila belum pernah disimpan', () => {
  assert.equal(createSnapshots(memoryStorage()).load('stock'), null);
});

test('save lalu load mengembalikan data dan waktu simpan', () => {
  const snapshots = createSnapshots(memoryStorage());
  const now = new Date('2026-09-24T07:00:00.000Z');
  assert.equal(snapshots.save('stock', { T001: [{ id: 'a', qty: 3 }] }, now), true);
  const loaded = snapshots.load('stock');
  assert.deepEqual(loaded.data, { T001: [{ id: 'a', qty: 3 }] });
  assert.equal(loaded.at.toISOString(), '2026-09-24T07:00:00.000Z');
});

test('load tahan terhadap isi yang rusak atau bentuknya salah', () => {
  const storage = memoryStorage();
  storage.setItem('klontonk:snapshot:stock', '{bukan json');
  assert.equal(createSnapshots(storage).load('stock'), null);
  storage.setItem('klontonk:snapshot:stock', JSON.stringify({ tanpa: 'data' }));
  assert.equal(createSnapshots(storage).load('stock'), null);
});

test('save melaporkan false bila penyimpanan menolak, tanpa melempar error', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(createSnapshots(storage).save('stock', {}), false);
});

test('save tidak membagi referensi dengan data asal', () => {
  const snapshots = createSnapshots(memoryStorage());
  const source = { T001: [{ id: 'a', qty: 3 }] };
  snapshots.save('stock', source);
  source.T001[0].qty = 99;
  assert.equal(snapshots.load('stock').data.T001[0].qty, 3);
});

test('clearAll hanya menghapus salinan, bukan kunci lain (mis. antrean offline)', () => {
  const storage = memoryStorage();
  storage.setItem('klontonk:outbox:v1', '[]');
  storage.setItem('klontonk:sb-auth', '{}');
  const snapshots = createSnapshots(storage);
  snapshots.save('stock', { T001: [] });
  snapshots.save('lain', { x: 1 });
  snapshots.clearAll();
  assert.equal(snapshots.load('stock'), null);
  assert.equal(snapshots.load('lain'), null);
  assert.equal(storage.getItem('klontonk:outbox:v1'), '[]');
  assert.equal(storage.getItem('klontonk:sb-auth'), '{}');
});
