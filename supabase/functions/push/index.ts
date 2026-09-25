// Edge Function `push`: mengirim Web Push.
//   GET                          → { publicKey }  kunci VAPID publik untuk klien (dibuat otomatis saat pertama dipakai)
//   POST { kind: 'test' }        → notifikasi uji ke perangkat milik pemanggil (butuh token login pengguna)
//   POST { kind, record }        → dari pemicu database (pg_net) dengan header x-push-secret; jenis: announcement, sale_review
// Kunci VAPID dan rahasia bersama disimpan di tabel push_config (tertutup untuk anon/authenticated).
// verify_jwt DIMATIKAN karena pemanggil dari database tidak membawa JWT pengguna; setiap jalur memeriksa
// otorisasinya sendiri (rahasia bersama, atau token pengguna untuk uji).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { buildNotification, pickRecipients, isGone, timingSafeEqual } from './payload.js';

const VAPID_SUBJECT = 'https://semogaberdampak.github.io/klontonk_pos/';
const PUSH_TTL_SECONDS = 3600;

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false }
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-push-secret, apikey, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Config = { webhook_secret: string; vapid_public: string; vapid_private: string };

// Baca konfigurasi; buat kunci VAPID bila belum ada. Hanya menulis bila masih kosong, jadi dua permintaan
// yang datang bersamaan tidak saling menimpa (yang kalah membaca ulang).
async function loadConfig(): Promise<Config> {
  const { data, error } = await supabase.from('push_config').select('*').eq('id', 1).maybeSingle();
  if (error || !data) throw new Error('push_config belum disiapkan');
  if (data.vapid_public && data.vapid_private) return data as Config;

  const keys = webpush.generateVAPIDKeys();
  const { data: written } = await supabase
    .from('push_config')
    .update({ vapid_public: keys.publicKey, vapid_private: keys.privateKey })
    .eq('id', 1)
    .is('vapid_public', null)
    .select('*')
    .maybeSingle();
  if (written) return written as Config;

  const { data: again, error: readError } = await supabase.from('push_config').select('*').eq('id', 1).single();
  if (readError || !again) throw new Error('Gagal membaca konfigurasi push');
  return again as Config;
}

async function send(targets: Array<{ endpoint: string; p256dh: string; auth: string }>, payload: string) {
  const results = await Promise.allSettled(
    targets.map((sub) =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: PUSH_TTL_SECONDS })
    )
  );

  const gone: string[] = [];
  let sent = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') sent += 1;
    else if (isGone((result.reason as { statusCode?: number })?.statusCode)) gone.push(targets[index].endpoint);
  });
  if (gone.length) await supabase.from('push_subscriptions').delete().in('endpoint', gone);
  return { sent, failed: targets.length - sent, removed: gone.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const config = await loadConfig();

    if (req.method === 'GET') return json({ publicKey: config.vapid_public });
    if (req.method !== 'POST') return json({ error: 'Metode tidak didukung' }, 405);

    webpush.setVapidDetails(VAPID_SUBJECT, config.vapid_public, config.vapid_private);
    const { kind, record } = await req.json().catch(() => ({}));
    const { data: subscriptions, error } = await supabase.from('push_subscriptions').select('endpoint,p256dh,auth,role,user_id');
    if (error) throw error;

    // Notifikasi uji: hanya ke perangkat milik pemanggil, diverifikasi dari token login.
    if (kind === 'test') {
      const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: userData } = await supabase.auth.getUser(token);
      if (!userData?.user) return json({ error: 'Tidak berwenang' }, 401);
      const own = (subscriptions ?? []).filter((sub) => sub.user_id === userData.user.id);
      const payload = JSON.stringify({ title: 'Notifikasi aktif', body: 'Perangkat ini akan menerima info dari Klontonk POS.', url: './index.html#/pengaturan', tag: 'test' });
      return json(await send(own, payload));
    }

    // Kejadian dari database: wajib membawa rahasia bersama.
    if (!timingSafeEqual(req.headers.get('x-push-secret') ?? '', config.webhook_secret)) return json({ error: 'Tidak berwenang' }, 401);

    const note = buildNotification(kind, record);
    if (!note) return json({ error: 'Jenis tidak dikenal' }, 400);
    const payload = JSON.stringify({ title: note.title, body: note.body, url: note.url, tag: note.tag });
    return json(await send(pickRecipients(subscriptions ?? [], note.audience), payload));
  } catch (err) {
    console.error('[push]', err);
    return json({ error: 'Galat internal' }, 500);
  }
});
