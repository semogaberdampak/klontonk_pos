// ============ LOGIKA KERANJANG & PEMBAYARAN ============
// Fungsi murni (tanpa DOM / penyimpanan) agar mudah diuji. Keranjang adalah
// Map<idBarang, jumlah>; tidak pernah diubah langsung — setiap perubahan mengembalikan Map baru.

export const MAX_PAYMENT = 1000000000;

// Barang bisa dijual bila punya harga dan masih ada stok.
export const isSellable = (item) =>
  Number.isInteger(item.price) && item.price > 0 && Number.isInteger(item.qty) && item.qty > 0;

// Menambah/mengurangi jumlah satu barang. Hasil dibatasi 0..stok; 0 = keluar dari keranjang.
export function changeQty(cart, item, delta) {
  const next = new Map(cart);
  const current = next.get(item.id) || 0;
  const qty = Math.max(0, Math.min(item.qty, current + delta));
  if (qty === 0) next.delete(item.id);
  else next.set(item.id, qty);
  return next;
}

export function removeLine(cart, id) {
  const next = new Map(cart);
  next.delete(id);
  return next;
}

// Baris keranjang dari data stok terkini. Barang yang sudah dihapus / kehilangan harga /
// habis otomatis dibuang, dan jumlah dipangkas ke stok yang tersisa.
export function buildLines(items, cart) {
  const lines = [];
  for (const item of items) {
    const wanted = cart.get(item.id);
    if (!wanted || !isSellable(item)) continue;
    const qty = Math.min(wanted, item.qty);
    lines.push({
      id: item.id,
      name: item.name,
      unit: item.unit,
      price: item.price,
      stock: item.qty,
      qty,
      subtotal: item.price * qty
    });
  }
  return lines;
}

export function sanitizeCart(items, cart) {
  return new Map(buildLines(items, cart).map((line) => [line.id, line.qty]));
}

export function summarize(lines) {
  return {
    lineCount: lines.length,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    total: lines.reduce((sum, line) => sum + line.subtotal, 0)
  };
}

// Selisih uang diterima dan total. Negatif = masih kurang.
export const balance = (total, paid) => paid - total;

// Usulan nominal uang tunai: uang pas + pembulatan ke atas ke pecahan umum (maks. 4 pilihan).
export function cashSuggestions(total) {
  if (!Number.isInteger(total) || total <= 0) return [];
  const rounded = [5000, 10000, 50000, 100000].map((step) => Math.ceil(total / step) * step);
  const unique = [...new Set([total, ...rounded])].filter((value) => value <= MAX_PAYMENT);
  return unique.sort((a, b) => a - b).slice(0, 4);
}

// Ambil angka dari teks isian ("1.250.000" → 1250000). Kosong/tidak valid → null.
export function parseAmount(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}
