// Pembantu pemformatan & escape bersama (sebelumnya disalin di tiap halaman). Fungsi murni, tanpa DOM.

// Escape teks untuk disisipkan ke HTML (isi elemen).
export const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Escape untuk nilai atribut HTML (menambah tanda kutip).
export const escAttr = (value) => esc(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const formatQty = (qty) => Number(qty).toLocaleString('id-ID');

export const formatRupiah = (amount) => 'Rp ' + Number(amount).toLocaleString('id-ID');

// Waktu singkat untuk daftar/tabel: "22 Sep, 10.30".
export const formatWhen = (iso) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Postgres mengembalikan waktu dengan 6 digit pecahan detik; ringkas jadi 3 (milidetik) agar Date() aman di semua browser.
export const isoMillis = (at) => String(at).replace(/(\.\d{3})\d+/, '$1');
