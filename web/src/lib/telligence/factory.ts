import { parseAbi } from "viem";

/** Public ABI surface; checked against Foundry artifacts by the integration suite. */
export const computeFactoryAbi = parseAbi([
  "struct Description { string name; string ticker; string uri; bytes32 salt; }",
  "struct Stage { uint48 startsAtOrAfter; uint16 splitPercent; uint112 initialIssuance; uint32 issuanceCutFrequency; uint32 issuanceCutPercent; uint16 cashOutTaxRate; uint16 operatorSplitPercent; }",
  "struct Policy { uint48 conversionCadence; uint128 minBatchTokens; uint128 maxBatchTokens; uint128 minVVVPerProjectToken; uint128 minDiemPerVVV; uint128 maxPrincipal; }",
  "function deployFor(Description description, Stage[] stages, Policy policyConfig, address recovery, address inferenceSigner) payable returns (uint256 revnetId, address policy, address vault)",
  "function REV_DEPLOYER() view returns (address)",
  "function policyOf(uint256 revnetId) view returns (address)",
  "function vaultOf(uint256 revnetId) view returns (address)",
  "function creatorOf(uint256 revnetId) view returns (address)",
  "function policyHashOf(uint256 revnetId) view returns (bytes32)",
  "event DeployProject(uint256 indexed revnetId, address indexed creator, address policy, address vault, bytes32 policyHash)",
]);

export const computeReadAbi = parseAbi([
  "function PROJECTS() view returns (address)",
  "function MULTI_TERMINAL() view returns (address)",
  "function creationFee() view returns (uint256)",
  "function getDiemAmountOut(uint256 amount) view returns (uint256)",
  "function state() view returns (uint8)",
]);
