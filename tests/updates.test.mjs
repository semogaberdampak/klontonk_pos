import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.mjs';

const env = installFakeBrowser();
const { UpdateStore } = await import('../js/updates.js');

const ok = (data = null) => ({ data, error: null, status: 200 });
const failure = (code, message, status = 400) => ({ data: null, error: { code, message }, status });

const ROWS = [
  { id: 'U001', kind: 'update', title: 'Mode Terang Baru', description: 'Palet krem.', color: '#16A34A', sort_order: 1 },
  { id: 'U005', kind: 'update', title: 'Perbaikan Menu', description: null, color: '#0060AF', sort_order: 2 },
  { id: 'U006', kind: 'maintenance', title: 'Maintenance', description: 'Minggu 02.00', color: '#0060AF', sort_order: 1 }
];
const input = { kind: 'update', title: 'Fitur Baru', description: 'Penjelasan', color: '#16A34A' };

beforeEach(() => {
  env.reset();
  env.tables(() => ok(ROWS));
});

test('memuat: id kode teks dibaca apa adanya dan dikelompokkan per jenis', async () => {
  const result = await UpdateStore.load();
  assert.equal(result.success, true);
  assert.deepEqual(UpdateStore.list('update').map((row) => row.id), ['U001', 'U005']);
  assert.deepEqual(UpdateStore.list('maintenance').map((row) => row.id), ['U006']);
});

test('memuat: urut sort_order, lalu created_at, lalu id (id teks bukan pengurut utama)', async () => {
  await UpdateStore.load();
  const query = env.selects.find((item) => item.table === 'app_updates');
  assert.deepEqual(query.orders, ['sort_order', 'created_at', 'id']);
  assert.ok(query.columns.split(',').includes('id'));
});

test('menambah: TIDAK mengirim id (kode dibuat database) dan mengirim urutan berikutnya', async () => {
  await UpdateStore.load();
  const result = await UpdateStore.add(input);
  assert.equal(result.success, true);
  const [write] = env.writes;
  assert.equal(write.op, 'insert');
  assert.ok(!('id' in write.payload), 'klien tidak boleh menentukan id');
  assert.equal(write.payload.title, 'Fitur Baru');
  assert.equal(write.payload.sort_order, 3, 'sudah ada 2 info jenis update, jadi berikutnya 3');
});

test('menambah: setelah berhasil, daftar dimuat ulang dari database', async () => {
  await UpdateStore.load();
  const before = env.selects.length;
  await UpdateStore.add(input);
  assert.equal(env.selects.length, before + 1);
});

test('mengubah: memilih baris menurut kode dan tidak pernah mengirim id di isi perubahan', async () => {
  await UpdateStore.load();
  const result = await UpdateStore.update('U005', { ...input, title: 'Judul Baru' });
  assert.equal(result.success, true);
  const [write] = env.writes;
  assert.equal(write.op, 'update');
  assert.deepEqual(write.filters, [['id', 'U005']]);
  assert.ok(!('id' in write.payload));
  assert.equal(write.payload.title, 'Judul Baru');
});

test('menghapus: memilih baris menurut kode', async () => {
  await UpdateStore.load();
  const result = await UpdateStore.remove('U001');
  assert.equal(result.success, true);
  const [write] = env.writes;
  assert.equal(write.op, 'delete');
  assert.deepEqual(write.filters, [['id', 'U001']]);
});

test('input tidak valid ditolak di klien tanpa menghubungi database', async () => {
  assert.equal((await UpdateStore.add({ ...input, title: '   ' })).success, false);
  assert.equal((await UpdateStore.add({ ...input, kind: 'lain' })).success, false);
  assert.equal((await UpdateStore.add({ ...input, color: 'merah' })).success, false);
  assert.equal((await UpdateStore.add({ ...input, title: 'x'.repeat(81) })).success, false);
  assert.equal(env.writes.length, 0);
});

test('ditolak RLS (bukan admin): pesan yang jelas dan daftar tidak dimuat ulang', async () => {
  await UpdateStore.load();
  const before = env.selects.length;
  env.writeResult(() => failure('42501', 'new row violates row-level security policy', 403));
  const result = await UpdateStore.add(input);
  assert.equal(result.success, false);
  assert.match(result.error, /Hanya Admin/);
  assert.equal(env.selects.length, before);
});

test('database menolak perubahan kode (pemicu): galat ditampilkan apa adanya', async () => {
  env.writeResult(() => failure('P0001', 'Kode info (id) tidak boleh diubah.'));
  const result = await UpdateStore.update('U001', input);
  assert.equal(result.success, false);
  assert.match(result.error, /tidak boleh diubah/);
});

test('database kosong: memakai daftar bawaan agar popup sapaan tetap punya isi', async () => {
  env.tables(() => ok([]));
  await UpdateStore.load();
  assert.ok(UpdateStore.list('update').length > 0);
});
