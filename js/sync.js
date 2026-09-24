// Mengirim antrean penjualan offline (js/outbox.js) ke database. `send` disuntikkan (SalesStore memakai
// RPC checkout) dan harus mengembalikan hasil ternormalisasi seperti js/supabase.js:
//   { ok: true, data } | { ok: false, code, status, message, expired }   (code 'network' = tidak ada jaringan)
//
// Aturan:
//   - Urut dari yang terlama; hanya entri milik user yang sedang login (kasir tercatat dari akun pengirim).
//   - Jaringan putus / sesi berakhir → berhenti, entri tetap 'pending' dan dicoba lagi nanti.
//   - Ditolak server (mis. harga belum diisi) → ditandai 'failed' dengan pesannya, lanjut ke entri lain;
//     entri gagal tidak dikirim ulang otomatis.

// Kode PostgREST: fungsi RPC dengan parameter itu tidak ada di database (skema belum diperbarui).
export const SCHEMA_MISSING = 'PGRST202';

export async function flushOutbox({ outbox, send, userId, isOnline = () => true }) {
  const summary = { synced: [], failed: [], remaining: 0, stopped: null };
  const queue = outbox.list().filter((entry) => entry.status === 'pending' && entry.userId === userId);

  for (const entry of queue) {
    if (!isOnline()) {
      summary.stopped = 'offline';
      break;
    }

    let result;
    try {
      result = await send(entry);
    } catch (err) {
      result = { ok: false, code: 'network', status: 0, message: String((err && err.message) || err) };
    }

    if (result.ok) {
      outbox.remove(entry.clientId);
      summary.synced.push({ entry, sale: result.data });
      continue;
    }

    if (result.expired) {
      summary.stopped = 'expired';
      break;
    }

    // Jaringan putus, atau database belum diperbarui (fungsi checkout versi baru belum ada): bukan salah
    // penjualannya, jadi entri tetap menunggu dan dicoba lagi nanti.
    if (result.code === 'network' || result.code === SCHEMA_MISSING) {
      outbox.update(entry.clientId, { attempts: entry.attempts + 1 });
      summary.stopped = result.code === 'network' ? 'network' : 'schema';
      break;
    }

    outbox.update(entry.clientId, { status: 'failed', error: result.message, attempts: entry.attempts + 1 });
    summary.failed.push({ entry, error: result.message });
  }

  summary.remaining = outbox.list().filter((entry) => entry.status === 'pending' && entry.userId === userId).length;
  return summary;
}
