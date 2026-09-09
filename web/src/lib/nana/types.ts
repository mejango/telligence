import type { JBChainId, JBProjectMetadata, JBProjectToken } from "@bananapus/nana-sdk-core";
import type { Address, Hash } from "viem";

export type { JBChainId } from "@bananapus/nana-sdk-core";

/**
 * Small app-owned async state shape used by the project contexts.
 *
 * Keeping this shape stable decouples project UI from framework-specific SDK
 * packages without changing its loading and error rendering.
 */
export type AsyncData<T> = {
  data: T | null | undefined;
  isLoading: boolean;
  error?: Error | null;
  refetch?: () => Promise<unknown>;
};

export type ProjectTokenData = {
  address: Address;
  decimals: number;
  name: string | undefined;
  symbol: string | undefined;
  totalSupply: {
    formatted: string;
    value: bigint;
  };
};

export type JBTokenContextData = {
  token: AsyncData<ProjectTokenData>;
  totalOutstanding: AsyncData<JBProjectToken>;
};

export type InitialProjectData = {
  metadata?: Pick<JBProjectMetadata, "name"> &
    Partial<Pick<JBProjectMetadata, "logoUri" | "description">>;
  token?: Partial<Pick<ProjectTokenData, "name" | "symbol">> &
    Pick<ProjectTokenData, "address" | "decimals"> &
    Partial<Pick<ProjectTokenData, "totalSupply">>;
};

export type SuckerPair = {
  peerChainId: JBChainId;
  projectId: bigint;
};

export type ChainPayment = {
  amount: `0x${string}`;
  calldata: `0x${string}`;
  chain: JBChainId;
  payment_deadline: string;
  target: `0x${string}`;
  token: `0x${string}`;
};

type TransactionRequest = {
  chain: JBChainId;
  target: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  gas_limit: `0x${string}`;
  virtual_nonce: null | number;
};

type TransactionStatus =
  | {
      state: "Pending" | "Completed" | "Failed" | "Included";
      data?: {
        block_hash: `0x${string}`;
        transaction: { hash: Hash };
      };
    }
  | {
      state: "Success";
      data?: { hash: Hash };
    };

type RelayrTransaction = {
  tx_uuid: string;
  request: TransactionRequest;
  status: TransactionStatus;
};

type PerTransaction = {
  gas_cost: number;
  priced_in: {
    asset: string;
    type: string;
  };
  value: number;
};

export type RelayrPostBundleResponse = {
  bundle_uuid: string;
  payment_info: ChainPayment[];
  per_txn: PerTransaction[];
  txn_uuids: string[];
};

export type RelayrGetBundleResponse = {
  bundle_uuid: string;
  created_at: string;
  expires_at: string;
  payment: ChainPayment[];
  payment_received: boolean;
  transactions: RelayrTransaction[];
};
