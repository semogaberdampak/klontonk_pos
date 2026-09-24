import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.mjs';

const env = installFakeBrowser();
const { SalesStore } = await import('../js/sales.js');

const SERVER_SALE = {
  no: 'TRX-20260924-101500', at: '2026-09-24T03:15:00.123456+00:00', cashier: 'Sari', method: 'tunai',
  total: 20000, paid: 50000, offline: false, review_note: null,
  lines: [{ id: 'beras', name: 'Beras', unit: 'kg', qty: 2, price: 10000 }]
};
const cartLines = [{ id: 'beras', name: 'Beras', unit: 'kg', qty: 2, price: 10000, stock: 10, subtotal: 20000 }];
const sell = () => SalesStore.checkout({ method: 'tunai', paid: 50000, lines: cartLines });

const ok = (data) => ({ data, error: null, status: 200 });
const failure = (code, message, status = 400) => ({ data: null, error: { code, message }, status });
const networkDown = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 });

beforeEach(() => env.reset());

test('penjualan online berhasil: mengirim client_id, hanya id dan qty, dan tidak masuk antrean', async () => {
  env.rpc(() => ok(SERVER_SALE));
  const result = await sell();
  assert.equal(result.success, true);
  assert.equal(result.sale.no, 'TRX-20260924-101500');
  assert.equal(result.offline, undefined);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].name, 'checkout');
  assert.match(env.calls[0].args.p_client_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(env.calls[0].args.p_lines, [{ id: 'beras', qty: 2 }]);
  assert.equal(env.outbox().length, 0);
});

test('fungsi checkout versi baru belum ada di database: memakai panggilan lama tanpa client_id', async () => {
  env.rpc((name, args) => ('p_client_id' in args ? failure('PGRST202', 'Could not find the function public.checkout', 404) : ok(SERVER_SALE)));
  const result = await sell();
  assert.equal(result.success, true);
  assert.equal(env.calls.length, 2);
  assert.ok('p_client_id' in env.calls[0].args);
  assert.ok(!('p_client_id' in env.calls[1].args), 'panggilan cadangan tidak boleh membawa parameter baru');
  assert.equal(env.outbox().length, 0);
});

test('jaringan putus: penjualan masuk antrean dengan nomor sementara dan tanda pending', async () => {
  env.rpc(networkDown);
  const result = await sell();
  assert.equal(result.success, true);
  assert.equal(result.offline, true);
  assert.equal(result.sale.pending, true);
  assert.match(result.sale.no, /^OFF-[0-9A-F]{8}$/);
  const [entry] = env.outbox();
  assert.equal(env.outbox().length, 1);
  assert.equal(entry.userId, 'user-1');
  assert.equal(entry.expectedTotal, 20000);
  assert.equal(entry.status, 'pending');
  assert.equal(entry.clientId, env.calls[0].args.p_client_id, 'client_id sama dengan yang dikirim saat percobaan online');
});

test('ditolak database (mis. stok kurang): tampil ke kasir dan TIDAK masuk antrean', async () => {
  env.rpc(() => failure('P0001', 'Stok "Beras" tinggal 1 kg.'));
  const result = await sell();
  assert.equal(result.success, false);
  assert.match(result.error, /Stok "Beras"/);
  assert.equal(env.outbox().length, 0);
});

test('offline tanpa sesi login: ditolak dengan pesan jelas, tidak ada yang tersimpan', async () => {
  env.rpc(networkDown);
  env.setSession(null);
  const result = await sell();
  assert.equal(result.success, false);
  assert.match(result.error, /sesi login/i);
  assert.equal(env.outbox().length, 0);
});

test('memuat riwayat: kolom baru belum ada (42703) memuat ulang tanpa kolom itu', async () => {
  const row = {
    tenant_id: 'T001', no: 'TRX-1', at: '2026-09-24T03:15:00.123456+00:00', cashier: 'Sari', method: 'tunai', total: 20000, paid: 50000,
    lines: [{ item_id: 'beras', name: 'Beras', unit: 'kg', qty: 2, price: 10000 }]
  };
  env.tables((table, columns) => (columns.includes('client_id')
    ? failure('42703', 'column sales.client_id does not exist')
    : ok([row])));
  const result = await SalesStore.load();
  assert.equal(result.success, true);
  const salesQueries = env.selects.filter((query) => query.table === 'sales');
  assert.equal(salesQueries.length, 2);
  assert.ok(salesQueries[0].columns.includes('client_id'));
  assert.ok(!salesQueries[1].columns.includes('client_id'));
  assert.equal(SalesStore.list().length, 1);
});

test('kirim antrean berhasil: memakai mode offline, membawa client_id dan total struk, lalu antrean kosong', async () => {
  env.rpc(networkDown);
  await sell();
  const queued = env.outbox()[0];

  env.rpc((name, args) => ok({ ...SERVER_SALE, offline: Boolean(args.p_offline) }));
  const summary = await SalesStore.flush();
  assert.equal(summary.synced.length, 1);
  assert.equal(summary.failed.length, 0);
  assert.equal(env.outbox().length, 0);

  const sent = env.calls.filter((call) => call.args.p_offline)[0].args;
  assert.equal(sent.p_client_id, queued.clientId);
  assert.equal(sent.p_expected_total, 20000);
  assert.equal(sent.p_at, queued.at);
  assert.deepEqual(sent.p_lines, [{ id: 'beras', qty: 2 }]);
});

test('kirim antrean saat database belum diperbarui: entri tetap menunggu, tidak ditandai gagal', async () => {
  env.rpc(networkDown);
  await sell();
  env.rpc(() => failure('PGRST202', 'Could not find the function public.checkout', 404));
  const summary = await SalesStore.flush();
  assert.equal(summary.stopped, 'schema');
  assert.equal(summary.synced.length, 0);
  assert.equal(env.outbox().length, 1);
  assert.equal(env.outbox()[0].status, 'pending');
});

test('kirim antrean ditolak database: ditandai gagal beserta alasannya', async () => {
  env.rpc(networkDown);
  await sell();
  env.rpc(() => failure('P0001', 'Harga "Beras" belum diisi.'));
  const summary = await SalesStore.flush();
  assert.equal(summary.failed.length, 1);
  assert.equal(env.outbox()[0].status, 'failed');
  assert.match(env.outbox()[0].error, /Harga "Beras"/);
});

test('kirim antrean tanpa internet: tidak ada permintaan yang dikirim', async () => {
  env.rpc(networkDown);
  await sell();
  const before = env.calls.length;
  env.setOnline(false);
  const summary = await SalesStore.flush();
  assert.equal(summary.stopped, 'offline');
  assert.equal(env.calls.length, before);
  assert.equal(env.outbox().length, 1);
});

test('dua pemanggilan flush bersamaan hanya mengirim sekali', async () => {
  env.rpc(networkDown);
  await sell();
  env.rpc(() => ok(SERVER_SALE));
  const [first, second] = await Promise.all([SalesStore.flush(), SalesStore.flush()]);
  assert.equal(first, second, 'pemanggil kedua memakai proses yang sama');
  assert.equal(env.calls.filter((call) => call.args.p_offline).length, 1);
});

test('retry mengembalikan entri gagal ke antrean dan mengirimnya lagi', async () => {
  env.rpc(networkDown);
  await sell();
  env.rpc(() => failure('P0001', 'Harga "Beras" belum diisi.'));
  await SalesStore.flush();
  const { clientId } = env.outbox()[0];

  env.rpc(() => ok(SERVER_SALE));
  const summary = await SalesStore.retry(clientId);
  assert.equal(summary.synced.length, 1);
  assert.equal(env.outbox().length, 0);
});

test('discard membuang entri dari antrean', async () => {
  env.rpc(networkDown);
  await sell();
  env.rpc(() => failure('P0001', 'Harga "Beras" belum diisi.'));
  await SalesStore.flush();
  await SalesStore.discard(env.outbox()[0].clientId);
  assert.equal(env.outbox().length, 0);
});
