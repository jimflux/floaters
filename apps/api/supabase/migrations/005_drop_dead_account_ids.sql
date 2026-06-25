-- account_groups originally keyed on a uuid[] of account ids (001), but the
-- account-management feature (003) switched to account_codes text[]. The old
-- column was left NOT NULL with no default and is never written or read.
-- Drop it so the schema matches the code.
ALTER TABLE account_groups DROP COLUMN IF EXISTS account_ids;
