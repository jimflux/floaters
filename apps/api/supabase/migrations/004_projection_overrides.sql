-- Manual projection overrides (user can set specific amounts for future months)
CREATE TABLE IF NOT EXISTS projection_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES xero_connections(id) ON DELETE CASCADE NOT NULL,
  account_code text NOT NULL,
  month text NOT NULL,
  amount numeric(15,2) NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(connection_id, account_code, month)
);
ALTER TABLE projection_overrides ENABLE ROW LEVEL SECURITY;
