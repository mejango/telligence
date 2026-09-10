import { randomUUID, randomBytes } from "node:crypto";
import {
  ApiError,
  digest,
  verifyKey,
  keyId,
  microToUsd,
  equalSecret,
} from "./policy.mjs";
export async function transaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
const unauthorized = () =>
  new ApiError(401, "unauthorized", "Valid credentials are required.");
const debit = `CASE WHEN state='settled' THEN charged_microusd WHEN state IN ('reserved','uncertain') THEN maximum_microusd ELSE 0 END`;
export class GatewayStore {
  constructor(
    pool,
    {
      keyPepper,
      capacityMaxAgeMs = 30000,
      capacityGraceMs = 180000,
      safetyMarginMicroUsd = 1000n,
      canaryRunId = null,
      instanceId = randomUUID(),
    },
  ) {
    this.pool = pool;
    this.keyPepper = keyPepper;
    this.capacityMaxAgeMs = capacityMaxAgeMs;
    // Aging observations stay usable: every local debit since the observation is
    // subtracted, the epoch must match, and onchain signer state governs the
    // provider's own validation. Beyond the grace window admission stops.
    this.capacityGraceMs = Math.max(capacityGraceMs, capacityMaxAgeMs);
    this.safetyMarginMicroUsd = safetyMarginMicroUsd;
    this.canaryRunId = canaryRunId;
    this.instanceId = instanceId;
    this.ledgerUntrusted = false;
  }
  async heartbeat(client = this.pool) {
    await client.query(
      "INSERT INTO gateway_instances(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET heartbeat_at=clock_timestamp()",
      [this.instanceId],
    );
  }
  async stop() {
    await this.pool.query(
      "UPDATE gateway_instances SET stopped_at=clock_timestamp() WHERE id=$1",
      [this.instanceId],
    );
  }
  /** The provider request may be sent only after this commit succeeds. */
  async markDispatched(id) {
    const result = await this.pool.query(
      "UPDATE usage_reservations SET dispatched_at=clock_timestamp() WHERE id=$1 AND gateway_instance=$2 AND state='reserved' AND dispatched_at IS NULL",
      [id, this.instanceId],
    );
    if (!result.rowCount)
      throw new ApiError(
        409,
        "reservation_not_owned",
        "This reservation is not dispatchable by this process.",
      );
  }
  /**
   * Orphans belong to a stopped or silent instance, or predate instance tracking.
   * Undispatched rows of a tracked instance are proven never sent and released.
   * Everything else may have reached the provider and is held as uncertain.
   */
  async recoverOrphans({ staleAfterMs = 60000 } = {}) {
    const { rows } = await this.pool.query(
      `SELECT u.id FROM usage_reservations u LEFT JOIN gateway_instances g ON g.id=u.gateway_instance
       WHERE u.state='reserved' AND (u.gateway_instance IS NULL OR g.id IS NULL OR g.stopped_at IS NOT NULL
         OR g.heartbeat_at < clock_timestamp()-($1||' milliseconds')::interval)
         AND (u.gateway_instance IS DISTINCT FROM $2)`,
      [String(staleAfterMs), this.instanceId],
    );
    const counts = { released: 0, uncertain: 0 };
    for (const { id } of rows) {
      const state = await transaction(this.pool, async (c) => {
        const found = await c.query(
          "SELECT project_id FROM usage_reservations WHERE id=$1",
          [id],
        );
        await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
          found.rows[0].project_id,
        ]);
        const {
          rows: [r],
        } = await c.query(
          `SELECT u.*, g.stopped_at, g.heartbeat_at < clock_timestamp()-($2||' milliseconds')::interval AS silent, g.id AS instance
           FROM usage_reservations u LEFT JOIN gateway_instances g ON g.id=u.gateway_instance WHERE u.id=$1 FOR UPDATE OF u`,
          [id, String(staleAfterMs)],
        );
        const orphan =
          r.state === "reserved" &&
          (r.gateway_instance === null ||
            r.instance === null ||
            r.stopped_at !== null ||
            r.silent === true);
        if (!orphan) return null;
        const proven = r.gateway_instance !== null && r.instance !== null && r.dispatched_at === null;
        const next = proven ? "released" : "uncertain";
        await c.query(
          "UPDATE usage_reservations SET state=$2,settled_at=clock_timestamp() WHERE id=$1",
          [id, next],
        );
        await c.query(
          "INSERT INTO audit_events(project_id,kind,object_id) VALUES($1,$2,$3)",
          [
            r.project_id,
            proven ? "usage.recovered_undispatched" : "usage.recovered_uncertain",
            id,
          ],
        );
        return next;
      });
      if (state) counts[state]++;
    }
    return counts;
  }
  /** `<iso>:<count>`: at least `count` reservations must exist at or before `iso`. */
  async verifyLedgerCheckpoint(checkpoint) {
    const match = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z):(0|[1-9]\d{0,15})$/.exec(
      checkpoint ?? "",
    );
    if (!match || !Number.isFinite(Date.parse(match[1])))
      throw new Error("Invalid ledger checkpoint.");
    const {
      rows: [{ n }],
    } = await this.pool.query(
      "SELECT count(*) AS n FROM usage_reservations WHERE created_at<=$1",
      [match[1]],
    );
    this.ledgerUntrusted = BigInt(n) < BigInt(match[2]);
    return !this.ledgerUntrusted;
  }
  async authenticate(secret, client = this.pool) {
    const id = keyId(secret);
    if (
      !id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    )
      throw unauthorized();
    const { rows } = await client.query(
      "SELECT * FROM api_keys WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())",
      [id],
    );
    if (!rows[0] || !verifyKey(secret, rows[0].secret_hash, this.keyPepper))
      throw unauthorized();
    return rows[0];
  }
  async noteProviderRequestId(id, providerRequestId) {
    if (
      typeof providerRequestId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(providerRequestId)
    )
      throw new ApiError(
        400,
        "invalid_provider_identity",
        "Invalid provider request identity.",
      );
    return transaction(this.pool, async (client) => {
      const {
        rows: [reservation],
      } = await client.query(
        "SELECT project_id FROM usage_reservations WHERE id=$1",
        [id],
      );
      if (!reservation)
        throw new ApiError(404, "not_found", "Reservation not found.");
      await client.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        reservation.project_id,
      ]);
      const result = await client.query(
        "UPDATE usage_reservations SET provider_request_id=$2 WHERE id=$1 AND state IN ('reserved','uncertain') AND (provider_request_id IS NULL OR provider_request_id=$2)",
        [id, providerRequestId],
      );
      if (!result.rowCount)
        throw new ApiError(
          409,
          "provider_identity_conflict",
          "Provider identity is immutable.",
        );
    });
  }
  async reserve({ secret, maximumMicroUsd, model, idempotencyKey }) {
    if (maximumMicroUsd <= 0n)
      throw new ApiError(
        400,
        "invalid_amount",
        "Reservation must be positive.",
      );
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))
    )
      throw new ApiError(
        400,
        "invalid_idempotency",
        "Invalid idempotency key.",
      );
    if (this.ledgerUntrusted)
      throw new ApiError(
        503,
        "ledger_untrusted",
        "The usage ledger has not been reconciled after restoration.",
      );
    return transaction(this.pool, async (c) => {
      const initial = await this.authenticate(secret, c);
      const { rows: projects } = await c.query(
        "SELECT *,clock_timestamp() AS db_now FROM projects WHERE id=$1 FOR UPDATE",
        [initial.project_id],
      );
      const key = await this.authenticate(secret, c);
      const project = projects[0];
      let canary = null;
      if (this.canaryRunId) {
        const {
          rows: [run],
        } = await c.query(
          "SELECT * FROM canary_runs WHERE id=$1 AND project_id=$2 AND state='prepared' FOR UPDATE",
          [this.canaryRunId, project?.id],
        );
        if (!run || maximumMicroUsd > 10000n)
          throw new ApiError(
            409,
            "invalid_canary",
            "The canary is already submitted or exceeds its fixed cap.",
          );
        canary = run;
      }
      if (
        !project ||
        !["active", "winddown", ...(canary ? ["accumulating"] : [])].includes(
          project.status,
        )
      )
        throw new ApiError(
          503,
          "capacity_unavailable",
          "Compute is not currently available.",
        );
      const { rows: providers } = await c.query(
        "SELECT * FROM provider_bindings WHERE project_id=$1",
        [project.id],
      );
      const provider = providers[0];
      const now = project.db_now;
      const epoch = now.toISOString().slice(0, 10);
      if (
        !provider ||
        provider.status !== "ready" ||
        (!provider.canary_verified_at && !canary) ||
        (canary && canary.signer_generation !== provider.signer_generation) ||
        provider.provider_epoch !== epoch ||
        !provider.observed_at ||
        now - provider.observed_at > this.capacityGraceMs ||
        provider.observed_at > now
      )
        throw new ApiError(
          503,
          "capacity_unavailable",
          "Fresh verified provider capacity is required.",
        );
      const idempotencyHash = idempotencyKey
        ? digest(`${key.id}:${idempotencyKey}`, this.keyPepper)
        : null;
      if (idempotencyHash) {
        const duplicate = await c.query(
          "SELECT 1 FROM usage_reservations WHERE key_id=$1 AND idempotency_hash=$2",
          [key.id, idempotencyHash],
        );
        if (duplicate.rowCount)
          throw new ApiError(
            409,
            "duplicate_request",
            "This request identifier has already been used. Do not retry ambiguous inference.",
          );
      }
      const {
        rows: [usage],
      } = await c.query(
        `SELECT
        COALESCE(sum(${debit}) FILTER (WHERE provider_epoch=$2 OR state IN ('reserved','uncertain')),0) AS project_spent,
        COALESCE(sum(${debit}) FILTER (WHERE key_id=$3 AND (provider_epoch=$2 OR state IN ('reserved','uncertain'))),0) AS key_spent,
        COALESCE(sum(${debit}) FILTER (WHERE state IN ('reserved','uncertain') OR created_at >= $4 OR settled_at >= $4),0) AS snapshot_debit,
        count(*) FILTER (WHERE state='reserved') AS concurrent
        FROM usage_reservations WHERE project_id=$1`,
        [project.id, epoch, key.id, provider.observed_at],
      );
      const capacity =
        BigInt(provider.remaining_microusd) -
        BigInt(usage.snapshot_debit) -
        this.safetyMarginMicroUsd;
      if (
        (project.daily_limit_microusd !== null &&
          BigInt(usage.project_spent) + maximumMicroUsd >
            BigInt(project.daily_limit_microusd)) ||
        BigInt(usage.project_spent) + maximumMicroUsd >
          BigInt(provider.daily_limit_microusd) ||
        BigInt(usage.key_spent) + maximumMicroUsd >
          BigInt(key.daily_limit_microusd) ||
        capacity < maximumMicroUsd
      )
        throw new ApiError(
          429,
          "budget_exhausted",
          "The remaining daily compute budget cannot cover this request.",
        );
      if (Number(usage.concurrent) >= project.max_concurrency)
        throw new ApiError(
          429,
          "concurrency_limit",
          "The project has too many active requests.",
        );
      const id = randomUUID();
      // The owning instance is registered in the same transaction so a
      // reservation can never appear to belong to an unknown process.
      await this.heartbeat(c);
      await c.query(
        `INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,idempotency_hash,maximum_microusd,model,gateway_instance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          project.id,
          key.id,
          epoch,
          idempotencyHash,
          maximumMicroUsd.toString(),
          model,
          this.instanceId,
        ],
      );
      if (canary)
        await c.query(
          "UPDATE canary_runs SET state='submitted',reservation_id=$2 WHERE id=$1",
          [canary.id, id],
        );
      return {
        id,
        projectId: project.id,
        keyId: key.id,
        vaultAddress: project.vault_address,
        maximumMicroUsd,
        epoch,
      };
    });
  }
  async finish(id, { state, chargedMicroUsd = null }) {
    if (!["settled", "uncertain", "released"].includes(state))
      throw new ApiError(
        400,
        "invalid_settlement",
        "Invalid reservation settlement.",
      );
    return transaction(this.pool, async (c) => {
      const found = await c.query(
        "SELECT project_id FROM usage_reservations WHERE id=$1",
        [id],
      );
      if (!found.rowCount)
        throw new ApiError(404, "not_found", "Reservation not found.");
      await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        found.rows[0].project_id,
      ]);
      const {
        rows: [reservation],
      } = await c.query(
        "SELECT * FROM usage_reservations WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (
        reservation.state !== "reserved" ||
        (state === "settled" &&
          (typeof chargedMicroUsd !== "bigint" ||
            chargedMicroUsd < 0n ||
            chargedMicroUsd > BigInt(reservation.maximum_microusd)))
      )
        throw new ApiError(
          409,
          "invalid_settlement",
          "Reservation cannot be settled again.",
        );
      await c.query(
        "UPDATE usage_reservations SET state=$2,charged_microusd=$3,settled_at=clock_timestamp() WHERE id=$1",
        [id, state, state === "settled" ? chargedMicroUsd.toString() : null],
      );
    });
  }
  async rateLimit(scope, limit, seconds = 60) {
    const {
      rows: [row],
    } = await this.pool.query(
      `INSERT INTO request_rate_windows(scope,window_start,request_count) VALUES($1,to_timestamp(floor(extract(epoch FROM clock_timestamp())/$2)*$2),1) ON CONFLICT(scope,window_start) DO UPDATE SET request_count=request_rate_windows.request_count+1 RETURNING request_count`,
      [scope, seconds],
    );
    if (row.request_count > limit)
      throw new ApiError(
        429,
        "rate_limited",
        "Please wait before trying again.",
      );
  }
  async requestStatus(secret, id) {
    const key = await this.authenticate(secret);
    const {
      rows: [row],
    } = await this.pool.query(
      "SELECT id,state,model,maximum_microusd,charged_microusd,provider_epoch,created_at,settled_at FROM usage_reservations WHERE id=$1 AND project_id=$2",
      [id, key.project_id],
    );
    if (!row) throw new ApiError(404, "not_found", "Request not found.");
    return {
      id: row.id,
      state: row.state,
      model: row.model,
      maximumUsd: microToUsd(row.maximum_microusd),
      accountedUsd:
        row.charged_microusd === null ? null : microToUsd(row.charged_microusd),
      providerEpoch: row.provider_epoch,
      createdAt: row.created_at.toISOString(),
      settledAt: row.settled_at?.toISOString() ?? null,
    };
  }
  async projects(id) {
    const { rows } = await this.pool.query(
      `SELECT p.*,b.status AS provider_status,b.daily_limit_microusd AS provider_daily,b.remaining_microusd,b.observed_at,b.provider_epoch,b.canary_verified_at,
      COALESCE((SELECT sum(${debit}) FROM usage_reservations u WHERE u.project_id=p.id AND (u.state IN ('reserved','uncertain') OR u.created_at>=b.observed_at OR u.settled_at>=b.observed_at)),0) AS reserved
      FROM projects p LEFT JOIN provider_bindings b ON p.id=b.project_id ${id ? "WHERE p.id=$1" : ""} ORDER BY p.created_at DESC LIMIT 100`,
      id ? [id] : [],
    );
    return rows.map((p) => {
      const age = p.observed_at ? Date.now() - p.observed_at.getTime() : Infinity;
      const usable =
        age <= this.capacityGraceMs &&
        age >= 0 &&
        p.provider_epoch === new Date().toISOString().slice(0, 10);
      const fresh = usable && age <= this.capacityMaxAgeMs;
      const remaining =
        BigInt(p.remaining_microusd ?? 0) -
        BigInt(p.reserved) -
        this.safetyMarginMicroUsd;
      const status =
        ["closed", "suspended"].includes(p.status) ||
        p.provider_status === "disabled"
          ? "suspended"
          : !p.canary_verified_at ||
              p.provider_status === "pending" ||
              !p.observed_at
            ? "provisioning"
            : !usable
              ? "stale"
              : remaining <= 0n
                ? "exhausted"
                : "ready";
      return {
        id: p.id,
        chainId: p.chain_id,
        revnetId: p.revnet_id,
        wrapperAddress: p.wrapper_address,
        vaultAddress: p.vault_address,
        creatorAddress: p.creator_address,
        name: p.name,
        purpose: p.purpose,
        workload: p.workload,
        targetDailyCreditUsd:
          p.target_daily_microusd === null
            ? null
            : microToUsd(p.target_daily_microusd),
        status: p.status,
        policyVersion: p.policy_version,
        createdAt: p.created_at.toISOString(),
        capacity: {
          status,
          dailyCreditUsd: microToUsd(p.provider_daily ?? 0),
          remainingCreditUsd: microToUsd(remaining > 0n ? remaining : 0n),
          observedAt: p.observed_at?.toISOString() ?? null,
          freshness: !usable ? "stale" : fresh ? "fresh" : "aging",
        },
      };
    });
  }
  async session(secret, { origin, csrf, recent = false } = {}) {
    if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret))
      throw unauthorized();
    const {
      rows: [row],
    } = await this.pool.query(
      "SELECT * FROM creator_sessions WHERE secret_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
      [digest(secret, this.keyPepper)],
    );
    if (
      !row ||
      (origin && row.origin !== origin) ||
      (csrf !== undefined &&
        !equalSecret(digest(csrf, this.keyPepper), row.csrf_hash))
    )
      throw unauthorized();
    if (recent && Date.now() - row.created_at.getTime() > 900000)
      throw new ApiError(
        401,
        "reauthentication_required",
        "Sign in again to manage credentials.",
      );
    return row;
  }
  async createSession(c, address, origin) {
    const secret = randomBytes(32).toString("base64url");
    const csrf = digest(`csrf:${secret}`, this.keyPepper);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 3600000);
    await c.query(
      "INSERT INTO creator_sessions(id,secret_hash,address,csrf_hash,origin,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        digest(secret, this.keyPepper),
        address,
        digest(csrf, this.keyPepper),
        origin,
        expiresAt,
      ],
    );
    return {
      secret,
      address,
      expiresAt: expiresAt.toISOString(),
      csrfToken: csrf,
    };
  }
  async requireOwner(projectId, address, c = this.pool) {
    const {
      rows: [project],
    } = await c.query(
      "SELECT * FROM projects WHERE id=$1 AND creator_address=$2",
      [projectId, address.toLowerCase()],
    );
    if (!project) throw new ApiError(404, "not_found", "Project not found.");
    return project;
  }
}
