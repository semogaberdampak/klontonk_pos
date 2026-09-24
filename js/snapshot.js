// Salinan data terakhir yang berhasil dimuat dari database (mis. stok), disimpan di localStorage supaya
// aplikasi tetap bisa dibuka dan dipakai berjualan saat offline. Ini BUKAN sumber kebenaran: begitu online,
// data dimuat ulang dari Supabase dan salinan ikut diperbarui.
//
// Dihapus saat logout (Auth.logout) agar data stok tidak tertinggal di perangkat yang dipakai bergantian.
// Antrean penjualan offline (js/outbox.js) sengaja TIDAK ikut terhapus.

const PREFIX = 'klontonk:snapshot:';

export function createSnapshots(storage) {
  return {
    // true bila tersimpan; penyimpanan penuh / diblokir tidak melempar error.
    save(name, data, now = new Date()) {
      try {
        storage.setItem(PREFIX + name, JSON.stringify({ at: now.toISOString(), data }));
        return true;
      } catch (err) {
        return false;
      }
    },

    // { data, at: Date } atau null bila belum ada / rusak.
    load(name) {
      try {
        const parsed = JSON.parse(storage.getItem(PREFIX + name));
        if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !parsed.at) return null;
        return { data: parsed.data, at: new Date(parsed.at) };
      } catch (err) {
        return null;
      }
    },

    clearAll() {
      try {
        const names = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && key.startsWith(PREFIX)) names.push(key);
        }
        names.forEach((key) => storage.removeItem(key));
      } catch (err) {
        // penyimpanan tidak bisa diakses; tidak ada yang perlu dibersihkan
      }
    }
  };
}

// Instans yang dipakai aplikasi. localStorage bisa melempar error saat diakses (mode privat / diblokir),
// jadi penyimpanan cadangan di memori dipakai agar aplikasi tidak rusak.
export function browserStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    const memory = new Map();
    return {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => { memory.set(key, String(value)); },
      removeItem: (key) => { memory.delete(key); },
      key: (index) => [...memory.keys()][index] ?? null,
      get length() { return memory.size; }
    };
  }
}

export const snapshots = typeof window === 'undefined' ? null : createSnapshots(browserStorage());
