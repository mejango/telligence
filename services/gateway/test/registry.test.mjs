import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import factoryAbi from "../../../packages/contracts/TelligenceFactory.json" with { type: "json" };
import { ProjectRegistry, validateLaunchPolicy, VVV } from "../registry.mjs";
const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const blockHash = `0x${"cd".repeat(32)}`;
const manifest = {
  chainId: 8453,
  vvvAddress: VVV,
  factoryAddress: address(1),
  canonicalTerminal: address(2),
  factoryRuntimeHash: keccak256("0x1234"),
  launchPolicy: {
    conversionCadence: "3600",
    minBatchTokens: "100",
    maxBatchTokens: "1000",
    minVVVPerProjectToken: "1",
    minDiemPerVVV: "1",
    maxPrincipal: "100000",
    initialIssuance: "1000",
  },
};
const registration = {
  revnetId: "55",
  wrapperAddress: address(5),
  vaultAddress: address(6),
  creatorAddress: address(7),
  inferenceSigner: address(8),
};
function fixture(overrides = {}) {
  const calls = [],
    codeCalls = [],
    blockCalls = [];
  const values = {
    REV_DEPLOYER: address(3),
    POLICY_VERSION: 2n,
    MULTI_TERMINAL: address(2),
    PROJECTS: address(4),
    creationFee: 100n,
    policyOf: address(5),
    vaultOf: address(6),
    creatorOf: address(7),
    policyHashOf: `0x${"ab".repeat(32)}`,
    inferenceSigner: address(8),
    signerGeneration: 1n,
    authenticationEnabled: true,
  };
  const client = {
    getChainId: async () => 8453,
    getCode: async (req) => {
      codeCalls.push(req);
      return "0x1234";
    },
    getBlock: async (req) => {
      blockCalls.push(req);
      return { number: 500n, hash: blockHash };
    },
    readContract: async (req) => {
      calls.push(req);
      return values[req.functionName];
    },
    ...overrides,
  };
  return {
    registry: new ProjectRegistry({ manifest, publicClient: client }),
    calls,
    codeCalls,
    blockCalls,
    values,
  };
}
test("config returns observed factory policy version and fee only after pinned Base verification", async () => {
  const { registry, calls, codeCalls, blockCalls } = fixture();
  const config = await registry.config("https://api.test/api/v1");
  assert.equal(config.ready, true);
  assert.equal(config.creationFee, "100");
  assert.equal(config.policyVersion, "2");
  assert.deepEqual(config.launchPolicy, manifest.launchPolicy);
  assert.ok(calls.every((call) => call.blockNumber === 500n));
  assert.deepEqual(codeCalls, [{ address: address(1), blockNumber: 500n }]);
  assert.equal(blockCalls.at(-1).blockNumber, 500n);
  assert.equal(
    (await fixture({ getChainId: async () => 1 }).registry.config("x")).ready,
    false,
  );
  assert.equal(
    (await fixture({ getCode: async () => "0x55" }).registry.config("x")).ready,
    false,
  );
  const bad = fixture();
  bad.registry.manifest = { ...manifest, canonicalTerminal: address(99) };
  assert.equal((await bad.registry.config("x")).ready, false);
});
test("registration verifies actual policy version at the same block as runtime, identity and policy hash", async () => {
  for (const version of [1n, 2n]) {
    const { registry, calls, codeCalls, values } = fixture();
    values.POLICY_VERSION = version;
    const proof = await registry.verifyProject(registration);
    assert.equal(proof.policyVersion, version.toString());
    assert.equal(proof.policyHash, values.policyHashOf);
    assert.equal(proof.blockNumber, 500n);
    assert.deepEqual(codeCalls, [{ address: address(1), blockNumber: 500n }]);
    assert.ok(
      calls
        .filter((c) => c.blockTag !== "latest")
        .every((c) => c.blockNumber === 500n),
    );
    const versionRead = calls.find((c) => c.functionName === "POLICY_VERSION");
    assert.ok(versionRead);
    assert.equal(versionRead.address, manifest.factoryAddress);
    assert.deepEqual(versionRead.abi, factoryAbi);
    assert.ok(!versionRead.args || versionRead.args.length === 0);
  }
  for (const field of [
    "wrapperAddress",
    "vaultAddress",
    "creatorAddress",
    "inferenceSigner",
  ])
    await assert.rejects(() =>
      fixture().registry.verifyProject({
        ...registration,
        [field]: address(9),
      }),
    );
});
test("unconfigured or unsupported policy versions never advertise readiness or register a project", async () => {
  const empty = new ProjectRegistry({});
  assert.equal((await empty.config("x")).policyVersion, null);
  for (const invalid of [undefined, null, 0n, -1n, 3n, 1n << 256n, "2", 2]) {
    const { registry, values } = fixture();
    values.POLICY_VERSION = invalid;
    const config = await registry.config("x");
    assert.equal(config.ready, false, String(invalid));
    assert.equal(config.policyVersion, null);
    await assert.rejects(
      () => registry.verifyProject(registration),
      (e) => e.code === "deployment_unavailable",
    );
  }
});
test("a manifest policy version cannot contradict the pinned factory getter", async () => {
  const { registry } = fixture();
  registry.manifest = { ...manifest, policyVersion: "1" };
  assert.equal((await registry.config("x")).ready, false);
  await assert.rejects(
    () => registry.verifyProject(registration),
    (e) => e.code === "deployment_unavailable",
  );
});
test("a changed or unidentified verification block fails closed before returning config or registration", async () => {
  for (const method of ["config", "verifyProject"]) {
    const { registry } = fixture({
      getBlock: async (req) => ({
        number: 500n,
        hash: req.blockTag === "safe" ? blockHash : `0x${"ef".repeat(32)}`,
      }),
    });
    if (method === "config")
      assert.equal((await registry.config("x")).ready, false);
    else
      await assert.rejects(
        () => registry.verifyProject(registration),
        (e) => e.code === "deployment_unavailable",
      );
  }
  for (const block of [
    { number: null, hash: blockHash },
    { number: 500n, hash: null },
  ]) {
    const { registry } = fixture({ getBlock: async () => block });
    assert.equal((await registry.config("x")).ready, false);
    await assert.rejects(
      () => registry.verifyProject(registration),
      (e) => e.code === "deployment_unavailable",
    );
  }
});
test("launch economics never silently default invalid or unbounded policy values", () => {
  assert.equal(
    validateLaunchPolicy(manifest.launchPolicy),
    manifest.launchPolicy,
  );
  for (const invalid of [
    {},
    { ...manifest.launchPolicy, minVVVPerProjectToken: "0" },
    { ...manifest.launchPolicy, conversionCadence: (1n << 48n).toString() },
    { ...manifest.launchPolicy, minBatchTokens: "1001" },
  ])
    assert.throws(() => validateLaunchPolicy(invalid));
});
