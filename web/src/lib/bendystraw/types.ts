type BigNumberish = string | number;
export type BendystrawFilter = Record<string, unknown>;

/** One token a project's terminals hold: the exact store balance and its value at the token's
 *  latest indexed USD rate (18 decimals). `tokenSymbol` is null when unreadable. */
export type ProjectTokenBalance = {
  token: string;
  tokenSymbol: string | null;
  decimals: number;
  balance: BigNumberish;
  balanceUsd?: BigNumberish;
  usdRate?: BigNumberish | null;
};
type ProjectTokenBalances = { projectTokenBalances?: { items: ProjectTokenBalance[] } | null };

export type Project = {
  /** More than one means the raw `balance` adds different token units. */
  accountingTokenCount?: number | null;
  balance: BigNumberish;
  /** Flow-accrued USD balance, 18-dec. */
  balanceUsd?: BigNumberish | null;
  chainId: number;
  createdAt: number;
  currency: BigNumberish | null;
  decimals: number | null;
  description?: string | null;
  handle: string | null;
  isRevnet: boolean | null;
  logoUri: string | null;
  metadata?: unknown;
  metadataUri: string | null;
  name: string | null;
  owner: string;
  projectId: number;
  projectTagline?: string | null;
  suckerGroupId: string;
  token: string | null;
  tokenSupply: BigNumberish;
  tokenSymbol: string | null;
  version: number;
};

type Participant = {
  address: string;
  balance: BigNumberish;
  chainId: number;
  creditBalance: BigNumberish;
  erc20Balance: BigNumberish;
  lastPaidTimestamp: number;
  projectId: number;
  suckerGroupId: string;
  version: number;
  volume: BigNumberish;
};

export type PermissionHolder = {
  account: string;
  chainId: number;
  isRevnetOperator: boolean | null;
  operator: string;
  permissions: number[] | null;
  projectId: number;
  version: number;
};

export type ProjectPayer = {
  addToBalanceCount: number;
  address: string;
  balanceAdded: BigNumberish;
  balanceAddedUsd: BigNumberish;
  chainId: number;
  createdAt: number;
  defaultAddToBalance: boolean;
  defaultBeneficiary: string;
  defaultMemo: string;
  defaultMetadata: string;
  deployer: string;
  lastUsedAt: number | null;
  owner: string;
  paymentsCount: number;
  projectId: number;
  suckerGroupId: string;
  totalFacilitated: BigNumberish;
  totalFacilitatedUsd: BigNumberish;
  version: number;
  volume: BigNumberish;
  volumeUsd: BigNumberish;
};

export type PermissionHolderFilter = BendystrawFilter;
export type ProjectPayerFilter = BendystrawFilter;

export type ProjectQueryVariables = {
  projectId: number;
  chainId: number;
  version: number;
};
/** One deployment's indexed payment notice. */
export type ProjectPayNoticeQuery = {
  project: {
    chainId: number;
    projectId: number;
    version: number;
    payDisclosure: string | null;
  } | null;
};
export type ProjectQuery = {
  project: Pick<
    Project,
    | "projectId"
    | "metadataUri"
    | "handle"
    | "createdAt"
    | "description"
    | "suckerGroupId"
    | "logoUri"
    | "name"
    | "projectTagline"
    | "version"
    | "token"
    | "decimals"
    | "currency"
    | "tokenSymbol"
    | "isRevnet"
  > | null;
};

export type ProjectAccountingContextQueryVariables = ProjectQueryVariables;
export type ProjectAccountingContextQuery = {
  project: Pick<Project, "token" | "decimals" | "currency"> | null;
};

type SuckerGroupProject = Pick<
  Project,
  | "accountingTokenCount"
  | "balance"
  | "chainId"
  | "currency"
  | "decimals"
  | "projectId"
  | "token"
  | "tokenSymbol"
  | "version"
  | "suckerGroupId"
> & { tokenSupply: BigNumberish } & ProjectTokenBalances;

export type SuckerGroupQueryVariables = { id: string };
export type SuckerGroupQuery = {
  suckerGroup: {
    id: string;
    paymentsCount: number;
    tokenSupply: BigNumberish;
    volumeUsd: BigNumberish;
    projects: { items: SuckerGroupProject[] } | null;
  } | null;
};

export type IndexedProjectSummary = Pick<
  Project,
  | "accountingTokenCount"
  | "chainId"
  | "createdAt"
  | "handle"
  | "isRevnet"
  | "logoUri"
  | "metadataUri"
  | "name"
  | "projectId"
  | "projectTagline"
  | "suckerGroupId"
  | "tokenSymbol"
  | "version"
> & {
  volumeUsd?: BigNumberish | null;
  currency?: BigNumberish | null;
  decimals?: number | null;
  trendingPaymentsCount?: number;
  trendingScore?: BigNumberish;
  trendingVolume?: BigNumberish;
  trendingVolumeUsd?: BigNumberish | null;
};
export type IndexedProjectsQueryVariables = {
  where: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
  limit?: number;
  offset?: number;
};
export type IndexedProjectsQuery = {
  projects: { items: IndexedProjectSummary[]; totalCount: number };
};
export type IndexedSuckerGroupQueryVariables = { id: string };
export type IndexedSuckerGroupQuery = {
  suckerGroup: { projects: { items: IndexedProjectSummary[] } | null } | null;
};

export type AccountTokenBalancesQueryVariables = {
  account: string;
  limit?: number;
  offset?: number;
};
export type AccountTokenBalanceRow = Pick<
  Participant,
  "chainId" | "projectId" | "version" | "balance" | "creditBalance" | "erc20Balance"
>;
export type AccountTokenBalancesQuery = {
  participants: { totalCount: number; items: AccountTokenBalanceRow[] };
};

export type ParticipantsQueryVariables = {
  where?: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
  limit?: number;
  offset?: number;
};
export type ParticipantsQuery = {
  participants: {
    totalCount: number;
    items: Array<
      Pick<
        Participant,
        | "chainId"
        | "projectId"
        | "version"
        | "address"
        | "volume"
        | "lastPaidTimestamp"
        | "balance"
        | "erc20Balance"
        | "creditBalance"
      >
    >;
  };
};

type ActivityProject = Pick<Project, "projectId" | "handle" | "version"> & {
  id?: string;
  chainId?: number;
  name?: string | null;
  logoUri?: string | null;
  metadataUri?: string | null;
  projectTagline?: string | null;
  tokenSymbol?: string | null;
  decimals?: number | null;
  isRevnet?: boolean | null;
  suckerGroupId?: string;
};
type ActivityPayment = {
  id: string;
  amount: BigNumberish;
  beneficiary: string;
  memo: string | null;
  timestamp: number;
  feeFromProject: number | null;
  newlyIssuedTokenCount: BigNumberish;
  from: string;
  txHash: string;
  amountUsd: BigNumberish;
  caller: string;
  distributionFromProjectId: number | null;
  projectId: number;
  project: ActivityProject | null;
} & EventToken;
/** The token a terminal event moved. Null when the indexer could not tell (valued at 0 USD). */
export type EventToken = {
  token?: string | null;
  decimals?: number | null;
  tokenSymbol?: string | null;
};
type ActivityCashOut = {
  id: string;
  timestamp: number;
  txHash: string;
  from: string;
  beneficiary: string;
  reclaimAmount: BigNumberish;
  reclaimAmountUsd: BigNumberish;
  cashOutCount: BigNumberish;
  metadata: string;
  /** Whose tokens were cashed out. A sucker's own cash out is the inside of a bridge send. */
  holder?: string;
  project: ActivityProject | null;
} & EventToken;
/** Tokens queued on a sucker for another chain (`prepare`). */
type ActivityBridgeSend = {
  txHash: string;
  timestamp: number;
  /** Who called the sucker: a Safe here, not the account that executed its transaction. */
  caller: string;
  peerChainId: number;
  projectTokenCount: BigNumberish;
  sucker: string;
};
type ActivityBase = { txHash: string; timestamp: number; from: string };

export type ActivityEventsQueryVariables = {
  where?: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
  limit?: number;
  offset?: number;
};
export type ActivityEventsQuery = {
  activityEvents: {
    totalCount?: number;
    items: Array<{
      id: string;
      chainId: number;
      timestamp: number;
      txHash: string;
      project?: ActivityProject | null;
      payEvent: ActivityPayment | null;
      cashOutTokensEvent: ActivityCashOut | null;
      bridgeToOutboxEvent?: ActivityBridgeSend | null;
      /** Tokens claimed here from another chain. `beneficiary` can be a 32-byte value. */
      bridgeClaimEvent?: {
        txHash: string;
        timestamp: number;
        beneficiary: string;
        peerChainId: number;
        projectTokenCount: BigNumberish;
      } | null;
      borrowLoanEvent?: (ActivityBase & { beneficiary: string; collateral: BigNumberish }) | null;
      /** `caller` called the loans contract: a Safe here, not the account that executed for it. */
      repayLoanEvent?: { txHash: string; timestamp: number; caller: string } | null;
      liquidateLoanEvent?: { txHash: string; timestamp: number; caller: string } | null;
      addToBalanceEvent:
        | (ActivityBase &
            EventToken & {
              amount: BigNumberish;
              amountUsd?: BigNumberish | null;
              memo: string | null;
            })
        | null;
      mintTokensEvent:
        | (ActivityBase & {
            id: string;
            caller: string;
            beneficiary: string;
            beneficiaryTokenCount: BigNumberish;
            memo: string | null;
          })
        | null;
      manualMintTokensEvent:
        | (ActivityBase & {
            id: string;
            beneficiary: string;
            beneficiaryTokenCount: BigNumberish;
            memo: string | null;
          })
        | null;
      autoIssueEvent:
        (ActivityBase & { id: string; beneficiary: string; count: BigNumberish }) | null;
      deployErc20Event: (ActivityBase & { symbol: string }) | null;
      projectCreateEvent: ActivityBase | null;
      projectTransferEvent: (ActivityBase & { previousOwner: string; owner: string }) | null;
      operatorPermissionsSetEvent:
        | (ActivityBase & { caller: string; operator: string; isRevnetOperator: boolean | null })
        | null;
      rulesetQueuedEvent: (ActivityBase & { caller: string; cycleNumber: number }) | null;
      swapEvent:
        | (ActivityBase & {
            caller: string;
            direction: string;
            terminalTokenAmount: BigNumberish;
            projectTokenAmount: BigNumberish;
          })
        | null;
      buybackPoolEvent: (ActivityBase & { caller: string }) | null;
      mintNftEvent?:
        | (ActivityBase & {
            beneficiary: string;
            hook: string;
            tierId: number;
            tokenId: BigNumberish;
            totalAmountPaid: BigNumberish;
          })
        | null;
      sendPayoutsEvent?:
        | (ActivityBase & {
            caller: string;
            amount: BigNumberish;
            amountPaidOut: BigNumberish;
            amountPaidOutUsd: BigNumberish;
          } & EventToken)
        | null;
      sendReservedTokensToSplitsEvent?: (ActivityBase & { tokenCount: BigNumberish }) | null;
      sendReservedTokensToSplitEvent?:
        | (ActivityBase & {
            id: string;
            tokenCount: BigNumberish;
            beneficiary: string;
            splitProjectId: number;
            /** The split hook; a Sticky split's splitProjectId is its holder group. */
            hook?: string;
          })
        | null;
    }>;
  };
};

type AccountActivityProject = Pick<Project, "projectId" | "handle" | "version" | "chainId"> & {
  name: string | null;
  tokenSymbol: string | null;
  decimals: number | null;
};

export type AccountActivityEventItem = ActivityEventsQuery["activityEvents"]["items"][number] & {
  from: string;
  project: AccountActivityProject | null;
};

type BeneficiaryRow<TKey extends keyof AccountActivityEventItem> = Omit<
  NonNullable<AccountActivityEventItem[TKey]>,
  "project"
> & {
  chainId: number;
  project: AccountActivityProject | null;
};

export type AccountActivityEventsQueryVariables = {
  address: string;
  limit?: number;
  offset?: number;
};
export type AccountActivityEventsQuery = {
  activityEvents: {
    totalCount?: number;
    items: AccountActivityEventItem[];
  };
  /**
   * Events where the account is only the beneficiary — the top-level
   * activityEventFilter has no beneficiary field, so these come from the
   * beneficiary-bearing sub-event roots and are merged client-side.
   */
  beneficiaryPayEvents?: {
    totalCount?: number;
    items: BeneficiaryRow<"payEvent">[];
  };
  beneficiaryCashOutEvents?: {
    totalCount?: number;
    items: BeneficiaryRow<"cashOutTokensEvent">[];
  };
  beneficiaryMintTokensEvents?: {
    totalCount?: number;
    items: BeneficiaryRow<"mintTokensEvent">[];
  };
  beneficiaryManualMintTokensEvents?: {
    totalCount?: number;
    items: BeneficiaryRow<"manualMintTokensEvent">[];
  };
  beneficiaryAutoIssueEvents?: {
    totalCount?: number;
    items: BeneficiaryRow<"autoIssueEvent">[];
  };
  beneficiarySendReservedTokensToSplitEvents?: {
    totalCount?: number;
    items: BeneficiaryRow<"sendReservedTokensToSplitEvent">[];
  };
};

export type OwnedProjectRow = Pick<
  Project,
  | "chainId"
  | "projectId"
  | "version"
  | "name"
  | "handle"
  | "logoUri"
  | "owner"
  | "isRevnet"
  | "suckerGroupId"
  | "tokenSymbol"
  | "createdAt"
>;
export type ProjectsByOwnerQueryVariables = {
  where: BendystrawFilter;
  limit?: number;
  offset?: number;
};
export type ProjectsByOwnerQuery = {
  projects: { items: OwnedProjectRow[]; totalCount: number };
};

/**
 * The project ERC-20's ticker (from its deploy event). Distinct from the
 * project row's `tokenSymbol`, which names the ACCOUNTING context's token.
 */
export type ProjectErc20TickerRow = { chainId: number; projectId: number; symbol: string };
export type ProjectErc20TickersQueryVariables = {
  where: BendystrawFilter;
  limit?: number;
  offset?: number;
};
export type ProjectErc20TickersQuery = {
  deployErc20Events: { items: ProjectErc20TickerRow[]; totalCount?: number };
};

export type AccountPermissionHolderRow = Pick<
  PermissionHolder,
  "chainId" | "projectId" | "account" | "operator" | "permissions" | "isRevnetOperator" | "version"
> & { project: { name: string | null; handle: string | null } | null };
export type AccountPermissionHoldersQueryVariables = {
  where: BendystrawFilter;
  limit?: number;
  offset?: number;
};
export type AccountPermissionHoldersQuery = {
  permissionHolders: { items: AccountPermissionHolderRow[]; totalCount: number } | null;
};

export type HasPermissionQueryVariables = {
  account: string;
  chainId: number;
  projectId: number;
  operator: string;
  version: number;
};
export type HasPermissionQuery = {
  permissionHolder: { permissions: number[] | null } | null;
};

export type ProjectOperatorQueryVariables = {
  chainId: number;
  projectId: number;
  version: number;
};
export type ProjectOperatorQuery = {
  permissionHolders: {
    items: Array<{
      chainId: number;
      projectId: number;
      version: number;
      operator: string;
    }>;
  };
};

export type ProjectWithPermissionsQueryVariables = ProjectQueryVariables;
export type ProjectWithPermissionsQuery = {
  project: {
    projectId: number;
    chainId: number;
    version: number;
    owner: string;
    permissionHolders: {
      items: Array<Pick<PermissionHolder, "account" | "operator" | "permissions">>;
    } | null;
  } | null;
};

export type StoreAutoIssuanceAmountEventsQueryVariables = {
  where?: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
};
export type StoreAutoIssuanceAmountEventsQuery = {
  storeAutoIssuanceAmountEvents: {
    items: Array<{
      id: string;
      chainId: number;
      projectId: number;
      version: number;
      beneficiary: string;
      count: BigNumberish;
      stageId: BigNumberish;
      caller: string;
    }>;
  };
};

export type AutoIssueEventsQueryVariables = StoreAutoIssuanceAmountEventsQueryVariables;
export type AutoIssueEventsQuery = {
  autoIssueEvents: {
    items: Array<{
      id: string;
      chainId: number;
      projectId: number;
      version: number;
      stageId: BigNumberish;
      beneficiary: string;
      count: BigNumberish;
      caller: string;
    }>;
  };
};

type LoanRow = {
  borrowAmount: BigNumberish;
  collateral: BigNumberish;
  prepaidDuration: number;
  projectId: number;
  terminal: string;
  token: string;
  chainId: number;
  createdAt: number;
  id: BigNumberish;
  project: { version: number } | null;
};
export type LoansByAccountQueryVariables = {
  owner: string;
  version: number;
  limit?: number;
  offset?: number;
};
export type LoansByAccountQuery = { loans: { items: LoanRow[]; totalCount?: number } };

export type CashOutTaxSnapshot = {
  cashOutTax: number;
  start: BigNumberish;
  duration: BigNumberish;
  rulesetId: BigNumberish;
  suckerGroupId: string;
  version: number;
};
export type CashOutTaxSnapshotsQueryVariables = { suckerGroupId: string; after?: string };
export type CashOutTaxSnapshotsQuery = {
  cashOutTaxSnapshots: {
    items: CashOutTaxSnapshot[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type SuckerGroupMoment = {
  timestamp: number;
  /** Raw sum of every token's balance: mixes units when the group holds more than one token. */
  balance: BigNumberish;
  /** 18-dec USD: each token's balance at its latest indexed rate. */
  balanceUsd?: BigNumberish | null;
  volumeUsd?: BigNumberish | null;
  tokenSupply: BigNumberish;
  suckerGroupId: string;
  version: number;
  /** 18-dec USD per one whole accounting token at THIS moment's block. Null where the row
   *  predates the backfill or no feed bridged the pair. */
  accountingTokenUsdRate: BigNumberish | null;
};
export type SuckerGroupMomentsQueryVariables = { suckerGroupId: string; after?: string };
export type SuckerGroupMomentsQuery = {
  suckerGroupMoments: {
    items: SuckerGroupMoment[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type AddToBalanceInflow = {
  suckerGroupId: string;
  timestamp: number;
  amountUsd: BigNumberish | null;
};
export type AddToBalanceInflowsQueryVariables = { after?: string };
export type AddToBalanceInflowsQuery = {
  addToBalanceEvents: {
    items: AddToBalanceInflow[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type ProjectTokenBalanceMoment = {
  projectId: number;
  chainId: number;
  version: number;
  token: string;
  decimals: number;
  timestamp: number;
  balance: BigNumberish;
  /** 18-dec USD per one whole token at this moment's block; null when unpriced. */
  tokenUsdRate: BigNumberish | null;
};
export type ProjectTokenBalanceMomentsQueryVariables = {
  projectId: number;
  chainId: number;
  version: number;
  after?: string;
};
export type ProjectTokenBalanceMomentsQuery = {
  projectTokenBalanceMoments: {
    items: ProjectTokenBalanceMoment[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type TopSuckerGroupsQueryVariables = { limit?: number; offset?: number };
export type TopSuckerGroupsQuery = {
  suckerGroups: {
    totalCount?: number;
    items: Array<{
      id: string;
      balanceUsd: BigNumberish | null;
      volumeUsd: BigNumberish | null;
      projects: {
        items: Array<
          Pick<
            Project,
            | "balanceUsd"
            | "chainId"
            | "name"
            | "projectTagline"
            | "logoUri"
            | "metadataUri"
            | "projectId"
            | "version"
            | "isRevnet"
          > &
            ProjectTokenBalances
        >;
      } | null;
    }>;
  };
};

export type ProjectPayersQueryVariables = {
  where: ProjectPayerFilter;
  limit?: number;
  offset?: number;
};
export type ProjectPayersQuery = {
  projectPayers: {
    items: Array<
      Pick<
        ProjectPayer,
        | "address"
        | "chainId"
        | "projectId"
        | "version"
        | "owner"
        | "paymentsCount"
        | "defaultAddToBalance"
        | "defaultBeneficiary"
        | "addToBalanceCount"
        | "totalFacilitated"
        | "totalFacilitatedUsd"
        | "createdAt"
        | "lastUsedAt"
      >
    >;
    totalCount?: number;
  } | null;
};

export type PermissionHoldersQueryVariables = {
  where: PermissionHolderFilter;
  limit?: number;
  offset?: number;
};
export type PermissionHoldersQuery = {
  permissionHolders: {
    items: Array<
      Pick<
        PermissionHolder,
        | "chainId"
        | "projectId"
        | "version"
        | "account"
        | "operator"
        | "permissions"
        | "isRevnetOperator"
      >
    >;
    totalCount: number;
  } | null;
};

export type V6StoredAutoIssuancesQueryVariables = {
  where: BendystrawFilter;
  limit?: number;
  offset?: number;
};
export type V6StoredAutoIssuancesQuery = {
  storeAutoIssuanceAmountEvents: {
    totalCount?: number;
    items: Array<{
      id: string;
      chainId: number;
      projectId: number;
      version: number;
      stageId: string;
      beneficiary: string;
      count: string;
    }>;
  };
};
export type V6AutoIssueEventsQueryVariables = {
  where: BendystrawFilter;
  limit?: number;
  offset?: number;
};
export type V6AutoIssueEventsQuery = {
  autoIssueEvents: {
    totalCount?: number;
    items: Array<{
      id: string;
      chainId: number;
      projectId: number;
      version: number;
      stageId: string;
      beneficiary: string;
      count: string;
      txHash: string;
    }>;
  };
};

export type AllLoansQueryVariables = {
  where: BendystrawFilter;
  limit?: number;
  offset?: number;
};
export type AllLoansQuery = {
  loans: {
    items: Array<{
      id: string;
      borrowAmount: string;
      collateral: string;
      beneficiary: string;
      owner: string;
      createdAt: number;
      chainId: number;
      projectId: number;
      version: number;
      token: string;
      prepaidFeePercent: number;
      prepaidDuration: number;
    }>;
    totalCount: number;
  } | null;
};

export type IndexedBuybackPoolsQueryVariables = {
  projectId: number;
  chainId: number;
  version: number;
  limit?: number;
  offset?: number;
};
export type IndexedBuybackPoolsQuery = {
  buybackPoolEvents: {
    totalCount?: number;
    items: Array<{
      chainId: number;
      projectId: number;
      version: number;
      timestamp: number;
      terminalToken: string;
      poolId: string;
      initialSqrtPriceX96: string | null;
      projectTokenIsCurrency0: boolean | null;
    }>;
  };
};
export type IndexedLpPositionsQueryVariables = {
  chainId: number;
  poolId: string;
  limit?: number;
  offset?: number;
};
export type IndexedLpPositionsQuery = {
  buybackPoolPositions: {
    totalCount?: number;
    items: Array<{
      chainId: number;
      poolId: string;
      tokenId: string;
      owner: string;
      tickLower: number;
      tickUpper: number;
      liquidity: string;
      feesClaimed0: string;
      feesClaimed1: string;
    }>;
  } | null;
};

export type IndexedPoolRangesQueryVariables = IndexedBuybackPoolsQueryVariables & {
  poolId: string;
  limit: number;
  offset: number;
};
export type IndexedPoolRangesQuery = {
  buybackPoolRanges: {
    totalCount: number;
    items: Array<{
      chainId: number;
      projectId: number;
      version: number;
      poolId: string;
      tickLower: number;
      tickUpper: number;
      liquidity: string;
    }>;
  };
};

export type IndexedPoolLiquidityEventsQueryVariables = IndexedBuybackPoolsQueryVariables & {
  limit: number;
  offset: number;
};
/** One ModifyLiquidity in a project's buyback pool, in the order it happened. */
export type IndexedPoolLiquidityEventsQuery = {
  buybackPoolLiquidityEvents: {
    items: Array<{
      chainId: number;
      projectId: number;
      version: number;
      timestamp: number;
      poolId: string;
      tokenId: string;
      tickLower: number;
      tickUpper: number;
      liquidityDelta: string;
      liquidityAfter: string;
      sqrtPriceX96: string | null;
    }>;
    totalCount: number;
  };
};

export type IndexedPoolSwapsQueryVariables = IndexedBuybackPoolsQueryVariables & {
  limit: number;
  offset: number;
};
export type IndexedPoolSwapsQuery = {
  swapEvents: {
    items: Array<{
      chainId: number;
      projectId: number;
      version: number;
      timestamp: number;
      direction: string;
      poolId: string | null;
      terminalTokenAmount: string;
      projectTokenAmount: string;
      sqrtPriceX96: string | null;
      projectTokenIsCurrency0: boolean | null;
      /** 18-dec USD per one whole accounting token at THIS swap's block. Null where the row
       *  predates the backfill or no feed bridged the pair. */
      accountingTokenUsdRate: BigNumberish | null;
    }>;
    totalCount: number;
  };
};

export type OwnedNftsQueryVariables = {
  where: BendystrawFilter;
  limit: number;
  offset: number;
};
export type OwnedNftsQuery = {
  nfts: {
    items: Array<{
      chainId: number;
      projectId: number;
      version: number;
      owner: string;
      tierId: number;
      tokenId: BigNumberish;
      tokenUri: string | null;
    }>;
    totalCount: number;
  };
};

export type MintNftEventsQueryVariables = {
  where: BendystrawFilter;
  limit: number;
  offset: number;
};
export type MintNftEventsQuery = {
  mintNftEvents: {
    items: Array<{
      beneficiary: string;
      chainId: number;
      projectId: number;
      version: number;
      tierId: number;
      timestamp: number;
      tokenId: BigNumberish;
      totalAmountPaid: BigNumberish;
      txHash: string;
    }>;
    totalCount: number;
  };
};

export type ShieldProjectQueryVariables = { chainId: number; projectId: number };
export type ShieldProjectQuery = {
  project: { id: string; suckerGroupId: string } | null;
};
export type PayEventRatesQueryVariables = {
  where: Record<string, unknown>;
  limit: number;
  offset: number;
};
export type PayEventRatesQuery = {
  payEvents: {
    items: Array<{
      timestamp: number;
      /** In the accounting token's own decimals. */
      amount: string;
      /** 18-decimal USD valuation at the time of the payment, per the indexer. */
      amountUsd: string;
    }>;
  };
};
export type ShieldGroupQueryVariables = { id: string };
export type ShieldGroupQuery = {
  suckerGroup: {
    balanceUsd: BigNumberish | null;
    volumeUsd: BigNumberish;
    projects: {
      items: Array<
        {
          balance: BigNumberish;
          chainId: number;
          isRevnet: boolean | null;
          id: string;
          name: string | null;
          volumeUsd: BigNumberish;
          /** Accounting context: what the project is paid in, and at what scale. */
          token: string | null;
          tokenSymbol: string | null;
          decimals: number | null;
          participants: {
            totalCount: number;
            items: Array<{
              address: string;
              chainId: number;
              projectId: number;
              lastPaidTimestamp: number;
              balance: BigNumberish;
            }>;
          } | null;
          metadata: unknown;
        } & ProjectTokenBalances
      >;
    } | null;
  } | null;
};
export type IndexedRouterPendingCall = {
  chainId: number;
  version: number;
  gateway: string;
  pendingCallId: string;
  projectId: number;
  sourceProjectId: number;
  token: string;
  amount: string;
  retainedAmount: string;
  preferAddToBalance: boolean;
  shouldReturnHeldFees: boolean;
  beneficiary: string;
  refundTo: string;
  memo: string;
  metadata: string;
  callCommitment: string;
  status: string;
};
