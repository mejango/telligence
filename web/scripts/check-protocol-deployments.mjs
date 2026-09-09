import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixturePath = resolve("test/fixtures/protocol-deployments.v6.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const addressPattern = /^0x[0-9a-f]{40}$/;

const expectedChains = {
  1: { deploymentDirectory: "ethereum", ccipSuffix: "ETH", nativeArtifact: null },
  10: {
    deploymentDirectory: "optimism",
    ccipSuffix: "OP",
    nativeArtifact: "JBOptimismSuckerDeployer",
  },
  8453: {
    deploymentDirectory: "base",
    ccipSuffix: "BASE",
    nativeArtifact: "JBBaseSuckerDeployer",
  },
  42161: {
    deploymentDirectory: "arbitrum",
    ccipSuffix: "ARB",
    nativeArtifact: "JBArbitrumSuckerDeployer",
  },
  84532: {
    deploymentDirectory: "base_sepolia",
    ccipSuffix: "BASE_SEP",
    nativeArtifact: "JBBaseSuckerDeployer",
  },
  421614: {
    deploymentDirectory: "arbitrum_sepolia",
    ccipSuffix: "ARB_SEP",
    nativeArtifact: "JBArbitrumSuckerDeployer",
  },
  11155111: {
    deploymentDirectory: "sepolia",
    ccipSuffix: "ETH_SEP",
    nativeArtifact: null,
  },
  11155420: {
    deploymentDirectory: "optimism_sepolia",
    ccipSuffix: "OP_SEP",
    nativeArtifact: "JBOptimismSuckerDeployer",
  },
};

const chainFamilies = [
  ["1", "10", "8453", "42161"],
  ["11155111", "11155420", "84532", "421614"],
];
const l1ByFamily = new Map(
  chainFamilies.flatMap((family) => family.map((chainId) => [chainId, family[0]])),
);

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(
      `${label} keys must be [${wanted.join(", ")}], received [${actual.join(", ")}]`,
    );
  }
}

function validateDeployment(entry, expectedArtifact, label) {
  assertExactKeys(entry, ["artifact", "address"], label);
  if (entry.artifact !== expectedArtifact) {
    throw new Error(`${label} must use ${expectedArtifact}, received ${entry.artifact}`);
  }
  if (!addressPattern.test(entry.address)) {
    throw new Error(`${label} has an invalid normalized address: ${entry.address}`);
  }
}

if (fixture.format !== "revnet-v6-app-deployments-2") {
  throw new Error(`Unsupported deployment fixture format in ${fixturePath}`);
}
if (fixture.source?.repository !== "https://github.com/Bananapus/deploy-all-v6") {
  throw new Error("Protocol fixture must identify the canonical deploy-all-v6 repository");
}
if (!/^[0-9a-f]{40}$/.test(fixture.source?.commit ?? "")) {
  throw new Error("Protocol fixture must pin a full deploy-all-v6 commit");
}

assertExactKeys(fixture.chains, Object.keys(expectedChains), "Protocol fixture chains");

const deploymentsToCheck = [];
for (const [chainId, chainMetadata] of Object.entries(expectedChains)) {
  const chain = fixture.chains[chainId];
  assertExactKeys(
    chain,
    ["deploymentDirectory", "revDeployer", "ccipSuckerDeployers", "nativeSuckerDeployers"],
    `Chain ${chainId}`,
  );
  if (chain.deploymentDirectory !== chainMetadata.deploymentDirectory) {
    throw new Error(
      `Chain ${chainId} must use deployment directory ${chainMetadata.deploymentDirectory}, received ${chain.deploymentDirectory}`,
    );
  }

  validateDeployment(chain.revDeployer, "REVDeployer", `REVDeployer on chain ${chainId}`);
  deploymentsToCheck.push({
    deploymentDirectory: chain.deploymentDirectory,
    ...chain.revDeployer,
    label: `REVDeployer on chain ${chainId}`,
  });

  const family = chainFamilies.find((candidate) => candidate.includes(chainId));
  const expectedCcipRemotes = family.filter((remoteChainId) => remoteChainId !== chainId);
  assertExactKeys(
    chain.ccipSuckerDeployers,
    expectedCcipRemotes,
    `CCIP sucker deployers from chain ${chainId}`,
  );
  for (const remoteChainId of expectedCcipRemotes) {
    const entry = chain.ccipSuckerDeployers[remoteChainId];
    const artifact = `JBCCIPSuckerDeployer__${expectedChains[remoteChainId].ccipSuffix}`;
    const label = `CCIP sucker deployer ${chainId} -> ${remoteChainId}`;
    validateDeployment(entry, artifact, label);
    deploymentsToCheck.push({
      deploymentDirectory: chain.deploymentDirectory,
      ...entry,
      label,
    });
  }

  const l1 = l1ByFamily.get(chainId);
  const expectedNativeRemotes = chainId === l1 ? family.slice(1) : [l1];
  assertExactKeys(
    chain.nativeSuckerDeployers,
    expectedNativeRemotes,
    `Native sucker deployers from chain ${chainId}`,
  );
  for (const remoteChainId of expectedNativeRemotes) {
    const entry = chain.nativeSuckerDeployers[remoteChainId];
    const l2ChainId = chainId === l1 ? remoteChainId : chainId;
    const artifact = expectedChains[l2ChainId].nativeArtifact;
    const label = `Native sucker deployer ${chainId} -> ${remoteChainId}`;
    validateDeployment(entry, artifact, label);
    deploymentsToCheck.push({
      deploymentDirectory: chain.deploymentDirectory,
      ...entry,
      label,
    });
  }
}

const sourceRoot = process.env.PROTOCOL_DEPLOYMENTS_DIR;
if (!sourceRoot) {
  console.log(
    `Pinned ${deploymentsToCheck.length} Revnet deployment artifacts from deploy-all-v6 ${fixture.source.commit}. ` +
      "Set PROTOCOL_DEPLOYMENTS_DIR to verify the independent artifacts.",
  );
  process.exit(0);
}

const root = resolve(sourceRoot);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (sourceCommit !== fixture.source.commit) {
  throw new Error(`deploy-all-v6 is at ${sourceCommit}; fixture requires ${fixture.source.commit}`);
}

for (const deployment of deploymentsToCheck) {
  const artifactPath = join(
    root,
    "deployments",
    deployment.deploymentDirectory,
    `${deployment.artifact}.json`,
  );
  const actual = JSON.parse(readFileSync(artifactPath, "utf8")).address?.toLowerCase();
  if (actual !== deployment.address) {
    throw new Error(`${deployment.label}: fixture=${deployment.address}, artifact=${actual}`);
  }
}

console.log(
  `Verified ${deploymentsToCheck.length} Revnet deployment artifacts against deploy-all-v6 ${sourceCommit}.`,
);
