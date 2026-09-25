import { db, run, describeResult } from './supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Notifikasi push (Web Push) sisi halaman: izin, langganan perangkat, dan pendaftaran ke server.
// Alur: minta izin → ambil kunci VAPID publik dari Edge Function `push` → pushManager.subscribe →
// register_push_subscription() di database (peran dan tenant diambil dari profil pemanggil, bukan dari sini).
// Penerimaan notifikasinya ada di sw.js (event `push`); pengirimannya di supabase/functions/push.
//
// Privasi perangkat bersama: langganan dilepas dari perangkat saat logout (dropLocalPushSubscription),
// sehingga pengguna berikutnya tidak menerima notifikasi milik akun sebelumnya. Aktifkan lagi di Pengaturan.

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/push`;

// Kunci VAPID publik (base64url) → Uint8Array, format yang diminta pushManager.subscribe.
export function urlBase64ToUint8Array(base64) {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// Langganan browser → nilai yang dikirim ke database.
export function subscriptionKeys(subscription) {
  const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
  const keys = json.keys || {};
  return { endpoint: json.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

// 'unsupported' | 'denied' | 'off' | 'on'
export function pushStateOf({ supported, permission, subscribed }) {
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'denied';
  return subscribed ? 'on' : 'off';
}

export const isPushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const pushManager = async () => (await navigator.serviceWorker.ready).pushManager;

export async function getPushState() {
  const supported = isPushSupported();
  if (!supported) return pushStateOf({ supported });
  const subscription = await (await pushManager()).getSubscription();
  return pushStateOf({ supported, permission: Notification.permission, subscribed: Boolean(subscription) });
}

async function fetchPublicKey() {
  const response = await fetch(FUNCTION_URL, { headers: { apikey: SUPABASE_KEY } });
  if (!response.ok) throw new Error('Server notifikasi tidak menjawab. Coba lagi nanti.');
  const { publicKey } = await response.json();
  if (!publicKey) throw new Error('Kunci notifikasi tidak tersedia.');
  return publicKey;
}

// Mengembalikan { ok: true } atau { ok: false, error }.
export async function enablePush() {
  if (!isPushSupported()) return { ok: false, error: 'Perangkat atau browser ini tidak mendukung notifikasi.' };
  if ((await Notification.requestPermission()) !== 'granted') {
    return { ok: false, error: 'Izin notifikasi tidak diberikan. Ubah lewat pengaturan browser bila ingin mengaktifkannya.' };
  }

  let subscription = null;
  try {
    const manager = await pushManager();
    const key = urlBase64ToUint8Array(await fetchPublicKey());

    // Langganan lama (mis. kunci server berubah) membuat subscribe() gagal; mulai dari bersih.
    const existing = await manager.getSubscription();
    if (existing) await existing.unsubscribe();

    subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const { endpoint, p256dh, auth } = subscriptionKeys(subscription);
    const result = await run(db.rpc('register_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }));
    if (!result.ok) throw new Error(describeResult(result));
    return { ok: true };
  } catch (err) {
    // Jangan tinggalkan langganan di perangkat yang tidak terdaftar di server.
    if (subscription) await subscription.unsubscribe().catch(() => {});
    return { ok: false, error: (err && err.message) || 'Gagal mengaktifkan notifikasi.' };
  }
}

export async function disablePush() {
  try {
    const subscription = await (await pushManager()).getSubscription();
    if (!subscription) return { ok: true };
    await run(db.rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint }));
    await subscription.unsubscribe();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Gagal mematikan notifikasi.' };
  }
}

// Kirim notifikasi uji ke perangkat milik akun yang login (diverifikasi server dari token login).
export async function sendTestPush() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return { ok: false, error: 'Sesi login tidak ditemukan.' };

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ kind: 'test' })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.error || 'Gagal mengirim notifikasi uji.' };
    return body.sent > 0 ? { ok: true } : { ok: false, error: 'Belum ada perangkat terdaftar untuk akun ini.' };
  } catch (err) {
    return { ok: false, error: 'Server notifikasi tidak terjangkau.' };
  }
}

// Dipanggil saat logout: lepas langganan dari perangkat ini tanpa menunggu (server memangkas endpoint
// yang sudah tidak berlaku saat pengiriman berikutnya).
export function dropLocalPushSubscription() {
  if (!isPushSupported()) return;
  navigator.serviceWorker.getRegistration()
    .then((registration) => registration && registration.pushManager.getSubscription())
    .then((subscription) => subscription && subscription.unsubscribe())
    .catch(() => {});
}
