import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { GatewayStore } from "../store.mjs";
import { syncProjectAuthentication } from "../authentication.mjs";
const url = process.env.TEST_DATABASE_URL,
  pool = url ? new pg.Pool({ connectionString: url }) : null;
const fixtures = [];
const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
before(async () => {
  if (pool) await migrate(pool);
});
after(async () => {
  if (pool) {
    for (const { id } of fixtures) {
      await pool.query("DELETE FROM audit_events WHERE project_id=$1", [id]);
      await pool.query(
        "DELETE FROM signer_preparations WHERE claimed_project_id=$1",
        [id],
      );
      await pool.query("DELETE FROM provider_bindings WHERE project_id=$1", [
        id,
      ]);
      await pool.query("DELETE FROM projects WHERE id=$1", [id]);
    }
    await pool.end();
  }
});
async function fixture() {
  const id = randomUUID(),
    creator = addr(),
    signer = addr();
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd,status) VALUES($1,'1',$2,$3,$4,$5,'sync','sync','sync',1000,1000,'active')`,
    [
      id,
      BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(),
      addr(),
      addr(),
      creator,
    ],
  );
  await pool.query(
    `INSERT INTO provider_bindings(project_id,status,signer_address,encrypted_signer,signer_generation,canary_verified_at,observed_at) VALUES($1,'ready',$2,'original-ciphertext',1,now(),now())`,
    [id, signer],
  );
  const options = {
    store: new GatewayStore(pool, {
      keyPepper: "test-pepper-at-least-thirty-two-bytes",
    }),
    projectId: id,
    creatorAddress: creator,
    registry: {
      verifyProject: async (args) => {
        assert.equal(args.inferenceSigner, signer);
        return { signerGeneration: 3, authenticationEnabled: true };
      },
    },
  };
  fixtures.push({ id });
  return { id, creator, signer, options };
}
test(
  "creator can sync a confirmed signer generation after disable/enable without resetting budget",
  { skip: !url },
  async () => {
    const { id, options } = await fixture();
    const result = await syncProjectAuthentication(options);
    assert.equal(result.signerGeneration, 3);
    assert.equal(result.status, "provisioning");
    const {
      rows: [binding],
    } = await pool.query(
      "SELECT * FROM provider_bindings WHERE project_id=$1",
      [id],
    );
    assert.equal(binding.signer_generation, 3);
    assert.equal(binding.encrypted_signer, "original-ciphertext");
    assert.equal(binding.canary_verified_at, null);
    assert.equal(binding.observed_at, null);
    const {
      rows: [project],
    } = await pool.query(
      "SELECT daily_limit_microusd FROM projects WHERE id=$1",
      [id],
    );
    assert.equal(project.daily_limit_microusd, "1000");
    await syncProjectAuthentication(options);
    await assert.rejects(
      () => syncProjectAuthentication({ ...options, creatorAddress: addr() }),
      (e) => e.status === 404,
    );
  },
);
test(
  "rotation requires original creator preparation and already confirmed onchain signer, preserves old preparation recovery",
  { skip: !url },
  async () => {
    const { id, creator, options } = await fixture();
    const preparationId = randomUUID(),
      oldPreparationId = randomUUID(),
      newSigner = addr();
    await pool.query(
      `INSERT INTO signer_preparations(id,creator_address,signer_address,encrypted_signer,expires_at,claimed_project_id) VALUES($1,$2,$3,'initial-ciphertext',now()+interval '1 day',$4)`,
      [oldPreparationId, creator, addr(), id],
    );
    await pool.query(
      `INSERT INTO signer_preparations(id,creator_address,signer_address,encrypted_signer,expires_at) VALUES($1,$2,$3,'new-ciphertext',now()-interval '1 hour')`,
      [preparationId, creator, newSigner],
    );
    const registry = {
      verifyProject: async (args) => {
        assert.equal(args.inferenceSigner, newSigner);
        return { signerGeneration: 4, authenticationEnabled: true };
      },
    };
    try {
      const result = await syncProjectAuthentication({
        ...options,
        registry,
        preparationId,
      });
      assert.equal(result.signerAddress, newSigner);
      assert.equal(result.signerGeneration, 4);
      const {
        rows: [binding],
      } = await pool.query(
        "SELECT * FROM provider_bindings WHERE project_id=$1",
        [id],
      );
      assert.equal(binding.encrypted_signer, "new-ciphertext");
      assert.equal(binding.canary_verified_at, null);
      const again = await syncProjectAuthentication({
        ...options,
        registry,
        preparationId,
      });
      assert.deepEqual(again, result);
      const { rows } = await pool.query(
        "SELECT id FROM signer_preparations WHERE claimed_project_id=$1",
        [id],
      );
      assert.equal(rows.length, 2);
    } finally {
      await pool.query("DELETE FROM signer_preparations WHERE id=$1", [
        preparationId,
      ]);
    }
  },
);
test(
  "rotation cannot consume someone else preparation or downgrade a generation",
  { skip: !url },
  async () => {
    const { id, options } = await fixture();
    await assert.rejects(
      () =>
        syncProjectAuthentication({ ...options, preparationId: randomUUID() }),
      (e) => e.code === "invalid_preparation",
    );
    await assert.rejects(
      () =>
        syncProjectAuthentication({
          ...options,
          registry: {
            verifyProject: async () => ({
              signerGeneration: 0,
              authenticationEnabled: true,
            }),
          },
        }),
      (e) => e.code === "authentication_pending",
    );
    const {
      rows: [binding],
    } = await pool.query(
      "SELECT signer_generation FROM provider_bindings WHERE project_id=$1",
      [id],
    );
    assert.equal(binding.signer_generation, 1);
  },
);
