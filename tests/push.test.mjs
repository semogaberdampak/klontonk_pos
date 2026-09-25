import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.mjs';

const env = installFakeBrowser();
const {
  urlBase64ToUint8Array, subscriptionKeys, pushStateOf,
  isPushSupported, getPushState, enablePush, disablePush, sendTestPush
} = await import('../js/push.js');

const ok = (data = null) => ({ data, error: null, status: 200 });
const failure = (code, message, status = 400) => ({ data: null, error: { code, message }, status });

const ENDPOINT = 'https://push.example/abc123';
const fakeSubscription = () => {
  const sub = {
    endpoint: ENDPOINT, unsubscribed: false,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'kunci-p256', auth: 'kunci-auth' } }),
    unsubscribe: async () => { sub.unsubscribed = true; return true; }
  };
  return sub;
};

// Lingkungan push tiruan: izin, pushManager, dan fetch untuk kunci publik.
const push = { current: null, subscribeCalls: [] };
let permission = 'default';
let fetchImpl;

function installPush() {
  push.current = null;
  push.subscribeCalls = [];
  permission = 'default';
  fetchImpl = async () => ({ ok: true, json: async () => ({ publicKey: 'AQID' }) });

  globalThis.window.PushManager = function PushManager() {};
  globalThis.Notification = {
    get permission() { return permission; },
    requestPermission: async () => { if (permission === 'default') permission = 'granted'; return permission; }
  };
  // Di browser sungguhan window === globalThis; di tes window objek terpisah, jadi samakan.
  globalThis.window.Notification = globalThis.Notification;
  globalThis.navigator.serviceWorker = {
    ready: Promise.resolve({
      pushManager: {
        getSubscription: async () => push.current,
        subscribe: async (options) => { push.subscribeCalls.push(options); push.current = fakeSubscription(); return push.current; }
      }
    })
  };
  globalThis.fetch = (...args) => fetchImpl(...args);
}

beforeEach(() => { env.reset(); installPush(); });

test('urlBase64ToUint8Array membaca base64 biasa dan base64url', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [251, 255]);
});

test('subscriptionKeys mengambil endpoint, p256dh, dan auth dari langganan browser', () => {
  assert.deepEqual(subscriptionKeys(fakeSubscription()), { endpoint: ENDPOINT, p256dh: 'kunci-p256', auth: 'kunci-auth' });
});

test('pushStateOf: tidak didukung, ditolak, mati, dan hidup', () => {
  assert.equal(pushStateOf({ supported: false }), 'unsupported');
  assert.equal(pushStateOf({ supported: true, permission: 'denied', subscribed: false }), 'denied');
  assert.equal(pushStateOf({ supported: true, permission: 'default', subscribed: false }), 'off');
  assert.equal(pushStateOf({ supported: true, permission: 'granted', subscribed: true }), 'on');
});

test('isPushSupported mengikuti keberadaan fitur browser', () => {
  assert.equal(isPushSupported(), true);
  delete globalThis.window.PushManager;
  assert.equal(isPushSupported(), false);
});

test('getPushState membaca langganan yang ada', async () => {
  assert.equal(await getPushState(), 'off');
  push.current = fakeSubscription();
  permission = 'granted';
  assert.equal(await getPushState(), 'on');
  permission = 'denied';
  assert.equal(await getPushState(), 'denied');
});

test('enablePush berhasil: minta izin, ambil kunci, berlangganan, dan mendaftarkan ke server', async () => {
  env.rpc(() => ok());
  const result = await enablePush();
  assert.deepEqual(result, { ok: true });
  assert.equal(push.subscribeCalls.length, 1);
  assert.equal(push.subscribeCalls[0].userVisibleOnly, true);
  assert.deepEqual([...push.subscribeCalls[0].applicationServerKey], [1, 2, 3]);
  assert.equal(env.calls[0].name, 'register_push_subscription');
  assert.deepEqual(env.calls[0].args, { p_endpoint: ENDPOINT, p_p256dh: 'kunci-p256', p_auth: 'kunci-auth' });
});

test('enablePush ditolak pengguna: tidak berlangganan dan tidak menghubungi server', async () => {
  permission = 'denied';
  const result = await enablePush();
  assert.equal(result.ok, false);
  assert.match(result.error, /izin/i);
  assert.equal(push.subscribeCalls.length, 0);
  assert.equal(env.calls.length, 0);
});

test('enablePush pada perangkat tanpa dukungan memberi pesan jelas', async () => {
  delete globalThis.window.PushManager;
  const result = await enablePush();
  assert.equal(result.ok, false);
  assert.match(result.error, /tidak mendukung/i);
});

test('enablePush: langganan lama dibuang dulu agar tidak bentrok kunci', async () => {
  const old = fakeSubscription();
  push.current = old;
  env.rpc(() => ok());
  await enablePush();
  assert.equal(old.unsubscribed, true);
});

test('enablePush gagal mendaftar di server: langganan dibatalkan agar tidak menggantung', async () => {
  env.rpc(() => failure('P0001', 'Terlalu banyak perangkat terdaftar (maksimal 10).'));
  const result = await enablePush();
  assert.equal(result.ok, false);
  assert.match(result.error, /maksimal 10/);
  assert.equal(push.current.unsubscribed, true);
});

test('enablePush gagal mengambil kunci publik: tidak berlangganan', async () => {
  fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const result = await enablePush();
  assert.equal(result.ok, false);
  assert.equal(push.subscribeCalls.length, 0);
});

test('disablePush melepas di server lalu di perangkat', async () => {
  const sub = fakeSubscription();
  push.current = sub;
  permission = 'granted';
  env.rpc(() => ok());
  const result = await disablePush();
  assert.deepEqual(result, { ok: true });
  assert.equal(env.calls[0].name, 'unregister_push_subscription');
  assert.deepEqual(env.calls[0].args, { p_endpoint: ENDPOINT });
  assert.equal(sub.unsubscribed, true);
});

test('disablePush tanpa langganan tidak melakukan apa pun', async () => {
  const result = await disablePush();
  assert.deepEqual(result, { ok: true });
  assert.equal(env.calls.length, 0);
});

test('sendTestPush membawa token pengguna dan melaporkan hasilnya', async () => {
  env.setSession({ user: { id: 'user-1' }, access_token: 'token-uji' });
  let sent;
  fetchImpl = async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ sent: 1, failed: 0 }) }; };
  const result = await sendTestPush();
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.headers.Authorization, 'Bearer token-uji');
  assert.deepEqual(JSON.parse(sent.options.body), { kind: 'test' });
});

test('sendTestPush tanpa perangkat terdaftar memberi pesan yang jelas', async () => {
  env.setSession({ user: { id: 'user-1' }, access_token: 'token-uji' });
  fetchImpl = async () => ({ ok: true, json: async () => ({ sent: 0, failed: 0 }) });
  const result = await sendTestPush();
  assert.equal(result.ok, false);
  assert.match(result.error, /belum ada perangkat/i);
});

test('sendTestPush tanpa sesi login ditolak', async () => {
  env.setSession(null);
  const result = await sendTestPush();
  assert.equal(result.ok, false);
});
