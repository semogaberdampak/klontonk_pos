import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Daftar PRECACHE di sw.js ditulis manual. Tes ini memastikan tidak ada file aplikasi yang terlewat
// (aplikasi tidak bisa dibuka offline tanpanya) dan tidak ada entri yang menunjuk file yang sudah tidak ada.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

function precacheList() {
  const source = read('sw.js');
  const constants = Object.fromEntries([...source.matchAll(/const\s+([A-Z_]+)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  const body = source.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  return body.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith("'") ? entry.slice(1, -1) : constants[entry]));
}

function filesIn(dir, extension) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesIn(path, extension);
    return entry.name.endsWith(extension) ? [`./${path}`] : [];
  });
}

const listed = new Set(precacheList());

test('daftar precache berhasil dibaca dan berisi halaman utama', () => {
  assert.ok(listed.size > 20);
  assert.ok(listed.has('./index.html'));
  assert.ok(listed.has('./offline.html'));
  assert.ok(listed.has('./manifest.json'));
});

test('setiap entri precache menunjuk file yang ada', () => {
  const missing = [...listed].filter((path) => path !== './' && !existsSync(join(root, path)));
  assert.deepEqual(missing, []);
});

test('semua modul JavaScript aplikasi masuk precache', () => {
  const missing = filesIn('js', '.js').filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `belum di precache: ${missing.join(', ')}`);
});

test('semua stylesheet masuk precache', () => {
  const missing = filesIn('css', '.css').filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `belum di precache: ${missing.join(', ')}`);
});

test('semua file widget masuk precache', () => {
  const missing = filesIn('widgets', '.json').filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `belum di precache: ${missing.join(', ')}`);
});

test('semua stylesheet dan skrip yang dimuat index.html masuk precache', () => {
  const html = read('index.html');
  const assets = [...html.matchAll(/<(?:link[^>]+rel="stylesheet"[^>]+href|script[^>]+src)="([^"]+)"/g)]
    .map((m) => `./${m[1].split('?')[0]}`);
  assert.ok(assets.length > 0);
  const missing = assets.filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `belum di precache: ${missing.join(', ')}`);
});

test('ikon manifest masuk precache', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const icons = manifest.icons.map((icon) => `./${icon.src}`);
  const missing = icons.filter((path) => !listed.has(path));
  assert.deepEqual(missing, []);
});

test('file precache bukan direktori dan tidak kosong', () => {
  for (const path of listed) {
    if (path === './') continue;
    const stats = statSync(join(root, path));
    assert.ok(stats.isFile() && stats.size > 0, `${path} kosong atau bukan file`);
  }
});
