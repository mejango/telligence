/** Public gateway snapshots are observations, never wallet balance estimates. */
type CapacityStatus = "provisioning" | "ready" | "exhausted" | "stale" | "suspended";
export type ProjectSnapshot = {
  id: string;
  chainId: 8453;
  revnetId: string;
  wrapperAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  creatorAddress: `0x${string}`;
  name: string;
  purpose: string;
  workload: string;
  targetDailyCreditUsd: string | null;
  status: "accumulating" | "active" | "winddown" | "closed" | "suspended";
  createdAt: string;
  capacity: {
    status: CapacityStatus;
    dailyCreditUsd: string;
    remainingCreditUsd: string;
    observedAt: string | null;
  };
  policyVersion: string;
};

export type ComputeProjectDraft = {
  name: string;
  purpose: string;
  workload: string;
  targetDailyCreditUsd: string;
  productionSplitBps: number;
  operatorSplitBps: number;
  cashOutTaxBps: number;
  recoveryAddress?: `0x${string}`;
};

export type ComputeDeployment = {
  revnetId: string;
  wrapperAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
};

export const DEFAULT_COMPUTE_DRAFT: ComputeProjectDraft = {
  name: "",
  purpose: "",
  workload: "",
  targetDailyCreditUsd: "",
  productionSplitBps: 4000,
  operatorSplitBps: 0,
  cashOutTaxBps: 1000,
};
