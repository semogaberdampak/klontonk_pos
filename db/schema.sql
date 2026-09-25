-- Skema database Klontonk POS (PostgreSQL / Supabase): akun, stok, penjualan, dan retur.
-- Dijalankan sekali di SQL Editor Supabase (atau lewat psql). Aman diulang (IF NOT EXISTS / OR REPLACE).
--
-- MODEL KEAMANAN
--   * Login memakai Supabase Auth (email + password). Username dipetakan ke email <username>@klontonk.local.
--   * Pendaftaran Supabase Auth terbuka untuk umum, jadi akun tanpa baris di `profiles` TIDAK punya akses apa pun:
--     semua kebijakan RLS di bawah mensyaratkan baris profil.
--   * `profiles` hanya bisa ditulis admin. Penjualan hanya bisa dicatat lewat fungsi checkout().
--   * Tabel tidak dapat dibaca oleh peran `anon` (tanpa login).

BEGIN;

-- Migrasi dari versi lama: kolom dan fungsi yang tidak pernah dipakai aplikasi. Tidak berpengaruh di database baru.
ALTER TABLE IF EXISTS tenants     DROP COLUMN IF EXISTS code, DROP COLUMN IF EXISTS created_at;
ALTER TABLE IF EXISTS stock_items DROP COLUMN IF EXISTS updated_at;
DROP FUNCTION IF EXISTS public.app_tenant();

-- ---------------------------------------------------------------------------
-- Tenant (cabang) — sama dengan TenantStore._tenants di js/tenant.js.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id    text PRIMARY KEY CHECK (id ~ '^T[0-9]{3}$'),
  name  text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60)
);

INSERT INTO tenants (id, name) VALUES
  ('T001', 'Pusat'),
  ('T002', 'Warung Merah'),
  ('T003', 'Warung Putih')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Profil pengguna: peran dan tenant untuk tiap akun Supabase Auth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username    text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,24}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  role        text NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier')),
  avatar      text NOT NULL CHECK (char_length(avatar) = 1),
  tenant_id   text NOT NULL DEFAULT 'T001' REFERENCES tenants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_tenant_idx ON profiles (tenant_id);

-- ---------------------------------------------------------------------------
-- Stok & harga per tenant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_items (
  tenant_id  text NOT NULL REFERENCES tenants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id         text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  qty        integer NOT NULL CHECK (qty BETWEEN 0 AND 1000000),
  unit       text NOT NULL CHECK (unit IN ('pcs', 'kg', 'liter', 'pak', 'bungkus', 'dus', 'karung', 'renceng')),
  barcode    text CHECK (barcode IS NULL OR barcode ~ '^[A-Za-z0-9._-]{4,40}$'),
  price      integer CHECK (price IS NULL OR price BETWEEN 1 AND 100000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_name_uq    ON stock_items (tenant_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_barcode_uq ON stock_items (tenant_id, lower(barcode)) WHERE barcode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Riwayat penjualan (header + baris). Diisi hanya oleh checkout().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  tenant_id  text NOT NULL REFERENCES tenants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  no         text NOT NULL CHECK (no ~ '^TRX-[0-9]{8}-[0-9]{6}(-[0-9]{1,3})?$'),
  at         timestamptz NOT NULL DEFAULT now(),
  cashier    text NOT NULL CHECK (char_length(cashier) BETWEEN 1 AND 60),
  method     text NOT NULL CHECK (method IN ('tunai', 'nontunai')),
  total      integer NOT NULL CHECK (total >= 1),
  paid       integer NOT NULL CHECK (paid >= total AND paid <= 1000000000),
  PRIMARY KEY (tenant_id, no)
);
CREATE INDEX IF NOT EXISTS sales_at_idx ON sales (tenant_id, at DESC);

CREATE TABLE IF NOT EXISTS sale_lines (
  tenant_id  text NOT NULL,
  sale_no    text NOT NULL,
  item_id    text NOT NULL,
  name       text NOT NULL,
  unit       text NOT NULL,
  qty        integer NOT NULL CHECK (qty BETWEEN 1 AND 1000000),
  price      integer NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  PRIMARY KEY (tenant_id, sale_no, item_id),
  FOREIGN KEY (tenant_id, sale_no) REFERENCES sales (tenant_id, no) ON DELETE CASCADE
);

-- Penjualan offline: client_id = kunci idempotensi dari aplikasi, offline = dibuat saat perangkat offline,
-- review_note = selisih yang perlu ditinjau (stok kurang, total beda dari struk offline, dst).
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS client_id   uuid,
  ADD COLUMN IF NOT EXISTS offline     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500);
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_id_uq ON sales (tenant_id, client_id) WHERE client_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Retur stok. kind = 'pelanggan' (barang kembali ke stok, ada pengembalian uang) atau
-- 'supplier' (barang rusak / kedaluwarsa keluar dari stok, tanpa uang). Diisi hanya oleh process_return().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_returns (
  tenant_id  text NOT NULL REFERENCES tenants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  no         text NOT NULL CHECK (no ~ '^RTR-[0-9]{8}-[0-9]{6}(-[0-9]{1,3})?$'),
  at         timestamptz NOT NULL DEFAULT now(),
  cashier    text NOT NULL CHECK (char_length(cashier) BETWEEN 1 AND 60),
  kind       text NOT NULL CHECK (kind IN ('pelanggan', 'supplier')),
  item_id    text NOT NULL,
  name       text NOT NULL,
  unit       text NOT NULL,
  qty        integer NOT NULL CHECK (qty BETWEEN 1 AND 1000000),
  amount     integer NOT NULL DEFAULT 0 CHECK (amount BETWEEN 0 AND 1000000000),
  reason     text NOT NULL CHECK (reason IN ('rusak', 'kedaluwarsa', 'salah_barang', 'tidak_sesuai', 'lainnya')),
  note       text CHECK (note IS NULL OR char_length(note) <= 100),
  PRIMARY KEY (tenant_id, no)
);
CREATE INDEX IF NOT EXISTS stock_returns_at_idx   ON stock_returns (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS stock_returns_item_idx ON stock_returns (tenant_id, item_id, kind);

-- ---------------------------------------------------------------------------
-- Info Update: daftar perubahan aplikasi & info maintenance (popup sapaan + menu Info Update).
-- Semua user login boleh membaca; hanya admin yang boleh menambah / mengubah / menghapus.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_updates (
  id          text PRIMARY KEY CHECK (id ~ '^U[0-9]{3,}$'),   -- kode unik U001, U002, ... dibuat otomatis oleh pemicu
  kind        text NOT NULL CHECK (kind IN ('update', 'maintenance')),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  color       text NOT NULL DEFAULT '#0060AF' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Kode unik per info (U001, U002, ...). Dibuat OTOMATIS oleh pemicu: kode terkecil yang masih KOSONG dipakai lebih
-- dulu, jadi kode bekas info yang dihapus dipakai lagi dan hitungan tidak berlanjut terus. id kiriman klien
-- diabaikan (tidak bisa bentrok), dan setelah dibuat id tidak bisa diubah.

-- Migrasi dari versi lama (id angka identity): nomor lama dipertahankan (1 -> U001, 5 -> U005).
-- Tidak melakukan apa-apa bila id sudah berupa teks. Aman diulang.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'app_updates' AND column_name = 'id') = 'bigint' THEN
    ALTER TABLE public.app_updates ALTER COLUMN id DROP IDENTITY IF EXISTS;
    ALTER TABLE public.app_updates ALTER COLUMN id TYPE text
      USING ('U' || CASE WHEN id < 1000 THEN lpad(id::text, 3, '0') ELSE id::text END);
    ALTER TABLE public.app_updates ADD CONSTRAINT app_updates_id_format CHECK (id ~ '^U[0-9]{3,}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_update_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  -- Serialisasi: dua penambahan bersamaan tidak boleh memilih kode yang sama.
  PERFORM pg_advisory_xact_lock(hashtextextended('app_updates_code', 0));

  -- Kode terkecil yang belum dipakai. Dari 1..(jumlah+1) pasti ada yang kosong, jadi tidak pernah habis.
  SELECT min(g) INTO n
    FROM generate_series(1, (SELECT count(*) + 1 FROM public.app_updates)::integer) AS g
   WHERE NOT EXISTS (
     SELECT 1 FROM public.app_updates u
      WHERE u.id = ('U' || CASE WHEN g < 1000 THEN lpad(g::text, 3, '0') ELSE g::text END));

  NEW.id := 'U' || CASE WHEN n < 1000 THEN lpad(n::text, 3, '0') ELSE n::text END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.keep_update_code() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Kode info (id) tidak boleh diubah.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_updates_code ON app_updates;
CREATE TRIGGER app_updates_code BEFORE INSERT ON app_updates
  FOR EACH ROW EXECUTE FUNCTION public.set_update_code();
DROP TRIGGER IF EXISTS app_updates_code_keep ON app_updates;
CREATE TRIGGER app_updates_code_keep BEFORE UPDATE ON app_updates
  FOR EACH ROW EXECUTE FUNCTION public.keep_update_code();
REVOKE ALL ON FUNCTION public.set_update_code(), public.keep_update_code() FROM PUBLIC, anon, authenticated;
-- Sequence dari versi sebelumnya tidak dipakai lagi.
DROP SEQUENCE IF EXISTS app_updates_seq;

INSERT INTO app_updates (kind, title, description, color, sort_order)
SELECT * FROM (VALUES
  ('update', 'Mode Terang Baru', 'Palet krem hangat yang lebih nyaman dibaca sepanjang hari.', '#16A34A', 1),
  ('update', 'Tombol Logout Lebih Kontras', 'Sekarang tampil solid merah — lebih mudah ditemukan, lebih sulit salah tekan.', '#DC2626', 2),
  ('update', 'Perbaikan Menu Stok', 'Sub-menu Stok tidak lagi tertutup sendiri saat dibuka di layar kecil.', '#0060AF', 3),
  ('update', 'Navigasi Multi-Tenant', 'Pindah antar cabang tetap ringan langsung dari header.', '#F59E0B', 4),
  ('maintenance', 'Maintenance Terjadwal', 'Minggu, 02.00–03.00 WIB — sebagian fitur mungkin tidak tersedia sementara.', '#0060AF', 1),
  ('maintenance', 'Roadmap Berikutnya', 'Laporan kasir cetak dan sinkronisasi stok antar cabang.', '#0060AF', 2)
) AS seed(kind, title, description, color, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM app_updates);

-- ---------------------------------------------------------------------------
-- Pembantu RLS: peran pemanggil dan akses tenant, dibaca dari profil (bukan dari token).
-- SECURITY DEFINER agar bisa membaca `profiles` tanpa terkena RLS-nya sendiri.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;

-- Boleh mengakses data tenant tertentu: admin semua tenant, kasir hanya tenant sendiri.
CREATE OR REPLACE FUNCTION public.can_access_tenant(t text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT COALESCE((SELECT role = 'admin' OR tenant_id = t FROM public.profiles WHERE id = auth.uid()), false) $$;

-- Boleh MENULIS stok tenant tertentu: hanya akun kasir dari tenant itu sendiri. Admin hanya membaca stok
-- (stok tenant diinput oleh tenantnya sendiri; admin punya dashboard terpisah).
CREATE OR REPLACE FUNCTION public.is_tenant_cashier(t text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'cashier' AND tenant_id = t) $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE tenants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_read ON tenants;
CREATE POLICY tenants_read ON tenants FOR SELECT TO authenticated USING (public.app_role() IS NOT NULL);

DROP POLICY IF EXISTS updates_read ON app_updates;
CREATE POLICY updates_read ON app_updates FOR SELECT TO authenticated USING (public.app_role() IS NOT NULL);
DROP POLICY IF EXISTS updates_admin_insert ON app_updates;
CREATE POLICY updates_admin_insert ON app_updates FOR INSERT TO authenticated WITH CHECK (public.app_role() = 'admin');
DROP POLICY IF EXISTS updates_admin_update ON app_updates;
CREATE POLICY updates_admin_update ON app_updates FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin') WITH CHECK (public.app_role() = 'admin');
DROP POLICY IF EXISTS updates_admin_delete ON app_updates;
CREATE POLICY updates_admin_delete ON app_updates FOR DELETE TO authenticated USING (public.app_role() = 'admin');

DROP POLICY IF EXISTS profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.app_role() = 'admin');
DROP POLICY IF EXISTS profiles_admin_write ON profiles;
CREATE POLICY profiles_admin_write ON profiles FOR INSERT TO authenticated WITH CHECK (public.app_role() = 'admin');
DROP POLICY IF EXISTS profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin') WITH CHECK (public.app_role() = 'admin');

DROP POLICY IF EXISTS stock_select ON stock_items;
CREATE POLICY stock_select ON stock_items FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
-- Baca stok: admin semua tenant, kasir tenant sendiri. TULIS stok: hanya kasir tenant itu sendiri.
DROP POLICY IF EXISTS stock_insert ON stock_items;
CREATE POLICY stock_insert ON stock_items FOR INSERT TO authenticated WITH CHECK (public.is_tenant_cashier(tenant_id));
DROP POLICY IF EXISTS stock_update ON stock_items;
CREATE POLICY stock_update ON stock_items FOR UPDATE TO authenticated
  USING (public.is_tenant_cashier(tenant_id)) WITH CHECK (public.is_tenant_cashier(tenant_id));
DROP POLICY IF EXISTS stock_delete ON stock_items;
CREATE POLICY stock_delete ON stock_items FOR DELETE TO authenticated USING (public.is_tenant_cashier(tenant_id));

DROP POLICY IF EXISTS sales_select ON sales;
CREATE POLICY sales_select ON sales FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
DROP POLICY IF EXISTS sale_lines_select ON sale_lines;
CREATE POLICY sale_lines_select ON sale_lines FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));

DROP POLICY IF EXISTS returns_select ON stock_returns;
CREATE POLICY returns_select ON stock_returns FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));

-- Hak akses tabel: tanpa login (anon) tidak ada; pengguna login hanya yang diperlukan.
REVOKE ALL ON tenants, profiles, stock_items, sales, sale_lines, stock_returns FROM anon, authenticated;
GRANT SELECT ON tenants, sales, sale_lines, stock_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_updates TO authenticated;

-- Tanda tangan lama (4 argumen) dibuang agar tidak ada dua versi checkout().
DROP FUNCTION IF EXISTS public.checkout(text, text, integer, jsonb);

-- ---------------------------------------------------------------------------
-- checkout(): satu transaksi penjualan yang atomik.
--   * kunci baris stok (FOR UPDATE), periksa cukup, kurangi stok, hitung total dari HARGA DI DATABASE,
--     buat nomor transaksi, simpan header + baris, kembalikan struk sebagai jsonb.
--   * Bila satu barang saja tidak cukup / tidak ada / belum berharga, tidak ada yang berubah.
--   * p_client_id (UUID buatan aplikasi) membuat panggilan IDEMPOTEN: mengulang panggilan yang sama
--     (mis. respons hilang saat jaringan putus) mengembalikan penjualan yang sudah tercatat, bukan menggandakannya.
--   * p_offline = true untuk penjualan yang dibuat saat perangkat offline dan baru dikirim belakangan.
--     Barang sudah diserahkan dan uang sudah diterima, jadi penjualan TETAP dicatat walau ada selisih:
--       - stok kurang  → stok dipotong sampai 0 (tidak minus);
--       - total berbeda dari struk offline (p_expected_total) atau uang kurang → dicatat, harga tetap milik database;
--       - waktu jual (p_at) dipakai bila wajar (maks 30 hari lalu, tidak di masa depan).
--     Semua selisih ditulis ke sales.review_note agar bisa ditinjau. Harga TIDAK pernah dipercaya dari perangkat.
--     Barang yang sudah dihapus / belum berharga tetap ditolak (tidak bisa dicatat dengan benar).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checkout(
  p_tenant text, p_method text, p_paid integer, p_lines jsonb,
  p_client_id uuid DEFAULT NULL, p_offline boolean DEFAULT false,
  p_at timestamptz DEFAULT NULL, p_expected_total integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_now     timestamptz := now();
  v_at      timestamptz := now();
  v_cashier text;
  v_total   bigint := 0;
  v_count   integer;
  v_found   integer := 0;
  v_base    text;
  v_no      text;
  v_suffix  integer := 1;
  v_paid    integer;
  v_lines   jsonb := '[]'::jsonb;
  v_notes   text[] := ARRAY[]::text[];
  v_note    text;
  v_existing public.sales%ROWTYPE;
  r         record;
BEGIN
  IF v_uid IS NULL OR public.app_role() IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Tidak punya akses ke tenant ini.' USING ERRCODE = '42501';
  END IF;
  IF p_method NOT IN ('tunai', 'nontunai') THEN
    RAISE EXCEPTION 'Metode bayar tidak valid.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Keranjang tidak valid.' USING ERRCODE = '22023';
  END IF;

  -- Idempotensi: panggilan kedua dengan client_id yang sama menunggu yang pertama, lalu mengembalikan hasilnya.
  IF p_client_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant || ':' || p_client_id::text, 0));
    SELECT * INTO v_existing FROM public.sales WHERE tenant_id = p_tenant AND client_id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'no', v_existing.no, 'at', v_existing.at, 'cashier', v_existing.cashier, 'method', v_existing.method,
        'total', v_existing.total, 'paid', v_existing.paid,
        'offline', v_existing.offline, 'review_note', v_existing.review_note,
        'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.item_id, 'name', l.name, 'unit', l.unit,
                                                                'qty', l.qty, 'price', l.price) ORDER BY l.item_id), '[]'::jsonb)
                    FROM public.sale_lines l WHERE l.tenant_id = p_tenant AND l.sale_no = v_existing.no));
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_lines);
  IF v_count < 1 OR v_count > 200
     OR v_count <> (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_lines) e)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e
                WHERE (e->>'id') IS NULL OR (e->>'qty') !~ '^[0-9]{1,7}$' OR (e->>'qty')::int < 1) THEN
    RAISE EXCEPTION 'Keranjang tidak valid.' USING ERRCODE = '22023';
  END IF;

  IF p_offline AND p_at IS NOT NULL THEN
    IF p_at <= v_now + interval '5 minutes' AND p_at >= v_now - interval '30 days' THEN
      v_at := LEAST(p_at, v_now);
    ELSE
      v_notes := array_append(v_notes, 'Waktu dari perangkat tidak wajar, memakai waktu sinkron.');
    END IF;
  END IF;

  FOR r IN
    SELECT s.id, s.name, s.unit, s.qty, s.price, q.want
    FROM public.stock_items s
    JOIN (SELECT e->>'id' AS id, (e->>'qty')::int AS want FROM jsonb_array_elements(p_lines) e) q ON q.id = s.id
    WHERE s.tenant_id = p_tenant
    ORDER BY s.id
    FOR UPDATE OF s
  LOOP
    v_found := v_found + 1;
    IF r.price IS NULL THEN
      RAISE EXCEPTION 'Harga "%" belum diisi.', r.name USING ERRCODE = 'P0001';
    END IF;
    IF r.qty < r.want THEN
      IF NOT p_offline THEN
        RAISE EXCEPTION 'Stok "%" tinggal % %.', r.name, r.qty, r.unit USING ERRCODE = 'P0001';
      END IF;
      v_notes := array_append(v_notes, format('Stok "%s" kurang: tersedia %s %s, terjual %s.', r.name, r.qty, r.unit, r.want));
    END IF;
    v_total := v_total + r.want::bigint * r.price;
    v_lines := v_lines || jsonb_build_object('id', r.id, 'name', r.name, 'unit', r.unit, 'qty', r.want, 'price', r.price);
  END LOOP;

  IF v_found <> v_count THEN
    RAISE EXCEPTION 'Ada barang yang sudah tidak ada di daftar stok.' USING ERRCODE = 'P0001';
  END IF;
  IF v_total < 1 OR v_total > 1000000000 THEN
    RAISE EXCEPTION 'Total belanja tidak valid.' USING ERRCODE = '22023';
  END IF;

  IF p_offline AND p_expected_total IS NOT NULL AND p_expected_total <> v_total THEN
    v_notes := array_append(v_notes, format('Total struk offline Rp %s berbeda dari total database Rp %s.', p_expected_total, v_total));
  END IF;

  v_paid := CASE WHEN p_method = 'tunai' THEN p_paid ELSE v_total::int END;
  IF v_paid IS NULL OR v_paid < v_total THEN
    IF NOT p_offline OR v_paid IS NULL OR v_paid < 1 THEN
      RAISE EXCEPTION 'Uang diterima kurang dari total.' USING ERRCODE = 'P0001';
    END IF;
    v_notes := array_append(v_notes, format('Uang diterima Rp %s kurang dari total database Rp %s.', v_paid, v_total));
    v_paid := v_total::int;
  END IF;
  IF v_paid > 1000000000 THEN
    RAISE EXCEPTION 'Uang diterima terlalu besar.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.stock_items s
     SET qty = GREATEST(s.qty - q.want, 0)
    FROM (SELECT e->>'id' AS id, (e->>'qty')::int AS want FROM jsonb_array_elements(p_lines) e) q
   WHERE s.tenant_id = p_tenant AND s.id = q.id;

  SELECT left(regexp_replace(name, '[^[:alnum:] .,''()&/+-]', '', 'g'), 60) INTO v_cashier
    FROM public.profiles WHERE id = v_uid;
  v_cashier := COALESCE(NULLIF(btrim(v_cashier), ''), 'Kasir');
  v_note := NULLIF(left(array_to_string(v_notes, ' '), 500), '');

  -- Nomor: TRX-YYYYMMDD-HHMMSS (waktu Jakarta); bila bentrok di detik yang sama, akhiran -2, -3, ...
  v_base := 'TRX-' || to_char(v_at AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD-HH24MISS');
  LOOP
    v_no := CASE WHEN v_suffix = 1 THEN v_base ELSE v_base || '-' || v_suffix END;
    BEGIN
      INSERT INTO public.sales (tenant_id, no, at, cashier, method, total, paid, client_id, offline, review_note)
      VALUES (p_tenant, v_no, v_at, v_cashier, p_method, v_total::int, v_paid, p_client_id, p_offline, v_note);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_suffix := v_suffix + 1;
      IF v_suffix > 999 THEN RAISE EXCEPTION 'Gagal membuat nomor transaksi.' USING ERRCODE = 'P0001'; END IF;
    END;
  END LOOP;

  INSERT INTO public.sale_lines (tenant_id, sale_no, item_id, name, unit, qty, price)
  SELECT p_tenant, v_no, l->>'id', l->>'name', l->>'unit', (l->>'qty')::int, (l->>'price')::int
    FROM jsonb_array_elements(v_lines) l;

  RETURN jsonb_build_object('no', v_no, 'at', v_at, 'cashier', v_cashier, 'method', p_method,
                            'total', v_total::int, 'paid', v_paid, 'offline', p_offline, 'review_note', v_note,
                            'lines', v_lines);
END;
$$;

-- ---------------------------------------------------------------------------
-- process_return(): satu retur yang atomik untuk satu barang.
--   pelanggan: stok bertambah; nilai = jumlah x harga saat ini; jumlah kumulatif retur pelanggan tidak boleh
--              melebihi jumlah yang pernah terjual (sale_lines) untuk barang itu.
--   supplier : stok berkurang (tidak boleh melebihi stok); nilai 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_return(p_tenant text, p_kind text, p_item_id text, p_qty integer, p_reason text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_at      timestamptz := now();
  v_item    public.stock_items%ROWTYPE;
  v_note    text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_cashier text;
  v_amount  bigint := 0;
  v_after   integer;
  v_sold    bigint;
  v_back    bigint;
  v_base    text;
  v_no      text;
  v_suffix  integer := 1;
BEGIN
  IF v_uid IS NULL OR public.app_role() IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Tidak punya akses ke tenant ini.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('pelanggan', 'supplier') THEN
    RAISE EXCEPTION 'Jenis retur tidak valid.' USING ERRCODE = '22023';
  END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 1000000 THEN
    RAISE EXCEPTION 'Jumlah retur harus bilangan bulat 1 – 1.000.000.' USING ERRCODE = '22023';
  END IF;
  IF p_reason NOT IN ('rusak', 'kedaluwarsa', 'salah_barang', 'tidak_sesuai', 'lainnya')
     OR (p_kind = 'pelanggan' AND p_reason = 'kedaluwarsa')
     OR (p_kind = 'supplier'  AND p_reason IN ('salah_barang', 'tidak_sesuai')) THEN
    RAISE EXCEPTION 'Alasan retur tidak valid.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 100 THEN
    RAISE EXCEPTION 'Catatan maksimal 100 karakter.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.stock_items WHERE tenant_id = p_tenant AND id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barang tidak ditemukan di daftar stok.' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind = 'pelanggan' THEN
    IF v_item.price IS NULL THEN
      RAISE EXCEPTION 'Harga "%" belum diisi.', v_item.name USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(sum(qty), 0) INTO v_sold FROM public.sale_lines WHERE tenant_id = p_tenant AND item_id = p_item_id;
    SELECT COALESCE(sum(qty), 0) INTO v_back FROM public.stock_returns WHERE tenant_id = p_tenant AND item_id = p_item_id AND kind = 'pelanggan';
    IF v_back + p_qty > v_sold THEN
      RAISE EXCEPTION 'Retur melebihi yang pernah terjual: terjual % %, sudah diretur % %.', v_sold, v_item.unit, v_back, v_item.unit USING ERRCODE = 'P0001';
    END IF;
    v_after  := v_item.qty + p_qty;
    v_amount := p_qty::bigint * v_item.price;
    IF v_after > 1000000 OR v_amount > 1000000000 THEN
      RAISE EXCEPTION 'Jumlah retur terlalu besar.' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_qty > v_item.qty THEN
      RAISE EXCEPTION 'Stok "%" tinggal % %.', v_item.name, v_item.qty, v_item.unit USING ERRCODE = 'P0001';
    END IF;
    v_after := v_item.qty - p_qty;
  END IF;

  UPDATE public.stock_items SET qty = v_after WHERE tenant_id = p_tenant AND id = p_item_id;

  SELECT left(regexp_replace(name, '[^[:alnum:] .,''()&/+-]', '', 'g'), 60) INTO v_cashier FROM public.profiles WHERE id = v_uid;
  v_cashier := COALESCE(NULLIF(btrim(v_cashier), ''), 'Kasir');

  v_base := 'RTR-' || to_char(v_at AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD-HH24MISS');
  LOOP
    v_no := CASE WHEN v_suffix = 1 THEN v_base ELSE v_base || '-' || v_suffix END;
    BEGIN
      INSERT INTO public.stock_returns (tenant_id, no, at, cashier, kind, item_id, name, unit, qty, amount, reason, note)
      VALUES (p_tenant, v_no, v_at, v_cashier, p_kind, p_item_id, v_item.name, v_item.unit, p_qty, v_amount::int, p_reason, v_note);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_suffix := v_suffix + 1;
      IF v_suffix > 999 THEN RAISE EXCEPTION 'Gagal membuat nomor retur.' USING ERRCODE = 'P0001'; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('no', v_no, 'at', v_at, 'cashier', v_cashier, 'kind', p_kind, 'item_id', p_item_id,
                            'name', v_item.name, 'unit', v_item.unit, 'qty', p_qty, 'amount', v_amount::int,
                            'reason', p_reason, 'note', v_note, 'stock_after', v_after);
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_app_user(): hapus akun (admin saja). Tidak boleh diri sendiri atau admin terakhir.
-- Menghapus baris auth.users (profil ikut terhapus lewat ON DELETE CASCADE) agar username bisa dipakai lagi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_app_user(p_username text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
BEGIN
  IF public.app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Akses ditolak. Fitur ini hanya untuk Admin.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE username = lower(btrim(p_username));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;
  IF v_target.id = auth.uid() THEN
    RAISE EXCEPTION 'Tidak bisa menghapus akun Anda sendiri.' USING ERRCODE = 'P0001';
  END IF;
  IF v_target.role = 'admin' AND (SELECT count(*) FROM public.profiles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'Minimal harus ada satu Admin.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM auth.users WHERE id = v_target.id;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout(text, text, integer, jsonb, uuid, boolean, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout(text, text, integer, jsonb, uuid, boolean, timestamptz, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.process_return(text, text, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_return(text, text, text, integer, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_app_user(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_app_user(text) TO authenticated;
REVOKE ALL ON FUNCTION public.app_role(), public.can_access_tenant(text), public.is_tenant_cashier(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_role(), public.can_access_tenant(text), public.is_tenant_cashier(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Notifikasi push (Web Push). Alur: perangkat mendaftar lewat register_push_subscription(); pemicu di bawah
-- memanggil Edge Function `push` lewat pg_net; fungsi itu yang menandatangani (VAPID) dan mengirim.
--   * push_config: alamat fungsi, rahasia bersama (webhook), dan kunci VAPID. RLS aktif TANPA kebijakan dan
--     tanpa GRANT, jadi hanya service_role / postgres yang bisa membaca. Barisnya diisi saat penyiapan
--     (lihat README), bukan di skema ini, karena alamat fungsi berbeda per proyek.
--   * push_subscriptions: satu baris per perangkat. Peran diambil dari profil pemanggil, BUKAN dari klien,
--     sehingga tidak bisa dipalsukan. Klien tidak pernah membacanya (kolom auth adalah rahasia langganan);
--     penulisan hanya lewat fungsi di bawah, pembacaan hanya oleh Edge Function (service_role).
--   * Notifikasi TIDAK BOLEH menggagalkan transaksi utama (penjualan / info update): semua galat pemicu ditelan.
-- ---------------------------------------------------------------------------
-- Di skema `extensions` (bukan public): pg_net tidak bisa dipindah dengan SET SCHEMA setelah terpasang.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS push_config (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  function_url   text NOT NULL,
  webhook_secret text NOT NULL,
  vapid_public   text,
  vapid_private  text
);
ALTER TABLE push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_config FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   text PRIMARY KEY CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 1000),
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('admin', 'cashier')),
  p256dh     text NOT NULL CHECK (char_length(p256dh) <= 200),
  auth       text NOT NULL CHECK (char_length(auth) <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Tanpa kebijakan dan tanpa GRANT: hanya fungsi di bawah (SECURITY DEFINER) dan service_role yang menyentuhnya.
DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
REVOKE ALL ON push_subscriptions FROM anon, authenticated;
-- Versi sebelumnya punya kolom tenant_id yang tidak pernah dipakai.
ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS tenant_id;

-- Mendaftarkan perangkat untuk pemanggil. Bila perangkat yang sama dipakai akun lain, langganan berpindah
-- ke akun yang login sekarang. Maksimal 10 perangkat per akun.
CREATE OR REPLACE FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_uid IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR char_length(p_endpoint) > 1000
     OR p_p256dh IS NULL OR char_length(p_p256dh) NOT BETWEEN 1 AND 200
     OR p_auth IS NULL OR char_length(p_auth) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Langganan tidak valid.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.push_subscriptions WHERE user_id = v_uid AND endpoint <> p_endpoint) >= 10 THEN
    RAISE EXCEPTION 'Terlalu banyak perangkat terdaftar (maksimal 10).' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.push_subscriptions (endpoint, user_id, role, p256dh, auth)
  VALUES (p_endpoint, v_uid, v_role, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id, role = EXCLUDED.role, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth;
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid() $$;

-- Pemicu: kirim kejadian ke Edge Function. Tanpa baris push_config (belum disiapkan) tidak melakukan apa-apa.
CREATE OR REPLACE FUNCTION public.notify_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg public.push_config%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.push_config WHERE id = 1;
  IF FOUND THEN
    PERFORM net.http_post(
      url     := cfg.function_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.webhook_secret),
      body    := jsonb_build_object('kind', TG_ARGV[0], 'record', to_jsonb(NEW))
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_push gagal: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_updates_push ON app_updates;
CREATE TRIGGER app_updates_push AFTER INSERT ON app_updates
  FOR EACH ROW EXECUTE FUNCTION public.notify_push('announcement');
DROP TRIGGER IF EXISTS sales_review_push ON sales;
CREATE TRIGGER sales_review_push AFTER INSERT ON sales
  FOR EACH ROW WHEN (NEW.review_note IS NOT NULL) EXECUTE FUNCTION public.notify_push('sale_review');

REVOKE ALL ON FUNCTION public.notify_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_push_subscription(text, text, text), public.unregister_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text, text, text), public.unregister_push_subscription(text) TO authenticated;

COMMIT;
