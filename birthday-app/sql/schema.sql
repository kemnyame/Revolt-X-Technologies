CREATE TABLE IF NOT EXISTS birthday_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing installations are upgraded safely at startup; existing administrators stay active.
ALTER TABLE birthday_admins ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';
ALTER TABLE birthday_admins ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE birthday_admins ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE birthday_admins ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES birthday_admins(id) ON DELETE SET NULL;
ALTER TABLE birthday_admins ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
CREATE TABLE IF NOT EXISTS birthday_sessions (
  token_hash text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES birthday_admins(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_birthday_sessions_exp ON birthday_sessions(expires_at);
CREATE TABLE IF NOT EXISTS birthday_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_code text NOT NULL UNIQUE,
  first_name text NOT NULL,
  phone_number text NOT NULL DEFAULT '',
  last_name text NOT NULL,
  birth_day smallint NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_month smallint NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_year smallint CHECK (birth_year BETWEEN 1900 AND 2100),
  department text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','inactive')),
  hide_from_celebrations boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_birthday_staff_date ON birthday_staff(birth_month,birth_day);
CREATE INDEX IF NOT EXISTS idx_birthday_staff_status ON birthday_staff(employment_status);
CREATE TABLE IF NOT EXISTS birthday_greetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES birthday_staff(id) ON DELETE CASCADE,
  birthday_on date NOT NULL,
  greeted_by uuid REFERENCES birthday_admins(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, birthday_on)
);
CREATE INDEX IF NOT EXISTS idx_birthday_greetings_date ON birthday_greetings(birthday_on);
CREATE TABLE IF NOT EXISTS birthday_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  performed_by uuid REFERENCES birthday_admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS birthday_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO birthday_settings(key,value) VALUES ('reminder_days','30') ON CONFLICT (key) DO NOTHING;
-- Upgrade existing installations without altering saved staff records.
ALTER TABLE birthday_staff ADD COLUMN IF NOT EXISTS phone_number text NOT NULL DEFAULT '';
