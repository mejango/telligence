import { parseAbi } from 'viem';

// Narrow service ABI, matched to contracts/src interfaces. Never accepts caller-provided ABI/calldata.
export const policyAbi = parseAbi([
  'function revnetId() view returns(uint256)', 'function vault() view returns(address)',
  'function FACTORY() view returns(address)', 'function VVV() view returns(address)',
  'function TERMINAL() view returns(address)', 'function CONTROLLER() view returns(address)',
  'function totalAllocated() view returns(uint256)', 'function maxPrincipal() view returns(uint256)',
  'function minBatchTokens() view returns(uint256)', 'function maxBatchTokens() view returns(uint256)',
  'function nextConversionAt() view returns(uint256)', 'function allocationPaused() view returns(bool)',
  'function windingDown() view returns(bool)', 'function conversionCadence() view returns(uint256)',
  'function cashOutProduction(uint256 tokenCount,uint256 deadline) returns(uint256)',
  'function allocate(uint256 vvvAmount,uint256 deadline)',
  'function returnUnallocatedVVV()', 'function burnLateProduction()',
  'event CashOutProduction(uint256 indexed revnetId,uint256 tokenCount,uint256 vvvReceived,address caller)',
  'event Allocate(uint256 indexed revnetId,uint256 vvvAmount,uint256 totalAllocated)',
  'event ReturnToRevnet(uint256 indexed revnetId,uint256 amount)',
]);
export const vaultAbi = parseAbi([
  'function POLICY() view returns(address)', 'function VVV() view returns(address)',
  'function STAKING() view returns(address)', 'function DIEM() view returns(address)',
  'function state() view returns(uint8)', 'function noticeEndsAt() view returns(uint256)',
  'function totalAllocated() view returns(uint256)', 'function totalReturned() view returns(uint256)',
  'function inferenceSigner() view returns(address)', 'function signerGeneration() view returns(uint64)', 'function authenticationEnabled() view returns(bool)',
  'function beginDiemUnstake()', 'function claimDiemAndBeginVVVUnstake()', 'function claimVVVAndReturn()',
  'function claimRewardsAndReturn()', 'function returnLiquidVVV()', 'function recoverDonatedStake()',
  'event Allocated(uint256 vvvAmount,uint256 diemAmount,address indexed caller)',
  'event WinddownAdvanced(uint8 state,address indexed caller)',
  'event ReturnedToRevnet(uint256 amount,address indexed caller)',
]);
export const factoryAbi = parseAbi(['function policyOf(uint256) view returns(address)', 'function vaultOf(uint256) view returns(address)']);
export const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)']);
export const stakingAbi = parseAbi(['function stakes(address) view returns(uint256 rewardDebt,uint256 cooldownEnd,uint256 cooldownAmount)',
  'function balanceOfUnlocked(address) view returns(uint256)', 'function lockedStakes(address) view returns(uint256,uint256)']);
export const diemAbi = parseAbi(['function stakedInfos(address) view returns(uint256 amountStaked,uint256 coolDownEnd,uint256 coolDownAmount)']);
export const controllerAbi = parseAbi(['function TOKENS() view returns(address)',
  'function pendingReservedTokenBalanceOf(uint256) view returns(uint256)',
  'function sendReservedTokensToSplitsOf(uint256 projectId) returns(uint256)',
  'event BurnTokens(address indexed holder,uint256 indexed projectId,uint256 tokenCount,string memo,address caller)',
  'event SendReservedTokensToSplits(uint256 indexed rulesetId,uint256 indexed rulesetCycleNumber,uint256 indexed projectId,address owner,uint256 tokenCount,uint256 leftoverAmount,address caller)']);
export const projectTokensAbi = parseAbi(['function totalBalanceOf(address holder,uint256 projectId) view returns(uint256)']);
