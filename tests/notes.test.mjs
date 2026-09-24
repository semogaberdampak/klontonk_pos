import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotes, MAX_NOTES, MAX_NOTE_LENGTH } from '../js/notes.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
};

const at = new Date('2026-09-24T07:00:00.000Z');

test('catatan kosong pada awalnya', () => {
  assert.deepEqual(createNotes(memoryStorage()).list(), []);
});

test('add menyimpan catatan dan list menampilkan yang terbaru lebih dulu', () => {
  const notes = createNotes(memoryStorage());
  notes.add('pertama', new Date('2026-09-24T07:00:00.000Z'));
  notes.add('kedua', new Date('2026-09-24T08:00:00.000Z'));
  assert.deepEqual(notes.list().map((note) => note.text), ['kedua', 'pertama']);
});

test('add merapikan spasi di ujung dan menolak teks kosong', () => {
  const notes = createNotes(memoryStorage());
  assert.equal(notes.add('   ', at).ok, false);
  assert.equal(notes.add('', at).ok, false);
  assert.equal(notes.add('  Serah terima shift  ', at).ok, true);
  assert.equal(notes.list()[0].text, 'Serah terima shift');
});

test('add menolak teks yang terlalu panjang', () => {
  const result = createNotes(memoryStorage()).add('a'.repeat(MAX_NOTE_LENGTH + 1), at);
  assert.equal(result.ok, false);
  assert.match(result.error, /maksimal/i);
});

test('add menolak bila jumlah catatan sudah penuh', () => {
  const notes = createNotes(memoryStorage());
  for (let i = 0; i < MAX_NOTES; i++) notes.add(`catatan ${i}`, at);
  const result = notes.add('kelebihan', at);
  assert.equal(result.ok, false);
  assert.equal(notes.list().length, MAX_NOTES);
});

test('setiap catatan punya id unik', () => {
  const notes = createNotes(memoryStorage());
  notes.add('a', at);
  notes.add('b', at);
  const ids = notes.list().map((note) => note.id);
  assert.equal(new Set(ids).size, 2);
});

test('remove membuang catatan menurut id', () => {
  const notes = createNotes(memoryStorage());
  notes.add('a', at);
  notes.add('b', at);
  const { id } = notes.list().find((note) => note.text === 'a');
  notes.remove(id);
  assert.deepEqual(notes.list().map((note) => note.text), ['b']);
});

test('list mengembalikan salinan', () => {
  const notes = createNotes(memoryStorage());
  notes.add('a', at);
  notes.list()[0].text = 'diubah';
  assert.equal(notes.list()[0].text, 'a');
});

test('tahan terhadap isi penyimpanan yang rusak', () => {
  const storage = memoryStorage();
  storage.setItem('klontonk:notes:v1', '{bukan json');
  assert.deepEqual(createNotes(storage).list(), []);
});

test('add melaporkan gagal bila penyimpanan menolak, tanpa melempar error', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const result = createNotes(storage).add('a', at);
  assert.equal(result.ok, false);
});
