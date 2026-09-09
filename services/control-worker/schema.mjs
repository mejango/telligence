// Applied by the services migration command after the shared projects schema.
export const WORKER_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS worker_project_leases (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  owner text NOT NULL,
  fence bigint NOT NULL CHECK (fence > 0),
  lease_until timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS worker_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  operation text NOT NULL CHECK (operation IN ('distribute_production','cash_out_production','allocate','begin_diem_unstake','claim_diem_begin_vvv_unstake','claim_vvv_return','claim_rewards_return','return_liquid_vvv','recover_donated_stake','return_unallocated_vvv','burn_late_production')),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','prepared','submitted','broadcast_unknown','confirmed','finalized','failed','quarantined')),
  lease_owner text,
  fence bigint,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  receipt_block numeric(78,0),
  receipt_block_hash text,
  effect jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id, operation_key)
);
CREATE INDEX IF NOT EXISTS worker_jobs_pending ON worker_jobs(next_attempt_at,created_at)
  WHERE state IN ('queued','prepared','submitted','broadcast_unknown','confirmed');
ALTER TABLE worker_jobs DROP CONSTRAINT IF EXISTS worker_jobs_operation_check;
ALTER TABLE worker_jobs ADD CONSTRAINT worker_jobs_operation_check CHECK (operation IN
  ('distribute_production','cash_out_production','allocate','begin_diem_unstake','claim_diem_begin_vvv_unstake','claim_vvv_return','claim_rewards_return','return_liquid_vvv','recover_donated_stake','return_unallocated_vvv','burn_late_production'));
CREATE TABLE IF NOT EXISTS worker_tx_intents (
  job_id uuid PRIMARY KEY REFERENCES worker_jobs(id),
  chain_id integer NOT NULL CHECK (chain_id = 8453),
  keeper_address text NOT NULL CHECK (keeper_address ~ '^0x[0-9a-f]{40}$'),
  nonce bigint NOT NULL CHECK (nonce >= 0),
  transaction_hash text NOT NULL UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  raw_transaction text NOT NULL CHECK (raw_transaction ~ '^0x[0-9a-f]+$'),
  target_address text NOT NULL CHECK (target_address ~ '^0x[0-9a-f]{40}$'),
  calldata text NOT NULL CHECK (calldata ~ '^0x[0-9a-f]+$'),
  preconditions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(chain_id,keeper_address,nonce)
);
CREATE TABLE IF NOT EXISTS worker_chain_blocks (
  chain_id integer NOT NULL CHECK (chain_id = 8453),
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(chain_id,block_number)
);
CREATE TABLE IF NOT EXISTS worker_capacity_evidence (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  chain_block numeric(78,0) NOT NULL,
  chain_block_hash text NOT NULL,
  observed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS worker_project_checks (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  last_planned_at timestamptz,
  last_refreshed_at timestamptz
);
`;
