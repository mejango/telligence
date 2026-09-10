CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY,
 chain_id integer NOT NULL DEFAULT 8453 CHECK (chain_id = 8453),
 revnet_id numeric(78,0) NOT NULL CHECK (revnet_id > 0),
 wrapper_address text NOT NULL CHECK (wrapper_address ~ '^0x[0-9a-f]{40}$'),
 vault_address text NOT NULL CHECK (vault_address ~ '^0x[0-9a-f]{40}$'),
 creator_address text NOT NULL CHECK (creator_address ~ '^0x[0-9a-f]{40}$'),
 policy_version text NOT NULL,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 4000),
 workload text NOT NULL CHECK (length(workload) <= 1000),
 target_daily_microusd bigint CHECK (target_daily_microusd > 0),
 daily_limit_microusd bigint CHECK (daily_limit_microusd > 0),
 max_concurrency integer NOT NULL DEFAULT 4 CHECK (max_concurrency BETWEEN 1 AND 32),
 status text NOT NULL DEFAULT 'accumulating' CHECK (status IN ('accumulating','active','winddown','closed','suspended')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (chain_id,revnet_id), UNIQUE(vault_address), UNIQUE(wrapper_address)
);
-- Targets are optional metadata. Retain existing explicit spending caps unchanged.
-- Upgrade before dependent-table DDL, and avoid locking projects on later startups.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM pg_attribute WHERE attrelid = 'projects'::regclass
   AND attname IN ('target_daily_microusd', 'daily_limit_microusd') AND attnotnull
 ) THEN
  ALTER TABLE projects
   ALTER COLUMN target_daily_microusd DROP NOT NULL,
   ALTER COLUMN daily_limit_microusd DROP NOT NULL;
 END IF;
 -- Existing versions are historical provenance; new rows must supply verified provenance.
 IF EXISTS (
  SELECT 1 FROM pg_attribute WHERE attrelid = 'projects'::regclass
   AND attname = 'policy_version' AND atthasdef
 ) THEN
  ALTER TABLE projects ALTER COLUMN policy_version DROP DEFAULT;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS signer_preparations (
 id uuid PRIMARY KEY, creator_address text NOT NULL,
 encrypted_signer text NOT NULL, signer_address text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 claimed_project_id uuid REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS provider_bindings (
 project_id uuid PRIMARY KEY REFERENCES projects(id),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','disabled')),
 signer_generation integer NOT NULL DEFAULT 1 CHECK (signer_generation > 0),
 signer_address text NOT NULL, encrypted_signer text NOT NULL,
 provider_epoch text,
 daily_limit_microusd bigint NOT NULL DEFAULT 0 CHECK (daily_limit_microusd >= 0),
 remaining_microusd bigint NOT NULL DEFAULT 0 CHECK (remaining_microusd >= 0),
 observed_at timestamptz,
 canary_verified_at timestamptz,
 CHECK (remaining_microusd <= daily_limit_microusd)
);
CREATE TABLE IF NOT EXISTS api_keys (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), prefix text NOT NULL,
 secret_hash text NOT NULL UNIQUE, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 daily_limit_microusd bigint NOT NULL CHECK (daily_limit_microusd > 0),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz,
 UNIQUE (id,project_id)
);
CREATE TABLE IF NOT EXISTS usage_reservations (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id), key_id uuid NOT NULL,
 provider_epoch text NOT NULL, idempotency_hash text,
 maximum_microusd bigint NOT NULL CHECK (maximum_microusd > 0),
 charged_microusd bigint CHECK (charged_microusd >= 0 AND charged_microusd <= maximum_microusd),
 model text NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','settled','uncertain','released')),
 created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
 FOREIGN KEY (key_id,project_id) REFERENCES api_keys(id,project_id),
 UNIQUE (key_id,idempotency_hash),
 CHECK ((state = 'settled' AND charged_microusd IS NOT NULL) OR (state <> 'settled' AND charged_microusd IS NULL))
);
CREATE INDEX IF NOT EXISTS usage_project_epoch ON usage_reservations(project_id,provider_epoch);
CREATE INDEX IF NOT EXISTS usage_outstanding ON usage_reservations(project_id,state) WHERE state IN ('reserved','uncertain');
CREATE TABLE IF NOT EXISTS auth_challenges (
 id uuid PRIMARY KEY,address text NOT NULL,origin text NOT NULL,message text NOT NULL,challenge_data jsonb NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_challenges_address ON auth_challenges(address,created_at);
CREATE TABLE IF NOT EXISTS creator_sessions (
 id uuid PRIMARY KEY,secret_hash text NOT NULL UNIQUE,address text NOT NULL,csrf_hash text NOT NULL,
 origin text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS request_rate_windows (
 scope text NOT NULL, window_start timestamptz NOT NULL, request_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(scope,window_start)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id bigserial PRIMARY KEY,project_id uuid REFERENCES projects(id),actor_address text,kind text NOT NULL,
 object_id text,created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth_challenges ADD COLUMN IF NOT EXISTS challenge_data jsonb;
CREATE TABLE IF NOT EXISTS canary_runs (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 signer_generation integer NOT NULL,
 state text NOT NULL CHECK (state IN ('prepared','submitted','completed','uncertain')),
 reservation_id uuid UNIQUE REFERENCES usage_reservations(id),
 started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 evidence jsonb,
 UNIQUE(project_id,signer_generation)
);

ALTER TABLE usage_reservations ADD COLUMN IF NOT EXISTS provider_request_id text
 CHECK (provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');
CREATE UNIQUE INDEX IF NOT EXISTS usage_provider_identity ON usage_reservations(project_id,provider_request_id)
 WHERE provider_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS usage_reconciliations (
 reservation_id uuid PRIMARY KEY REFERENCES usage_reservations(id),
 project_id uuid NOT NULL REFERENCES projects(id),
 provider_request_id text NOT NULL,
 retention_reservation_id uuid UNIQUE REFERENCES usage_reservations(id),
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(project_id,provider_request_id)
);

ALTER TABLE signer_preparations DROP CONSTRAINT IF EXISTS signer_preparations_claimed_project_id_key;

-- Request lifecycle: which gateway process owns a reservation and whether the
-- provider request was durably marked as dispatched before it was sent.
CREATE TABLE IF NOT EXISTS gateway_instances (
 id uuid PRIMARY KEY,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 stopped_at timestamptz
);
ALTER TABLE usage_reservations ADD COLUMN IF NOT EXISTS gateway_instance uuid;
ALTER TABLE usage_reservations ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
