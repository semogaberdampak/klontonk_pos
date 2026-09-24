// Pengaturan koneksi Supabase. Kedua nilai di bawah PUBLIK dan memang untuk dipasang di aplikasi web:
// keamanan data dijaga oleh RLS di database (db/schema.sql), bukan oleh kerahasiaan kunci ini.
// JANGAN pernah menaruh kunci "secret" / "service_role" di sini atau di file mana pun di repo.
export const SUPABASE_URL = 'https://bxynoilzdiqjiepdewnp.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_biqV-ZAK0T0B43KKyoQgSw_VOjb-GhC';

// Versi aplikasi (ditampilkan di menu akun).
export const APP_VERSION = '1.2.0';

// Login memakai username; Supabase Auth membutuhkan email, jadi username dipetakan ke <username>@domain ini.
export const EMAIL_DOMAIN = 'klontonk.local';
