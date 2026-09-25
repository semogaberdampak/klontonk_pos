import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotification, pickRecipients, isGone, timingSafeEqual, MAX_BODY } from '../supabase/functions/push/payload.js';

test('pengumuman memakai judul dan deskripsi info update, dikirim ke semua', () => {
  const note = buildNotification('announcement', { title: 'Fitur Baru', description: 'Cetak struk kini tersedia.' });
  assert.equal(note.title, 'Fitur Baru');
  assert.equal(note.body, 'Cetak struk kini tersedia.');
  assert.equal(note.audience, 'all');
  assert.equal(note.url, './index.html#/info-update');
});

test('pengumuman tanpa judul memakai judul bawaan', () => {
  assert.equal(buildNotification('announcement', {}).title, 'Info Klontonk');
  assert.equal(buildNotification('announcement', undefined).title, 'Info Klontonk');
});

test('penjualan perlu ditinjau berisi nomor dan catatan, hanya untuk admin', () => {
  const note = buildNotification('sale_review', { no: 'TRX-20260925-101500', review_note: 'Stok "Beras" kurang.' });
  assert.equal(note.title, 'Penjualan perlu ditinjau');
  assert.match(note.body, /TRX-20260925-101500/);
  assert.match(note.body, /Stok "Beras" kurang/);
  assert.equal(note.audience, 'admin');
  assert.equal(note.url, './index.html#/stok/keluar-laku');
});

test('jenis yang tidak dikenal menghasilkan null', () => {
  assert.equal(buildNotification('lain', {}), null);
  assert.equal(buildNotification(undefined, {}), null);
});

test('teks dirapikan: spasi dan baris baru diringkas, dan dipotong dengan elipsis', () => {
  const note = buildNotification('announcement', { title: '  Judul \n\t baru  ', description: 'x'.repeat(500) });
  assert.equal(note.title, 'Judul baru');
  assert.equal(note.body.length, MAX_BODY);
  assert.ok(note.body.endsWith('…'));
});

test('judul yang terlalu panjang dipotong', () => {
  assert.ok(buildNotification('announcement', { title: 'j'.repeat(200) }).title.length <= 60);
});

test('penerima admin hanya akun admin', () => {
  const subs = [{ endpoint: 'a', role: 'admin' }, { endpoint: 'b', role: 'cashier' }, { endpoint: 'c', role: 'admin' }];
  assert.deepEqual(pickRecipients(subs, 'admin').map((s) => s.endpoint), ['a', 'c']);
});

test('penerima semua mengembalikan seluruh langganan', () => {
  const subs = [{ endpoint: 'a', role: 'admin' }, { endpoint: 'b', role: 'cashier' }];
  assert.equal(pickRecipients(subs, 'all').length, 2);
});

test('audiens yang tidak dikenal tidak mengirim ke siapa pun (bawaan aman)', () => {
  assert.deepEqual(pickRecipients([{ endpoint: 'a', role: 'admin' }], 'lain'), []);
  assert.deepEqual(pickRecipients(undefined, 'all'), []);
});

test('langganan yang sudah tidak berlaku dikenali dari status 404 dan 410', () => {
  assert.equal(isGone(404), true);
  assert.equal(isGone(410), true);
  assert.equal(isGone(500), false);
  assert.equal(isGone(429), false);
  assert.equal(isGone(undefined), false);
});

test('perbandingan rahasia: sama benar, beda salah, panjang beda salah', () => {
  assert.equal(timingSafeEqual('abc123', 'abc123'), true);
  assert.equal(timingSafeEqual('abc123', 'abc124'), false);
  assert.equal(timingSafeEqual('abc', 'abc123'), false);
  assert.equal(timingSafeEqual('abc123', 'abc'), false);
});

test('rahasia kosong tidak pernah cocok, bahkan dengan kosong', () => {
  assert.equal(timingSafeEqual('', ''), false);
  assert.equal(timingSafeEqual('', 'abc'), false);
  assert.equal(timingSafeEqual(undefined, undefined), false);
});
