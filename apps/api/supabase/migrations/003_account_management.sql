-- Add line_items to bank transactions so we can group by chart of accounts
ALTER TABLE xero_bank_transactions ADD COLUMN IF NOT EXISTS line_items jsonb;

-- Hidden accounts (user can hide dormant/irrelevant accounts from cashflow view)
CREATE TABLE IF NOT EXISTS hidden_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES xero_connections(id) ON DELETE CASCADE NOT NULL,
  account_code text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(connection_id, account_code)
);
ALTER TABLE hidden_accounts ENABLE ROW LEVEL SECURITY;

-- Add account_codes to account_groups (text[] of Xero account codes)
ALTER TABLE account_groups ADD COLUMN IF NOT EXISTS account_codes text[] NOT NULL DEFAULT '{}';
