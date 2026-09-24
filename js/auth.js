import { UI } from './ui.js';
import { EMAIL_DOMAIN } from './config.js';
import { db, run, signIn, signOut, signUpDetached, hasSession } from './supabase.js';

// ============ AUTHENTICATION SYSTEM ============
//
// Login memakai Supabase Auth (email + password); username dipetakan ke <username>@klontonk.local.
// Peran dan tenant tiap akun ada di tabel `profiles`. Keputusan akses dijaga oleh RLS di database
// (db/schema.sql); pengecekan di sini hanya untuk tampilan dan bisa dilewati siapa pun.
//
// - Password TIDAK pernah disimpan di aplikasi maupun tabel kita; hash dikelola Supabase Auth.
// - Token akses dipegang js/supabase.js dan diperbarui otomatis.
// - Session tampilan (nama, peran, tenant) ditandatangani device key acak agar edit manual localStorage terdeteksi.
// - Rate limiting: di browser (exponential backoff) dan di Supabase Auth.
// - Pesan error login selalu generik untuk mencegah user enumeration.
// - Sesi yang sudah masuk tetap dibuka saat offline; login baru butuh koneksi.

const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;
const PROFILE_COLUMNS = 'id,username,name,role,avatar,tenant:tenant_id';

const SESSION_KEY = 'klontonk_session';
const ACTIVITY_KEY = 'klontonk_last_activity';
const DEVICE_KEY_NAME = 'klontonk:devicekey';
const THROTTLE_KEY = 'klontonk:auth_throttle';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 menit

// ---- Crypto helpers (Web Crypto API + fallback murni JS) ----
const _encoder = new TextEncoder();

function _toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fallback SHA-256 murni JavaScript — dipakai saat crypto.subtle tidak tersedia
// (context non-secure, mis. akses dari HP via http://192.168.x.x:3000).
const _SHA256_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];

function _sha256Sync(str) {
  const msg = _encoder.encode(str);
  const l = msg.length;
  const bitLenHi = Math.floor((l * 8) / 4294967296);
  const bitLenLo = (l * 8) >>> 0;
  const paddedLen = (((l + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi);
  dv.setUint32(paddedLen - 4, bitLenLo);

  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Int32Array(64);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + _SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

async function _sha256(str) {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', _encoder.encode(str));
    return _toHex(buf);
  }
  console.warn('[Auth] crypto.subtle tidak tersedia (context non-secure) — memakai fallback SHA-256 JS.');
  return _sha256Sync(str);
}

function _randomSalt() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return _toHex(bytes);
  }
  // Fallback terakhir (jarang terjadi): PRNG berbasis Math.random
  let hex = '';
  for (let i = 0; i < 16; i++) hex += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return hex;
}

// ---- Storage helpers (aman terhadap storage yang diblokir/disabled) ----
function _storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function _storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* abaikan */ }
}
function _storageRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* abaikan */ }
}

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.updateActivityBound = this.updateActivity.bind(this);
    this.timeoutInterval = null;
    // _loadSession bersifat async (verifikasi signature) — status login hanya
    // VALID setelah app.js menunggu Auth.ready. Ini mencegah race condition
    // yang membuat user selalu "dilempar kembali" ke halaman login.
    this.ready = this._init();
  }

  async _init() {
    try {
      await this._loadSession();
    } catch (e) {
      console.error('[Auth] Gagal memuat session:', e);
      this._clearSession();
    }
    if (this.isAuthenticated()) {
      this.setupActivityListeners();
      this.startTimeoutCheck();
    }
  }

  // ============ Device Key (integritas session) ============
  _getDeviceKey() {
    let key = _storageGet(DEVICE_KEY_NAME);
    if (!key) {
      if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
        const bytes = new Uint8Array(32);
        globalThis.crypto.getRandomValues(bytes);
        key = _toHex(bytes);
      } else {
        key = String(Date.now()) + String(Math.random()).slice(2) + _randomSalt();
      }
      _storageSet(DEVICE_KEY_NAME, key);
    }
    return key;
  }

  async _signSession(sessionData) {
    // Signature = SHA-256(deviceKey + JSON). Session yang diedit manual via console
    // tidak akan punya signature cocok dan langsung ditolak saat load.
    const key = this._getDeviceKey();
    return _sha256(key + JSON.stringify(sessionData));
  }

  // ============ Rate Limiting ============
  _getThrottle() {
    try {
      return JSON.parse(_storageGet(THROTTLE_KEY) || '{"count":0,"lockedUntil":0}');
    } catch (e) {
      return { count: 0, lockedUntil: 0 };
    }
  }

  _setThrottle(t) {
    _storageSet(THROTTLE_KEY, JSON.stringify(t));
  }

  _isLockedOut() {
    return this._getThrottle().lockedUntil > Date.now();
  }

  _lockoutRemainingMs() {
    return Math.max(0, this._getThrottle().lockedUntil - Date.now());
  }

  _recordFailedAttempt() {
    const t = this._getThrottle();
    t.count += 1;
    // Exponential backoff: 3 gagal → 30s, 4 → 1m, 5 → 2m ... maks 15 menit
    if (t.count >= 3) {
      const lockMs = Math.min(30000 * Math.pow(2, t.count - 3), 15 * 60 * 1000);
      t.lockedUntil = Date.now() + lockMs;
    }
    this._setThrottle(t);
  }

  _resetThrottle() {
    _storageRemove(THROTTLE_KEY);
  }

  // ============ Session (signed) ============
  async _persistSession(sessionData) {
    const sig = await this._signSession(sessionData);
    this.currentUser = sessionData;
    _storageSet(SESSION_KEY, JSON.stringify({ ...sessionData, _sig: sig }));
    _storageSet(ACTIVITY_KEY, Date.now().toString());
  }

  async _loadSession() {
    const stored = _storageGet(SESSION_KEY);
    if (!stored) return;
    try {
      const data = JSON.parse(stored);
      const lastActivity = parseInt(_storageGet(ACTIVITY_KEY) || '0', 10);
      const now = Date.now();

      if (lastActivity && (now - lastActivity > SESSION_TIMEOUT_MS)) {
        this._clearSession();
        return;
      }

      // Tanpa sesi Supabase, data tidak bisa diambil: minta login ulang.
      if (!(await hasSession())) {
        this._clearSession();
        return;
      }

      // Verifikasi integritas — tolak session yang dimodifikasi manual
      const { _sig, ...sessionData } = data;
      const expected = await this._signSession(sessionData);
      if (!_sig || _sig !== expected) {
        this._clearSession();
        return;
      }

      this.currentUser = sessionData;
      _storageSet(ACTIVITY_KEY, now.toString());
    } catch (e) {
      this._clearSession();
    }
  }

  _clearSession() {
    this.currentUser = null;
    _storageRemove(SESSION_KEY);
    _storageRemove(ACTIVITY_KEY);
    signOut();
  }

  // Update aktivitas terakhir (dengan throttle 5 detik agar efisien)
  updateActivity() {
    if (!this.isAuthenticated()) return;
    const now = Date.now();
    const lastUpdate = parseInt(localStorage.getItem('klontonk_last_activity') || '0', 10);
    if (now - lastUpdate > 5000) {
      localStorage.setItem('klontonk_last_activity', now.toString());
    }
  }

  // Daftarkan event listener untuk interaksi pengguna
  setupActivityListeners() {
    const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, this.updateActivityBound, { passive: true });
    });
  }

  // Hentikan event listener interaksi
  removeActivityListeners() {
    const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.removeEventListener(event, this.updateActivityBound, { passive: true });
    });
  }

  // Periksa timeout session secara berkala (setiap 10 detik)
  startTimeoutCheck() {
    if (this.timeoutInterval) clearInterval(this.timeoutInterval);
    
    this.timeoutInterval = setInterval(() => {
      if (!this.isAuthenticated()) {
        clearInterval(this.timeoutInterval);
        return;
      }
      
      const lastActivity = parseInt(localStorage.getItem('klontonk_last_activity') || '0', 10);
      const now = Date.now();
      const timeoutDuration = 30 * 60 * 1000; // 30 menit
      
      if (lastActivity && (now - lastActivity > timeoutDuration)) {
        this.logout();
        clearInterval(this.timeoutInterval);
        
        UI.modal({
          title: 'Sesi Berakhir',
          message: 'Sesi Anda telah berakhir karena tidak ada aktivitas selama 30 menit. Silakan masuk kembali.',
          icon: 'warning',
          confirmText: 'OK',
          variant: 'primary'
        }).then(() => {
          window.location.reload();
        });
      }
    }, 10000);
  }

  // ============ Login ============
  // ASYNC. Mengembalikan { success } atau { success:false, error }.
  // Error selalu generik untuk mencegah user enumeration.
  async login(username, password) {
    // Rate limit check
    if (this._isLockedOut()) {
      const sisa = Math.ceil(this._lockoutRemainingMs() / 1000);
      return {
        success: false,
        error: `Terlalu banyak percobaan. Coba lagi dalam ${sisa} detik.`,
        locked: true
      };
    }

    const uname = String(username || '').trim().toLowerCase();
    if (!USERNAME_PATTERN.test(uname) || !password) {
      this._recordFailedAttempt();
      return { success: false, error: 'Username atau password salah.' };
    }

    const result = await signIn(`${uname}@${EMAIL_DOMAIN}`, String(password));
    if (!result.ok) {
      if (result.status === 429) return { success: false, error: 'Terlalu banyak percobaan. Coba lagi beberapa saat.', locked: true };
      if (result.status === 0) return { success: false, error: result.message };
      if (result.status >= 500) return { success: false, error: 'Layanan sedang bermasalah. Coba lagi sebentar.' };
      this._recordFailedAttempt();
      return { success: false, error: 'Username atau password salah.' };
    }

    // Akun Supabase Auth tanpa profil (mis. mendaftar sendiri) tidak punya akses apa pun.
    const found = await run(db.from('profiles').select(PROFILE_COLUMNS).eq('id', result.data.user.id));
    if (!found.ok || !found.data.length) {
      await signOut();
      return { success: false, error: found.ok ? 'Akun ini belum diberi akses. Hubungi admin.' : found.message };
    }

    // Sukses — reset throttle
    this._resetThrottle();
    const user = found.data[0];

    const sessionData = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      tenant: user.tenant,
      loginTime: new Date().toISOString()
    };

    await this._persistSession(sessionData);

    this.setupActivityListeners();
    this.startTimeoutCheck();

    return { success: true, user: this.currentUser };
  }

  // ============ Manajemen User (ADMIN ONLY) ============
  _requireAdmin() {
    if (!this.currentUser || this.currentUser.role !== 'admin') {
      return { ok: false, error: 'Akses ditolak. Fitur ini hanya untuk Admin.' };
    }
    return { ok: true };
  }

  // Hasil panggilan Supabase → bentuk { success, ... } yang dipakai halaman.
  _adminResult(result, onOk) {
    if (result.ok) return { success: true, ...onOk(result.data) };
    if (result.expired) return { success: false, expired: true, error: 'Sesi berakhir. Silakan login ulang.' };
    if (result.status === 403 || result.code === '42501') return { success: false, error: 'Akses ditolak. Fitur ini hanya untuk Admin.' };
    return { success: false, error: result.message };
  }

  // Daftar user — admin only (RLS: kasir hanya melihat profilnya sendiri)
  async listUsers() {
    const guard = this._requireAdmin();
    if (!guard.ok) return { success: false, error: guard.error };
    const result = await run(db.from('profiles').select(PROFILE_COLUMNS).order('created_at').order('username'));
    return this._adminResult(result, (data) => ({ users: data }));
  }

  // Tambah user — admin only. Akun dibuat lewat signUp terpisah (sesi admin tidak berubah), lalu profilnya
  // ditulis admin. Akun tanpa profil tidak punya akses apa pun, jadi kegagalan di tengah jalan aman.
  async createUser({ username, password, name, role = 'cashier', tenant = 'T001' } = {}) {
    const guard = this._requireAdmin();
    if (!guard.ok) return { success: false, error: guard.error };

    const uname = String(username || '').trim().toLowerCase();
    const fullName = String(name || '').trim();
    const fail = (error) => ({ success: false, error });

    if (!uname || !password || !fullName) return fail('Semua field wajib diisi.');
    if (!USERNAME_PATTERN.test(uname)) return fail('Username 3–24 karakter, hanya huruf kecil, angka, titik, underscore.');
    if (fullName.length > 60) return fail('Nama maksimal 60 karakter.');
    if (typeof password !== 'string' || password.length < 8) return fail('Password minimal 8 karakter.');
    if (password.length > 128) return fail('Password maksimal 128 karakter.');
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return fail('Password harus mengandung huruf dan angka.');
    if (password.toLowerCase().includes(uname)) return fail('Password tidak boleh mengandung username.');
    if (!['admin', 'cashier'].includes(role)) return fail('Role tidak valid.');
    if (!/^T\d{3}$/.test(String(tenant))) return fail('Tenant tidak valid.');

    const taken = await run(db.from('profiles').select('id').eq('username', uname));
    if (!taken.ok) return this._adminResult(taken, () => ({}));
    if (taken.data.length) return fail('Username sudah digunakan.');

    const signUp = await signUpDetached(`${uname}@${EMAIL_DOMAIN}`, password);
    if (!signUp.ok) {
      if (signUp.code === 'user_already_exists' || signUp.status === 422 || /duplicate|already/i.test(signUp.message)) {
        return fail('Username ini sudah pernah dipakai. Gunakan username lain.');
      }
      return fail(signUp.message);
    }

    const profile = {
      id: signUp.data.user.id,
      username: uname,
      name: fullName,
      role,
      avatar: Array.from(fullName)[0].toUpperCase(),
      tenant_id: String(tenant)
    };
    const saved = await run(db.from('profiles').insert(profile));
    if (!saved.ok) return this._adminResult(saved, () => ({}));
    return { success: true, user: { id: profile.id, username: uname, name: fullName, role, avatar: profile.avatar, tenant: profile.tenant_id } };
  }

  // Hapus user — admin only. Database menolak hapus diri sendiri / admin terakhir.
  async deleteUser(username) {
    const guard = this._requireAdmin();
    if (!guard.ok) return { success: false, error: guard.error };
    const uname = String(username || '').trim().toLowerCase();
    return this._adminResult(await run(db.rpc('delete_app_user', { p_username: uname })), () => ({}));
  }

  // Logout
  logout() {
    this.currentUser = null;
    localStorage.removeItem('klontonk_session');
    localStorage.removeItem('klontonk_last_activity');
    signOut();
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }
    this.removeActivityListeners();
  }

  // Check apakah user sudah login
  isAuthenticated() {
    return this.currentUser !== null;
  }

  // Get current user
  getCurrentUser() {
    return this.currentUser;
  }

  // Role helpers — dipakai untuk guard UI & routing
  isAdmin() {
    return this.currentUser !== null && this.currentUser.role === 'admin';
  }
}

export const Auth = new AuthManager();
