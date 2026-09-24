import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry, createOutbox, linesTotal, MAX_PENDING } from '../js/outbox.js';

const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
};

const lines = [
  { id: 'a', name: 'Beras', unit: 'kg', qty: 2, price: 7500 },
  { id: 'b', name: 'Gula', unit: 'kg', qty: 1, price: 15000 }
];

const base = {
  clientId: '11111111-1111-4111-8111-111111111111',
  tenant: 'T001',
  userId: 'user-1',
  cashier: 'Sari',
  method: 'tunai',
  paid: 50000,
  lines,
  now: new Date('2026-09-24T07:00:00.000Z')
};

test('linesTotal menjumlahkan qty x harga', () => {
  assert.equal(linesTotal(lines), 30000);
});

test('buildEntry membuat entri pending dengan total yang diharapkan', () => {
  const result = buildEntry(base);
  assert.equal(result.ok, true);
  assert.equal(result.entry.status, 'pending');
  assert.equal(result.entry.expectedTotal, 30000);
  assert.equal(result.entry.at, '2026-09-24T07:00:00.000Z');
  assert.equal(result.entry.attempts, 0);
});

test('buildEntry tidak menyimpan field di luar id, name, unit, qty, price pada baris', () => {
  const result = buildEntry({ ...base, lines: [{ ...lines[0], stock: 99, subtotal: 15000 }] });
  assert.deepEqual(Object.keys(result.entry.lines[0]).sort(), ['id', 'name', 'price', 'qty', 'unit']);
});

test('buildEntry nontunai memakai total sebagai uang diterima', () => {
  const result = buildEntry({ ...base, method: 'nontunai', paid: 0 });
  assert.equal(result.entry.paid, 30000);
});

test('buildEntry menolak keranjang kosong', () => {
  assert.equal(buildEntry({ ...base, lines: [] }).ok, false);
});

test('buildEntry menolak uang tunai kurang dari total', () => {
  const result = buildEntry({ ...base, paid: 29999 });
  assert.equal(result.ok, false);
  assert.match(result.error, /kurang/i);
});

test('buildEntry menolak metode tidak dikenal', () => {
  assert.equal(buildEntry({ ...base, method: 'kredit' }).ok, false);
});

test('buildEntry menolak jumlah atau harga bukan bilangan bulat positif', () => {
  assert.equal(buildEntry({ ...base, lines: [{ ...lines[0], qty: 0 }] }).ok, false);
  assert.equal(buildEntry({ ...base, lines: [{ ...lines[0], qty: 1.5 }] }).ok, false);
  assert.equal(buildEntry({ ...base, lines: [{ ...lines[0], price: -1 }] }).ok, false);
});

test('buildEntry tidak mengubah data masukan', () => {
  const input = structuredClone(base);
  buildEntry(input);
  assert.deepEqual(input, structuredClone(base));
});

test('outbox kosong saat penyimpanan belum berisi apa-apa', () => {
  assert.deepEqual(createOutbox(memoryStorage()).list(), []);
});

test('outbox tahan terhadap isi penyimpanan yang rusak', () => {
  const storage = memoryStorage({ 'klontonk:outbox:v1': '{bukan json' });
  assert.deepEqual(createOutbox(storage).list(), []);
});

test('add menyimpan entri dan list mengembalikannya', () => {
  const outbox = createOutbox(memoryStorage());
  const { entry } = buildEntry(base);
  assert.deepEqual(outbox.add(entry), { ok: true });
  assert.equal(outbox.list().length, 1);
  assert.equal(outbox.list()[0].clientId, base.clientId);
});

test('add dengan clientId yang sama tidak menggandakan entri', () => {
  const outbox = createOutbox(memoryStorage());
  const { entry } = buildEntry(base);
  outbox.add(entry);
  outbox.add(entry);
  assert.equal(outbox.list().length, 1);
});

test('list mengembalikan salinan, mengubahnya tidak memengaruhi antrean', () => {
  const outbox = createOutbox(memoryStorage());
  outbox.add(buildEntry(base).entry);
  outbox.list()[0].status = 'failed';
  assert.equal(outbox.list()[0].status, 'pending');
});

test('remove membuang entri menurut clientId', () => {
  const outbox = createOutbox(memoryStorage());
  outbox.add(buildEntry(base).entry);
  outbox.remove(base.clientId);
  assert.equal(outbox.list().length, 0);
});

test('update menggabungkan perubahan hanya ke entri yang dituju', () => {
  const outbox = createOutbox(memoryStorage());
  outbox.add(buildEntry(base).entry);
  outbox.add(buildEntry({ ...base, clientId: '22222222-2222-4222-8222-222222222222' }).entry);
  outbox.update(base.clientId, { status: 'failed', error: 'Stok habis' });
  const [first, second] = outbox.list();
  assert.equal(first.status, 'failed');
  assert.equal(first.error, 'Stok habis');
  assert.equal(second.status, 'pending');
});

test('count menghitung entri menurut status', () => {
  const outbox = createOutbox(memoryStorage());
  outbox.add(buildEntry(base).entry);
  outbox.add(buildEntry({ ...base, clientId: '22222222-2222-4222-8222-222222222222' }).entry);
  outbox.update(base.clientId, { status: 'failed' });
  assert.equal(outbox.count('pending'), 1);
  assert.equal(outbox.count('failed'), 1);
  assert.equal(outbox.count(), 2);
});

test('add menolak entri baru bila antrean penuh', () => {
  const outbox = createOutbox(memoryStorage());
  for (let i = 0; i < MAX_PENDING; i++) {
    outbox.add(buildEntry({ ...base, clientId: `id-${i}` }).entry);
  }
  const result = outbox.add(buildEntry({ ...base, clientId: 'id-overflow' }).entry);
  assert.equal(result.ok, false);
  assert.equal(outbox.list().length, MAX_PENDING);
});

test('add melaporkan gagal bila penyimpanan penuh, tanpa melempar error', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const result = createOutbox(storage).add(buildEntry(base).entry);
  assert.equal(result.ok, false);
});
