import { ApiError } from "./policy.mjs";
import { transaction } from "./store.mjs";
const pending = () =>
  new ApiError(
    409,
    "authentication_pending",
    "Wait for the confirmed vault authentication state before synchronizing.",
  );
/** Bind only a creator's confirmed onchain signer. This method cannot change a contract or a quota. */
export async function syncProjectAuthentication({
  store,
  registry,
  projectId,
  creatorAddress,
  preparationId,
}) {
  const project = await store.requireOwner(projectId, creatorAddress);
  const {
    rows: [initial],
  } = await store.pool.query(
    "SELECT * FROM provider_bindings WHERE project_id=$1",
    [projectId],
  );
  if (!initial)
    throw new ApiError(404, "not_found", "Provider identity not found.");
  if (initial.status === "disabled")
    throw new ApiError(
      403,
      "provider_disabled",
      "Provider access has been disabled by the service operator.",
    );
  let preparation;
  if (preparationId) {
    const result = await store.pool.query(
      "SELECT * FROM signer_preparations WHERE id=$1 AND creator_address=$2 AND (claimed_project_id IS NULL OR claimed_project_id=$3)",
      [preparationId, creatorAddress.toLowerCase(), projectId],
    );
    preparation = result.rows[0];
    if (!preparation)
      throw new ApiError(
        409,
        "invalid_preparation",
        "The signer preparation is not available to this creator and project.",
      );
  }
  const signer = preparation?.signer_address ?? initial.signer_address;
  const proof = await registry.verifyProject({
    revnetId: project.revnet_id,
    wrapperAddress: project.wrapper_address,
    vaultAddress: project.vault_address,
    creatorAddress: creatorAddress.toLowerCase(),
    inferenceSigner: signer,
  });
  if (
    !Number.isSafeInteger(proof.signerGeneration) ||
    proof.signerGeneration < Number(initial.signer_generation) ||
    proof.signerGeneration < 1 ||
    proof.signerGeneration > 2147483647 ||
    typeof proof.authenticationEnabled !== "boolean"
  )
    throw pending();
  return transaction(store.pool, async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      projectId,
    ]);
    const {
      rows: [current],
    } = await c.query(
      "SELECT * FROM provider_bindings WHERE project_id=$1 FOR UPDATE",
      [projectId],
    );
    if (
      !current ||
      current.signer_address !== initial.signer_address ||
      current.signer_generation !== initial.signer_generation ||
      current.status === "disabled"
    )
      throw pending();
    if (preparation) {
      const result = await c.query(
        "UPDATE signer_preparations SET claimed_project_id=$2 WHERE id=$1 AND creator_address=$3 AND (claimed_project_id IS NULL OR claimed_project_id=$2) RETURNING id",
        [preparation.id, projectId, creatorAddress.toLowerCase()],
      );
      if (!result.rowCount)
        throw new ApiError(
          409,
          "invalid_preparation",
          "The signer preparation has already been bound elsewhere.",
        );
    }
    const changed =
      current.signer_address !== signer ||
      Number(current.signer_generation) !== proof.signerGeneration;
    if (changed || !proof.authenticationEnabled) {
      await c.query(
        "UPDATE provider_bindings SET signer_address=$2,encrypted_signer=$3,signer_generation=$4,status='pending',observed_at=NULL,canary_verified_at=NULL WHERE project_id=$1",
        [
          projectId,
          signer,
          preparation?.encrypted_signer ?? current.encrypted_signer,
          proof.signerGeneration,
        ],
      );
      await c.query(
        "UPDATE projects SET status='accumulating' WHERE id=$1 AND status='active'",
        [projectId],
      );
      await c.query(
        "INSERT INTO audit_events(project_id,actor_address,kind,object_id) VALUES($1,$2,$3,$4)",
        [
          projectId,
          creatorAddress.toLowerCase(),
          preparation ? "signer.rotated" : "signer.synchronized",
          String(proof.signerGeneration),
        ],
      );
    }
    return {
      signerAddress: signer,
      signerGeneration: proof.signerGeneration,
      authenticationEnabled: proof.authenticationEnabled,
      status:
        changed || !proof.authenticationEnabled || !current.canary_verified_at
          ? "provisioning"
          : current.status === "ready"
            ? "ready"
            : "provisioning",
    };
  });
}
