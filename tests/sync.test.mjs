import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry, createOutbox } from '../js/outbox.js';
import { flushOutbox } from '../js/sync.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
};

const line = { id: 'a', name: 'Beras', unit: 'kg', qty: 1, price: 10000 };

function seed(specs) {
  const outbox = createOutbox(memoryStorage());
  for (const { clientId, userId = 'user-1' } of specs) {
    outbox.add(buildEntry({
      clientId, tenant: 'T001', userId, cashier: 'Sari', method: 'tunai',
      paid: 10000, lines: [line], now: new Date('2026-09-24T07:00:00.000Z')
    }).entry);
  }
  return outbox;
}

const okResult = (entry) => ({ ok: true, data: { no: `TRX-${entry.clientId}`, lines: entry.lines } });

test('mengirim semua entri pending urut dari yang terlama dan mengosongkan antrean', async () => {
  const outbox = seed([{ clientId: 'a1' }, { clientId: 'a2' }, { clientId: 'a3' }]);
  const order = [];
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async (entry) => { order.push(entry.clientId); return okResult(entry); }
  });
  assert.deepEqual(order, ['a1', 'a2', 'a3']);
  assert.equal(summary.synced.length, 3);
  assert.equal(summary.remaining, 0);
  assert.equal(outbox.list().length, 0);
});

test('berhenti saat jaringan putus dan menyisakan entri berikutnya', async () => {
  const outbox = seed([{ clientId: 'a1' }, { clientId: 'a2' }, { clientId: 'a3' }]);
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async (entry) => (entry.clientId === 'a2'
      ? { ok: false, code: 'network', status: 0, message: 'offline' }
      : okResult(entry))
  });
  assert.equal(summary.stopped, 'network');
  assert.deepEqual(summary.synced.map((s) => s.entry.clientId), ['a1']);
  assert.deepEqual(outbox.list().map((e) => e.clientId), ['a2', 'a3']);
  assert.equal(outbox.list()[0].attempts, 1);
  assert.equal(outbox.list()[0].status, 'pending');
});

test('penolakan server menandai entri gagal tetapi melanjutkan ke entri lain', async () => {
  const outbox = seed([{ clientId: 'a1' }, { clientId: 'a2' }]);
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async (entry) => (entry.clientId === 'a1'
      ? { ok: false, code: 'P0001', status: 400, message: 'Harga belum diisi.' }
      : okResult(entry))
  });
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.synced.length, 1);
  const [failed] = outbox.list();
  assert.equal(failed.clientId, 'a1');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Harga belum diisi.');
});

test('entri gagal tidak dikirim ulang otomatis', async () => {
  const outbox = seed([{ clientId: 'a1' }]);
  outbox.update('a1', { status: 'failed', error: 'x' });
  let calls = 0;
  await flushOutbox({ outbox, userId: 'user-1', send: async (e) => { calls++; return okResult(e); } });
  assert.equal(calls, 0);
});

test('hanya mengirim entri milik user yang sedang login', async () => {
  const outbox = seed([{ clientId: 'a1', userId: 'user-1' }, { clientId: 'b1', userId: 'user-2' }]);
  const sent = [];
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async (entry) => { sent.push(entry.clientId); return okResult(entry); }
  });
  assert.deepEqual(sent, ['a1']);
  assert.deepEqual(outbox.list().map((e) => e.clientId), ['b1']);
  assert.equal(summary.remaining, 0);
});

test('sesi berakhir menghentikan sinkron tanpa menandai entri gagal', async () => {
  const outbox = seed([{ clientId: 'a1' }, { clientId: 'a2' }]);
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async () => ({ ok: false, code: '', status: 401, message: 'jwt expired', expired: true })
  });
  assert.equal(summary.stopped, 'expired');
  assert.equal(outbox.count('failed'), 0);
  assert.equal(outbox.count('pending'), 2);
});

test('tidak mengirim apa pun saat perangkat offline', async () => {
  const outbox = seed([{ clientId: 'a1' }]);
  let calls = 0;
  const summary = await flushOutbox({
    outbox, userId: 'user-1', isOnline: () => false,
    send: async (e) => { calls++; return okResult(e); }
  });
  assert.equal(calls, 0);
  assert.equal(summary.stopped, 'offline');
  assert.equal(summary.remaining, 1);
});

test('send yang melempar error dianggap gangguan jaringan, entri tetap aman', async () => {
  const outbox = seed([{ clientId: 'a1' }]);
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async () => { throw new Error('boom'); }
  });
  assert.equal(summary.stopped, 'network');
  assert.equal(outbox.count('pending'), 1);
});

test('database belum diperbarui (fungsi tidak ditemukan) menahan entri tanpa menandai gagal', async () => {
  const outbox = seed([{ clientId: 'a1' }, { clientId: 'a2' }]);
  let calls = 0;
  const summary = await flushOutbox({
    outbox, userId: 'user-1',
    send: async () => { calls++; return { ok: false, code: 'PGRST202', status: 404, message: 'Could not find the function public.checkout' }; }
  });
  assert.equal(summary.stopped, 'schema');
  assert.equal(calls, 1, 'berhenti di entri pertama, tidak menembak semua entri');
  assert.equal(outbox.count('failed'), 0);
  assert.equal(outbox.count('pending'), 2);
  assert.equal(outbox.list()[0].attempts, 1);
});

test('antrean kosong menghasilkan ringkasan kosong', async () => {
  const summary = await flushOutbox({ outbox: seed([]), userId: 'user-1', send: async () => { throw new Error('tak boleh'); } });
  assert.deepEqual(summary, { synced: [], failed: [], remaining: 0, stopped: null });
});
