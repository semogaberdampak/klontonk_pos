// Antrean penjualan yang dibuat saat offline, disimpan di localStorage perangkat sampai berhasil
// dikirim ke Supabase (js/sync.js). Fungsi di sini tidak menyentuh jaringan dan tidak pernah mengubah
// data masukan; penyimpanan disuntikkan (createOutbox) agar bisa diuji tanpa browser.
//
// Bentuk satu entri:
//   { clientId (UUID, kunci idempotensi di database), tenant, userId, cashier, at (ISO 8601),
//     method: 'tunai' | 'nontunai', paid, expectedTotal (total pada struk offline),
//     lines: [{ id, name, unit, qty, price }], status: 'pending' | 'failed', attempts, error }

export const OUTBOX_KEY = 'klontonk:outbox:v1';
export const MAX_PENDING = 200;

const METHODS = ['tunai', 'nontunai'];
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;

export const linesTotal = (lines) => lines.reduce((sum, line) => sum + line.qty * line.price, 0);

const cleanLine = ({ id, name, unit, qty, price }) => ({ id, name, unit, qty, price });

// Mengembalikan { ok: true, entry } atau { ok: false, error }. `now` disuntikkan agar waktu bisa diuji.
export function buildEntry({ clientId, tenant, userId, cashier, method, paid, lines, now = new Date() }) {
  if (!METHODS.includes(method)) return { ok: false, error: 'Metode bayar tidak valid.' };
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'Keranjang kosong.' };
  if (!lines.every((line) => isPositiveInt(line.qty) && isPositiveInt(line.price))) {
    return { ok: false, error: 'Jumlah dan harga barang tidak valid.' };
  }

  const total = linesTotal(lines);
  if (method === 'tunai' && !(Number.isInteger(paid) && paid >= total)) {
    return { ok: false, error: 'Uang diterima kurang dari total.' };
  }

  return {
    ok: true,
    entry: {
      clientId, tenant, userId, cashier,
      at: now.toISOString(),
      method,
      paid: method === 'tunai' ? paid : total,
      expectedTotal: total,
      lines: lines.map(cleanLine),
      status: 'pending',
      attempts: 0,
      error: null
    }
  };
}

export function createOutbox(storage) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(OUTBOX_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  };

  // Mengembalikan true bila tersimpan; penyimpanan penuh / diblokir tidak melempar error.
  const write = (list) => {
    try {
      storage.setItem(OUTBOX_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      return false;
    }
  };

  const replace = (clientId, change) => write(read().flatMap((entry) => (entry.clientId === clientId ? change(entry) : [entry])));

  return {
    list: () => structuredClone(read()),

    add(entry) {
      const current = read();
      if (current.some((existing) => existing.clientId === entry.clientId)) return { ok: true };
      if (current.length >= MAX_PENDING) {
        return { ok: false, error: `Antrean offline penuh (${MAX_PENDING} penjualan). Sambungkan internet dulu agar terkirim.` };
      }
      return write([...current, entry])
        ? { ok: true }
        : { ok: false, error: 'Penyimpanan perangkat penuh atau diblokir; penjualan offline tidak bisa disimpan.' };
    },

    remove: (clientId) => replace(clientId, () => []),

    update: (clientId, patch) => replace(clientId, (entry) => [{ ...entry, ...patch }]),

    count: (status) => read().filter((entry) => !status || entry.status === status).length
  };
}
