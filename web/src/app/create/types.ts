import type { DraftItem } from "@/components/shop/itemDraft";
import { JBChainId } from "@bananapus/nana-sdk-core";

export type StageData = {
  initialOperator?: string; // only one operator (technically per chain) not per stage
  initialIssuance: string;
  pickUpFromPrevious?: boolean;

  priceCeilingIncreasePercentage: string;
  priceCeilingIncreaseFrequency: string;
  priceFloorTaxIntensity: string;
  /** App-specific uint14 metadata; preserved when importing a deployed stage. */
  extraMetadata?: number;

  autoIssuance: {
    amount: string;
    beneficiary: string;
    chainId: JBChainId;
  }[];

  splits: {
    percentage: string;
    defaultBeneficiary: string;
    beneficiary?: {
      chainId: JBChainId;
      address: string;
    }[];
  }[];
  stageStart: string;
  stageStartCuts?: string;
  futureStartTimestamp?: number;
};

export type CustomReserveAsset = {
  address: string;
  symbol: string;
  decimals: number | null;
  verifiedChainIds: JBChainId[];
};

/** The shop that deploys alongside the revnet. Items are optional — the collection ships
 *  either way, so an operator can stock it later without a ruleset change. */
export type StoreFormData = {
  /** Blank falls back to the revnet's own name/ticker at encode time. */
  collectionName: string;
  collectionSymbol: string;
  /** What items are priced in: the revnet's issuance/reserve denomination, or USD. */
  pricing: "reserve" | "USD";
  /** Named shelves. Id 0 is "Default" and is never listed here. */
  categories: { id: number; name: string }[];
  items: DraftItem[];
  /** Collection-level flags, fixed at launch. */
  preventOverspending: boolean;
  noNewTiersWithReserves: boolean;
  noNewTiersWithVotes: boolean;
  noNewTiersWithOwnerMinting: boolean;
  /** What the revnet operator may do to the shop after launch. */
  operatorCanAdjustTiers: boolean;
  operatorCanUpdateMetadata: boolean;
  operatorCanMint: boolean;
  operatorCanIncreaseDiscount: boolean;
};

export type RevnetFormData = {
  name: string;
  // tagline: string;
  description: string;
  logoUri?: string;

  // Optional social and website links
  twitter?: string;
  telegram?: string;
  discord?: string;
  infoUri?: string;

  tokenSymbol: string;

  stages: StageData[];
  chainIds: JBChainId[];
  operator: {
    chainId: string;
    address: string;
  }[];
  reserveAsset: "ETH" | "USDC" | "ETH_USDC" | "CUSTOM";
  issuanceBaseCurrency: "ETH" | "USD";
  customReserveAsset: CustomReserveAsset;
  store: StoreFormData;
};
