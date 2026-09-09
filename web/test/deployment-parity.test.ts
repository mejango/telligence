import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import {
  CCIP_SUCKER_DEPLOYER_ADDRESSES,
  jbContractAddress,
  MappableAsset,
  NATIVE_SUCKER_DEPLOYER_ADDRESSES,
  NATIVE_TOKEN,
  parseSuckerDeployerConfig,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { pad, zeroHash, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEPLOY_ALL_FIXTURE_COMMIT,
  EMPTY_SUCKER_CONFIG,
  PROTOCOL_DEPLOYMENTS,
  TEST_SALT,
  TEST_TIMESTAMP,
  validRevnetForm,
} from "./fixtures/revnet";

type DeploymentEntry = { artifact: string; address: Address };
type DeploymentChain = {
  deploymentDirectory: string;
  revDeployer: DeploymentEntry;
  ccipSuckerDeployers: Record<string, DeploymentEntry>;
  nativeSuckerDeployers: Record<string, DeploymentEntry>;
};
type DeploymentPairField = "ccipSuckerDeployers" | "nativeSuckerDeployers";

const fixtureChains = PROTOCOL_DEPLOYMENTS as unknown as Record<string, DeploymentChain>;
const MAINNETS = [1, 10, 8453, 42161] as const satisfies readonly JBChainId[];
const TESTNETS = [11155111, 11155420, 84532, 421614] as const satisfies readonly JBChainId[];
const NETWORK_FAMILIES = [MAINNETS, TESTNETS];
const SUPPORTED_CHAIN_IDS = [...MAINNETS, ...TESTNETS];
const CREATION_FEE = 123_456n;

function fixtureChain(chainId: JBChainId): DeploymentChain {
  return fixtureChains[String(chainId)];
}

function fixtureAddressMap(field: DeploymentPairField) {
  return Object.fromEntries(
    Object.entries(fixtureChains).map(([localChainId, chain]) => [
      localChainId,
      Object.fromEntries(
        Object.entries(chain[field]).map(([remoteChainId, deployment]) => [
          remoteChainId,
          deployment.address,
        ]),
      ),
    ]),
  );
}

function normalizeSdkAddressMap(
  map: (typeof CCIP_SUCKER_DEPLOYER_ADDRESSES)[6],
): Record<string, Record<string, Address>> {
  return Object.fromEntries(
    Object.entries(map).map(([localChainId, remotes]) => [
      localChainId,
      Object.fromEntries(
        Object.entries(remotes).map(([remoteChainId, address]) => [
          remoteChainId,
          address.toLowerCase() as Address,
        ]),
      ),
    ]),
  );
}

function expectedNativeMapping() {
  return {
    localToken: NATIVE_TOKEN,
    minGas: 200_000,
    remoteToken: pad(NATIVE_TOKEN),
  };
}

function expectedConfiguration(deployer: Address) {
  return {
    deployer,
    peer: zeroHash,
    mappings: [expectedNativeMapping()],
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("deploy-all and SDK deployment parity", () => {
  it("targets the independently pinned REVDeployer on every chain offered by create", () => {
    expect(DEPLOY_ALL_FIXTURE_COMMIT).toBe("316e9d4d3f9e1c5b41a5df7c0ad6183abbeccc7f");
    expect(
      Object.keys(fixtureChains)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...SUPPORTED_CHAIN_IDS].sort((a, b) => a - b));

    for (const chainId of SUPPORTED_CHAIN_IDS) {
      const request = parseDeployData(validRevnetForm(), {
        metadataCid: "bafy-metadata",
        chainId,
        suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
        timestamp: TEST_TIMESTAMP,
        salt: TEST_SALT,
        creationFee: CREATION_FEE,
      });
      const expected = fixtureChain(chainId).revDeployer.address;

      expect(jbContractAddress[6].REVDeployer[chainId]).toBe(expected);
      expect(request.address).toBe(expected);
      expect(request.chainId).toBe(chainId);
    }
  });

  it("matches every v6 CCIP deployer constant to the contract-derived fixture", () => {
    expect(normalizeSdkAddressMap(CCIP_SUCKER_DEPLOYER_ADDRESSES[6])).toEqual(
      fixtureAddressMap("ccipSuckerDeployers"),
    );
  });

  it("matches every v6 native deployer constant to the contract-derived fixture", () => {
    expect(normalizeSdkAddressMap(NATIVE_SUCKER_DEPLOYER_ADDRESSES[6])).toEqual(
      fixtureAddressMap("nativeSuckerDeployers"),
    );
  });

  it("keeps create's default CCIP parser output exact for both chain families", () => {
    for (const family of NETWORK_FAMILIES) {
      for (const targetChainId of family) {
        const chains = [...family];
        const remoteChainIds = family.filter((chainId) => chainId !== targetChainId);
        const expected = {
          salt: TEST_SALT,
          deployerConfigurations: remoteChainIds.map((remoteChainId) =>
            expectedConfiguration(
              fixtureChain(targetChainId).ccipSuckerDeployers[String(remoteChainId)].address,
            ),
          ),
        };

        expect(
          parseSuckerDeployerConfig(targetChainId, chains, [MappableAsset.NATIVE], {
            version: 6,
            salt: TEST_SALT,
          }),
        ).toEqual(expected);
        expect(
          parseSuckerDeployerConfig(targetChainId, chains, [MappableAsset.NATIVE], {
            version: 6,
            bridge: "ccip",
            salt: TEST_SALT,
          }),
        ).toEqual(expected);
      }
    }
  });

  it("keeps every native parser route exact", () => {
    for (const targetChainId of SUPPORTED_CHAIN_IDS) {
      for (const [remoteChainId, deployment] of Object.entries(
        fixtureChain(targetChainId).nativeSuckerDeployers,
      )) {
        expect(
          parseSuckerDeployerConfig(
            targetChainId,
            [targetChainId, Number(remoteChainId) as JBChainId],
            [MappableAsset.NATIVE],
            { version: 6, bridge: "native", salt: TEST_SALT },
          ),
        ).toEqual({
          salt: TEST_SALT,
          deployerConfigurations: [expectedConfiguration(deployment.address)],
        });
      }
    }
  });

  it("orders native before CCIP for dual routes and falls back to CCIP for L2 peers", () => {
    for (const family of NETWORK_FAMILIES) {
      for (const targetChainId of family) {
        for (const remoteChainId of family.filter((chainId) => chainId !== targetChainId)) {
          const chain = fixtureChain(targetChainId);
          const native = chain.nativeSuckerDeployers[String(remoteChainId)];
          const expectedDeployers = [
            ...(native ? [native.address] : []),
            chain.ccipSuckerDeployers[String(remoteChainId)].address,
          ];

          const result = parseSuckerDeployerConfig(
            targetChainId,
            [targetChainId, remoteChainId],
            [MappableAsset.NATIVE],
            { version: 6, bridge: "both", salt: TEST_SALT },
          );

          expect(result).toEqual({
            salt: TEST_SALT,
            deployerConfigurations: expectedDeployers.map(expectedConfiguration),
          });
        }
      }
    }
  });
});
