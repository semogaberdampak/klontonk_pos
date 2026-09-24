import { browserStorage } from './snapshot.js';

// Catatan kasir (mis. serah terima shift, pesan untuk kasir berikutnya). Disimpan di localStorage
// PERANGKAT INI saja, tidak dikirim ke database, jadi tidak ikut pindah ke perangkat lain.
// Penyimpanan disuntikkan (createNotes) agar bisa diuji tanpa browser.
//
// Bentuk satu catatan: { id, text, at (ISO 8601) }

const NOTES_KEY = 'klontonk:notes:v1';
export const MAX_NOTES = 100;
export const MAX_NOTE_LENGTH = 500;

export function createNotes(storage) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(NOTES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  };

  const write = (notes) => {
    try {
      storage.setItem(NOTES_KEY, JSON.stringify(notes));
      return true;
    } catch (err) {
      return false;
    }
  };

  const newId = (now, existing) => {
    let id;
    do {
      id = `n_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    } while (existing.some((note) => note.id === id));
    return id;
  };

  return {
    // Terbaru lebih dulu.
    list: () => structuredClone(read()).reverse().sort((a, b) => String(b.at).localeCompare(String(a.at))),

    // { ok: true } atau { ok: false, error }
    add(text, now = new Date()) {
      const clean = String(text ?? '').trim();
      if (!clean) return { ok: false, error: 'Catatan tidak boleh kosong.' };
      if (clean.length > MAX_NOTE_LENGTH) return { ok: false, error: `Catatan maksimal ${MAX_NOTE_LENGTH} karakter.` };

      const current = read();
      if (current.length >= MAX_NOTES) return { ok: false, error: `Jumlah catatan sudah penuh (${MAX_NOTES}). Hapus catatan lama dulu.` };

      const saved = write([...current, { id: newId(now, current), text: clean, at: now.toISOString() }]);
      return saved ? { ok: true } : { ok: false, error: 'Penyimpanan perangkat penuh atau diblokir; catatan tidak tersimpan.' };
    },

    remove(id) {
      return write(read().filter((note) => note.id !== id));
    }
  };
}

export const notes = typeof window === 'undefined' ? null : createNotes(browserStorage());
