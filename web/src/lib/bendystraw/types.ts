type BigNumberish = string | number;
export type BendystrawFilter = Record<string, unknown>;

export type Project = {
  balance: BigNumberish;
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
  | "balance"
  | "chainId"
  | "currency"
  | "decimals"
  | "projectId"
  | "token"
  | "tokenSymbol"
  | "version"
  | "suckerGroupId"
> & { tokenSupply: BigNumberish };

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
  | "chainId"
  | "createdAt"
  | "handle"
  | "isRevnet"
  | "logoUri"
  | "name"
  | "projectId"
  | "projectTagline"
  | "suckerGroupId"
  | "tokenSymbol"
  | "version"
> & {
  volume: BigNumberish;
  currency?: BigNumberish | null;
  decimals?: number | null;
  trendingPaymentsCount?: number;
  trendingScore?: BigNumberish;
  trendingVolume?: BigNumberish;
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
  project: ActivityProject | null;
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
      addToBalanceEvent: (ActivityBase & { amount: BigNumberish; memo: string | null }) | null;
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
      sendPayoutsEvent?:
        | (ActivityBase & {
            caller: string;
            amount: BigNumberish;
            amountPaidOut: BigNumberish;
            amountPaidOutUsd: BigNumberish;
          })
        | null;
      sendReservedTokensToSplitsEvent?: (ActivityBase & { tokenCount: BigNumberish }) | null;
      sendReservedTokensToSplitEvent?:
        | (ActivityBase & {
            id: string;
            tokenCount: BigNumberish;
            beneficiary: string;
            splitProjectId: number;
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
  balance: BigNumberish;
  volume: BigNumberish;
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
  amount: BigNumberish;
};
export type AddToBalanceInflowsQueryVariables = { after?: string };
export type AddToBalanceInflowsQuery = {
  addToBalanceEvents: {
    items: AddToBalanceInflow[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type ProjectMoment = {
  projectId: number;
  chainId: number;
  version: number;
  timestamp: number;
  balance: BigNumberish;
};
export type ProjectMomentsQueryVariables = {
  projectId: number;
  chainId: number;
  version: number;
  after?: string;
};
export type ProjectMomentsQuery = {
  projectMoments: {
    items: ProjectMoment[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type TopSuckerGroupsQueryVariables = { limit?: number; offset?: number };
export type TopSuckerGroupsQuery = {
  suckerGroups: {
    totalCount?: number;
    items: Array<{
      id: string;
      balance: BigNumberish;
      volume: BigNumberish;
      projects: {
        items: Array<
          Pick<
            Project,
            | "balance"
            | "decimals"
            | "currency"
            | "chainId"
            | "name"
            | "projectTagline"
            | "tokenSymbol"
            | "logoUri"
            | "projectId"
            | "version"
            | "isRevnet"
          >
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
    balance: BigNumberish;
    volume: BigNumberish;
    volumeUsd: BigNumberish;
    projects: {
      items: Array<{
        balance: BigNumberish;
        chainId: number;
        isRevnet: boolean | null;
        id: string;
        name: string | null;
        volumeUsd: BigNumberish;
        volume: BigNumberish;
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
      }>;
    } | null;
  } | null;
};
