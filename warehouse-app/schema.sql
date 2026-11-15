CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  currency char(3) NOT NULL CHECK (currency IN ('GHS','USD','GBP','EUR','NGN')),
  timezone text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','warehouse','sales','finance','viewer')),
  password_hash text,
  recovery_hash text,
  status text NOT NULL CHECK (status IN ('active','invited','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,email), UNIQUE (workspace_id,id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL,
  member_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id,member_id) REFERENCES members(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL,
  member_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  FOREIGN KEY (workspace_id,member_id) REFERENCES members(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  unit text NOT NULL,
  location text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 1000000000),
  reorder_point integer NOT NULL CHECK (reorder_point >= 0),
  cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (workspace_id,sku), UNIQUE (workspace_id,id)
);
CREATE TABLE IF NOT EXISTS inbound (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  reference text NOT NULL,
  supplier text NOT NULL,
  shipment text,
  received_on date NOT NULL,
  notes text,
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (workspace_id,reference), UNIQUE (workspace_id,id)
);
CREATE TABLE IF NOT EXISTS inbound_lines (
  workspace_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
  sku text NOT NULL, name text NOT NULL, unit text NOT NULL,
  PRIMARY KEY (receipt_id,product_id),
  FOREIGN KEY (workspace_id,receipt_id) REFERENCES inbound(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,product_id) REFERENCES products(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  reference text NOT NULL,
  customer text NOT NULL,
  sold_on date NOT NULL,
  due_on date,
  method text NOT NULL CHECK (method IN ('cash','credit','cheque','momo')),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (workspace_id,reference), UNIQUE (workspace_id,id)
);
CREATE TABLE IF NOT EXISTS sale_lines (
  workspace_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  sku text NOT NULL, name text NOT NULL, unit text NOT NULL,
  PRIMARY KEY (sale_id,product_id),
  FOREIGN KEY (workspace_id,sale_id) REFERENCES sales(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,product_id) REFERENCES products(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  method text NOT NULL CHECK (method IN ('cash','cheque','momo')),
  reference text,
  received_on date NOT NULL,
  settled_on date,
  status text NOT NULL CHECK (status IN ('settled','pending','rejected','reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,sale_id) REFERENCES sales(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_momo_reference ON payments(workspace_id,lower(reference)) WHERE method='momo' AND status <> 'reversed';
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  reference text NOT NULL,
  payee text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('cash','cheque','momo','transfer')),
  payment_reference text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (workspace_id,reference)
);
CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  source_id uuid NOT NULL,
  reference text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('inbound','sale','inbound reversal','sale reversal','adjustment')),
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  effective_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,product_id) REFERENCES products(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  actor_id uuid,
  actor_name text NOT NULL,
  action text NOT NULL,
  reference text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  member_id uuid NOT NULL,
  key uuid NOT NULL,
  fingerprint text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,member_id,key)
);
CREATE INDEX IF NOT EXISTS products_workspace_name ON products(workspace_id,name,sku);
CREATE INDEX IF NOT EXISTS inbound_lines_workspace_product ON inbound_lines(workspace_id,product_id);
CREATE INDEX IF NOT EXISTS sale_lines_workspace_product ON sale_lines(workspace_id,product_id);
CREATE INDEX IF NOT EXISTS inbound_workspace_date ON inbound(workspace_id,received_on DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS sales_workspace_date ON sales(workspace_id,sold_on DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS expenses_workspace_date ON expenses(workspace_id,paid_on DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS payments_workspace_sale ON payments(workspace_id,sale_id,status);
CREATE INDEX IF NOT EXISTS movements_workspace_date ON movements(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_workspace_date ON audit_log(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_member ON sessions(workspace_id,member_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS invites_member ON invites(workspace_id,member_id);
CREATE INDEX IF NOT EXISTS invites_expiry ON invites(expires_at);
CREATE INDEX IF NOT EXISTS auth_limits_expiry ON auth_limits(expires_at);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS receipt_address text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS receipt_phone text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS units_per_box integer CHECK (units_per_box BETWEEN 2 AND 1000);
ALTER TABLE products ADD COLUMN IF NOT EXISTS boxes_per_carton integer
  CHECK (boxes_per_carton IS NULL OR (boxes_per_carton BETWEEN 2 AND 1000 AND units_per_box IS NOT NULL));
ALTER TABLE inbound_lines ADD COLUMN IF NOT EXISTS units_per_box integer;
ALTER TABLE inbound_lines ADD COLUMN IF NOT EXISTS boxes_per_carton integer;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS units_per_box integer;
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS boxes_per_carton integer;

CREATE TABLE IF NOT EXISTS daily_reconciliations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  business_date date NOT NULL,
  opening_minor bigint NOT NULL CHECK (opening_minor >= 0),
  counted_minor bigint NOT NULL CHECK (counted_minor >= 0),
  expected_minor numeric NOT NULL,
  variance_minor numeric NOT NULL,
  notes text,
  snapshot jsonb NOT NULL,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_reconciliations_date ON daily_reconciliations(workspace_id,business_date,created_at DESC);
CREATE INDEX IF NOT EXISTS movements_effective_date ON movements(workspace_id,effective_on);
CREATE INDEX IF NOT EXISTS payments_settled_date ON payments(workspace_id,settled_on);
CREATE INDEX IF NOT EXISTS payments_received_date ON payments(workspace_id,received_on);
