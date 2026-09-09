import { defaultStoreData } from "@/app/create/constants";
import type { RevnetFormData } from "@/app/create/types";
import type { Address, Hex } from "viem";
import { sepolia } from "viem/chains";
import protocolDeployments from "./protocol-deployments.v6.json";

export const TEST_ACCOUNT: Address = "0x000000000000000000000000000000000000dEaD";
export const TEST_BENEFICIARY: Address = "0x000000000000000000000000000000000000bEEF";
export const TEST_SALT: Hex = "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
export const TEST_TIMESTAMP = 1_750_000_000;

// Independently pinned from deploy-all-v6 at the reviewed commit below. This
// must not be imported from the SDK: the fixture exists to catch SDK/frontend
// address-book drift against the contract deployment source of truth.
export const DEPLOY_ALL_FIXTURE_COMMIT = protocolDeployments.source.commit;
export const PROTOCOL_DEPLOYMENTS = protocolDeployments.chains;
export const SEPOLIA_REV_DEPLOYER = protocolDeployments.chains[sepolia.id].revDeployer.address;

export function validRevnetForm(): RevnetFormData {
  return {
    name: "Safety Test Revnet",
    description: "A deterministic fixture for contract-facing tests.",
    logoUri: "ipfs://bafy-logo",
    twitter: "revnet_test",
    telegram: "t.me/revnet_test",
    discord: "discord.gg/revnet-test",
    infoUri: "https://example.com",
    tokenSymbol: "SAFE",
    store: structuredClone(defaultStoreData),
    reserveAsset: "ETH",
    issuanceBaseCurrency: "ETH",
    customReserveAsset: {
      address: "",
      symbol: "",
      decimals: null,
      verifiedChainIds: [],
    },
    chainIds: [sepolia.id],
    operator: [{ chainId: String(sepolia.id), address: TEST_ACCOUNT }],
    stages: [
      {
        initialOperator: TEST_ACCOUNT,
        initialIssuance: "1000",
        priceCeilingIncreasePercentage: "10",
        priceCeilingIncreaseFrequency: "30",
        priceFloorTaxIntensity: "20",
        autoIssuance: [
          {
            chainId: sepolia.id,
            amount: "25",
            beneficiary: TEST_BENEFICIARY,
          },
        ],
        splits: [
          {
            percentage: "25",
            defaultBeneficiary: TEST_BENEFICIARY,
            beneficiary: [{ chainId: sepolia.id, address: TEST_BENEFICIARY }],
          },
        ],
        stageStart: "0",
      },
    ],
  };
}

export const EMPTY_SUCKER_CONFIG = {
  deployerConfigurations: [],
  salt: TEST_SALT,
};
