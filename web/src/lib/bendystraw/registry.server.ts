import "server-only";

import {
  AccountActivityEventsOperation,
  AccountPermissionHoldersOperation,
  AccountTokenBalancesOperation,
  ActivityEventsOperation,
  AddToBalanceInflowsOperation,
  AllLoansOperation,
  AutoIssueEventsOperation,
  CashOutTaxSnapshotsOperation,
  HasPermissionOperation,
  IndexedBuybackPoolsOperation,
  IndexedLpPositionsOperation,
  IndexedPoolLiquidityEventsOperation,
  IndexedPoolSwapsOperation,
  IndexedProjectsOperation,
  IndexedSuckerGroupOperation,
  LoansByAccountOperation,
  MintNftEventsOperation,
  OwnedNftsOperation,
  ParticipantsOperation,
  PayEventRatesOperation,
  PermissionHoldersOperation,
  ProjectAccountingContextOperation,
  ProjectErc20TickersOperation,
  ProjectMomentsOperation,
  ProjectOperation,
  ProjectOperatorOperation,
  ProjectPayersOperation,
  ProjectsByOwnerOperation,
  ProjectWithPermissionsOperation,
  ShieldGroupOperation,
  ShieldProjectOperation,
  StoreAutoIssuanceAmountEventsOperation,
  SuckerGroupMomentsOperation,
  SuckerGroupOperation,
  TopSuckerGroupsOperation,
  V6AutoIssueEventsOperation,
  V6StoredAutoIssuancesOperation,
} from "./operations";

type RegisteredQuery = {
  readonly operationName: string;
  readonly query: string;
};

const ACTIVITY_EVENT_FIELDS = `
  payEvent {
    id
    amount
    beneficiary
    memo
    timestamp
    feeFromProject
    newlyIssuedTokenCount
    from
    txHash
    amountUsd
    caller
    distributionFromProjectId
    projectId
    project { id projectId handle version }
  }
  cashOutTokensEvent {
    id
    timestamp
    txHash
    from
    beneficiary
    reclaimAmount
    reclaimAmountUsd
    cashOutCount
    metadata
    project { id projectId handle version }
  }
  addToBalanceEvent { txHash timestamp from amount memo }
  mintTokensEvent {
    id txHash timestamp from caller beneficiary beneficiaryTokenCount memo
  }
  manualMintTokensEvent {
    id txHash timestamp from beneficiary beneficiaryTokenCount memo
  }
  autoIssueEvent { id txHash timestamp from beneficiary count }
  deployErc20Event { txHash timestamp from symbol }
  projectCreateEvent { txHash timestamp from }
  projectTransferEvent { txHash timestamp from previousOwner owner }
  operatorPermissionsSetEvent {
    txHash timestamp from caller operator isRevnetOperator
  }
  rulesetQueuedEvent { txHash timestamp from caller cycleNumber }
  swapEvent {
    txHash timestamp from caller direction terminalTokenAmount projectTokenAmount
  }
  buybackPoolEvent { txHash timestamp from caller }
  sendPayoutsEvent {
    txHash timestamp from caller amount amountPaidOut amountPaidOutUsd
  }
  sendReservedTokensToSplitsEvent { txHash timestamp from tokenCount }
  sendReservedTokensToSplitEvent {
    id txHash timestamp from tokenCount beneficiary splitProjectId
  }
`;

const PROJECT_FIELDS = `
  projectId
  metadataUri
  handle
  createdAt
  description
  suckerGroupId
  logoUri
  name
  projectTagline
  version
  token
  decimals
  currency
  tokenSymbol
  isRevnet
`;

const INDEXED_PROJECT_FIELDS = `
  projectId
  chainId
  version
  suckerGroupId
  name
  handle
  logoUri
  projectTagline
  tokenSymbol
  decimals
  currency
  isRevnet
  createdAt
  volume
  trendingScore
  trendingVolume
  trendingPaymentsCount
`;

export const BENDYSTRAW_QUERY_REGISTRY: Readonly<Record<string, RegisteredQuery>> = {
  [ProjectOperation.id]: {
    operationName: "Project",
    query: `query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
      project(projectId: $projectId, chainId: $chainId, version: $version) {
        ${PROJECT_FIELDS}
      }
    }`,
  },
  [ProjectAccountingContextOperation.id]: {
    operationName: "ProjectAccountingContext",
    query: `query ProjectAccountingContext(
      $chainId: Float!
      $projectId: Float!
      $version: Float!
    ) {
      project(chainId: $chainId, projectId: $projectId, version: $version) {
        token
        decimals
        currency
      }
    }`,
  },
  [IndexedProjectsOperation.id]: {
    operationName: "IndexedProjects",
    query: `query IndexedProjects(
      $where: projectFilter!
      $orderBy: String
      $orderDirection: String
      $limit: Int
      $offset: Int
    ) {
      projects(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items { ${INDEXED_PROJECT_FIELDS} }
      }
    }`,
  },
  [IndexedSuckerGroupOperation.id]: {
    operationName: "IndexedSuckerGroup",
    query: `query IndexedSuckerGroup($id: String!) {
      suckerGroup(id: $id) {
        projects {
          items { ${INDEXED_PROJECT_FIELDS} }
        }
      }
    }`,
  },
  [SuckerGroupOperation.id]: {
    operationName: "SuckerGroup",
    query: `query SuckerGroup($id: String!) {
      suckerGroup(id: $id) {
        id
        paymentsCount
        tokenSupply
        volumeUsd
        projects {
          items {
            balance
            chainId
            currency
            decimals
            projectId
            token
            tokenSupply
            tokenSymbol
            version
            suckerGroupId
          }
        }
      }
    }`,
  },
  [ParticipantsOperation.id]: {
    operationName: "Participants",
    query: `query Participants(
      $where: participantFilter
      $orderBy: String
      $orderDirection: String
      $limit: Int
      $offset: Int
    ) {
      participants(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          projectId
          version
          address
          volume
          lastPaidTimestamp
          balance
          erc20Balance
          creditBalance
        }
      }
    }`,
  },
  [ActivityEventsOperation.id]: {
    operationName: "ActivityEvents",
    query: `query ActivityEvents(
      $where: activityEventFilter
      $orderBy: String
      $orderDirection: String
      $limit: Int
      $offset: Int
    ) {
      activityEvents(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          timestamp
          txHash
          project {
            id projectId chainId handle version name logoUri projectTagline
            tokenSymbol decimals isRevnet suckerGroupId
          }
          ${ACTIVITY_EVENT_FIELDS}
        }
      }
    }`,
  },
  [AccountActivityEventsOperation.id]: {
    operationName: "AccountActivityEvents",
    // The top-level activityEventFilter has no beneficiary field, so events
    // where the account only receives value (payments to them, mints, splits)
    // are fetched from the beneficiary-bearing sub-event roots and merged
    // client-side (mergeAccountActivity). Every branch pins version 6 in an
    // explicit AND group — this Ponder version does not AND sibling fields
    // inside OR branches.
    query: `query AccountActivityEvents($address: String!, $limit: Int, $offset: Int) {
      activityEvents(
        where: { AND: [{ from: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          timestamp
          txHash
          from
          project { projectId handle version chainId name tokenSymbol decimals }
          ${ACTIVITY_EVENT_FIELDS}
        }
      }
      beneficiaryPayEvents: payEvents(
        where: { AND: [{ beneficiary: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          amount
          beneficiary
          memo
          timestamp
          feeFromProject
          newlyIssuedTokenCount
          from
          txHash
          amountUsd
          caller
          distributionFromProjectId
          projectId
          project { projectId handle version chainId name tokenSymbol decimals }
        }
      }
      beneficiaryCashOutEvents: cashOutTokensEvents(
        where: { AND: [{ beneficiary: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          timestamp
          txHash
          from
          beneficiary
          reclaimAmount
          reclaimAmountUsd
          cashOutCount
          metadata
          project { projectId handle version chainId name tokenSymbol decimals }
        }
      }
      beneficiaryMintTokensEvents: mintTokensEvents(
        where: { AND: [{ beneficiary: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          txHash
          timestamp
          from
          caller
          beneficiary
          beneficiaryTokenCount
          memo
          project { projectId handle version chainId name tokenSymbol decimals }
        }
      }
      beneficiaryManualMintTokensEvents: manualMintTokensEvents(
        where: { AND: [{ beneficiary: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          txHash
          timestamp
          from
          beneficiary
          beneficiaryTokenCount
          memo
          project { projectId handle version chainId name tokenSymbol decimals }
        }
      }
      beneficiaryAutoIssueEvents: autoIssueEvents(
        where: { AND: [{ beneficiary: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          txHash
          timestamp
          from
          beneficiary
          count
          project { projectId handle version chainId name tokenSymbol decimals }
        }
      }
      beneficiarySendReservedTokensToSplitEvents: sendReservedTokensToSplitEvents(
        where: { AND: [{ beneficiary: $address }, { version: 6 }] }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id
          chainId
          txHash
          timestamp
          from
          beneficiary
          tokenCount
          splitProjectId
          project { projectId handle version chainId name tokenSymbol decimals }
        }
      }
    }`,
  },
  [AccountTokenBalancesOperation.id]: {
    operationName: "AccountTokenBalances",
    // This app is V6-only, so the version pin keeps other protocol versions'
    // rows (which reuse projectIds for unrelated projects) out entirely.
    // totalCount lets the client surface the fetch cap; the credit/ERC-20
    // split distinguishes claimed tokens from unclaimed credits.
    query: `query AccountTokenBalances($account: String!, $limit: Int, $offset: Int) {
      participants(
        where: { address: $account, balance_gt: "0", version: 6 }
        orderBy: "balance"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          projectId
          version
          balance
          creditBalance
          erc20Balance
        }
      }
    }`,
  },
  [ProjectErc20TickersOperation.id]: {
    operationName: "ProjectErc20Tickers",
    // The project ERC-20 ticker (what balances are denominated in). The
    // project row's tokenSymbol is the ACCOUNTING context's symbol — never
    // use it to label project-token amounts.
    query: `query ProjectErc20Tickers(
      $where: deployErc20EventFilter
      $limit: Int
      $offset: Int
    ) {
      deployErc20Events(where: $where, limit: $limit, offset: $offset) {
        totalCount
        items {
          chainId
          projectId
          symbol
        }
      }
    }`,
  },
  [ProjectsByOwnerOperation.id]: {
    operationName: "ProjectsByOwner",
    query: `query ProjectsByOwner($where: projectFilter, $limit: Int, $offset: Int) {
      projects(
        where: $where
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          projectId
          version
          name
          handle
          logoUri
          owner
          isRevnet
          suckerGroupId
          tokenSymbol
          createdAt
        }
      }
    }`,
  },
  [AccountPermissionHoldersOperation.id]: {
    operationName: "AccountPermissionHolders",
    query: `query AccountPermissionHolders($where: permissionHolderFilter, $limit: Int, $offset: Int) {
      permissionHolders(where: $where, limit: $limit, offset: $offset) {
        totalCount
        items {
          chainId
          projectId
          version
          account
          operator
          permissions
          isRevnetOperator
          version
          project { name handle }
        }
      }
    }`,
  },
  [HasPermissionOperation.id]: {
    operationName: "HasPermission",
    query: `query HasPermission(
      $account: String!
      $chainId: Float!
      $projectId: Float!
      $operator: String!
      $version: Float!
    ) {
      permissionHolder(
        account: $account
        chainId: $chainId
        projectId: $projectId
        operator: $operator
        version: $version
      ) {
        permissions
      }
    }`,
  },
  [ProjectOperatorOperation.id]: {
    operationName: "ProjectOperator",
    query: `query ProjectOperator($chainId: Int!, $projectId: Int!, $version: Int!) {
      permissionHolders(
        where: {
          chainId: $chainId
          projectId: $projectId
          version: $version
          isRevnetOperator: true
        }
        limit: 1
      ) {
        items { chainId projectId version operator }
      }
    }`,
  },
  [ProjectWithPermissionsOperation.id]: {
    operationName: "ProjectWithPermissions",
    query: `query ProjectWithPermissions(
      $projectId: Float!
      $chainId: Float!
      $version: Float!
    ) {
      project(projectId: $projectId, chainId: $chainId, version: $version) {
        projectId
        chainId
        version
        owner
        permissionHolders {
          items { account operator permissions }
        }
      }
    }`,
  },
  [StoreAutoIssuanceAmountEventsOperation.id]: {
    operationName: "StoreAutoIssuanceAmountEvents",
    query: `query StoreAutoIssuanceAmountEvents(
      $where: storeAutoIssuanceAmountEventFilter
      $orderBy: String
      $orderDirection: String
    ) {
      storeAutoIssuanceAmountEvents(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        items { id chainId projectId version beneficiary count stageId caller }
      }
    }`,
  },
  [AutoIssueEventsOperation.id]: {
    operationName: "AutoIssueEvents",
    query: `query AutoIssueEvents(
      $where: autoIssueEventFilter
      $orderBy: String
      $orderDirection: String
    ) {
      autoIssueEvents(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        items { id chainId projectId version stageId beneficiary count caller }
      }
    }`,
  },
  [LoansByAccountOperation.id]: {
    operationName: "LoansByAccount",
    query: `query LoansByAccount(
      $owner: String!
      $version: Int!
      $limit: Int
      $offset: Int
    ) {
      loans(
        where: { owner: $owner, version: $version }
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        items {
          borrowAmount
          collateral
          prepaidDuration
          projectId
          terminal
          token
          chainId
          createdAt
          id
          project { version }
        }
        totalCount
      }
    }`,
  },
  [CashOutTaxSnapshotsOperation.id]: {
    operationName: "CashOutTaxSnapshots",
    query: `query CashOutTaxSnapshots($suckerGroupId: String!, $after: String) {
      cashOutTaxSnapshots(
        where: { suckerGroupId: $suckerGroupId }
        orderBy: "start"
        orderDirection: "asc"
        limit: 1000
        after: $after
      ) {
        items { cashOutTax start duration rulesetId suckerGroupId version }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  [SuckerGroupMomentsOperation.id]: {
    operationName: "SuckerGroupMoments",
    query: `query SuckerGroupMoments($suckerGroupId: String!, $after: String) {
      suckerGroupMoments(
        where: { suckerGroupId: $suckerGroupId }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: 1000
        after: $after
      ) {
        items { timestamp balance volume tokenSupply suckerGroupId version accountingTokenUsdRate }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  [AddToBalanceInflowsOperation.id]: {
    operationName: "AddToBalanceInflows",
    query: `query AddToBalanceInflows($after: String) {
      addToBalanceEvents(
        where: { version: 6 }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: 1000
        after: $after
      ) {
        items { suckerGroupId timestamp amount }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  [ProjectMomentsOperation.id]: {
    operationName: "ProjectMoments",
    query: `query ProjectMoments(
      $projectId: Int!
      $chainId: Int!
      $version: Int!
      $after: String
    ) {
      projectMoments(
        where: { projectId: $projectId, chainId: $chainId, version: $version }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: 1000
        after: $after
      ) {
        items { projectId chainId version timestamp balance }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  [TopSuckerGroupsOperation.id]: {
    operationName: "TopSuckerGroups",
    query: `query TopSuckerGroups($limit: Int, $offset: Int) {
      suckerGroups(
        orderBy: "paymentsCount"
        orderDirection: "desc"
        where: { version: 6 }
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          id balance volume
          projects(limit: 8, orderBy: "chainId", orderDirection: "asc") {
            items {
              balance
              decimals
              currency
              chainId
              name
              projectTagline
              tokenSymbol
              logoUri
              projectId
              version
              isRevnet
            }
          }
        }
      }
    }`,
  },
  [ProjectPayersOperation.id]: {
    operationName: "V6ProjectPayers",
    query: `query V6ProjectPayers($where: projectPayerFilter, $limit: Int, $offset: Int) {
      projectPayers(
        where: $where
        orderBy: "totalFacilitatedUsd"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          projectId
          version
          address
          defaultAddToBalance
          defaultBeneficiary
          owner
          paymentsCount
          addToBalanceCount
          totalFacilitated
          totalFacilitatedUsd
          lastUsedAt
          createdAt
        }
      }
    }`,
  },
  [PermissionHoldersOperation.id]: {
    operationName: "V6PermissionHolders",
    query: `query V6PermissionHolders($where: permissionHolderFilter, $limit: Int, $offset: Int) {
      permissionHolders(where: $where, limit: $limit, offset: $offset) {
        totalCount
        items {
          chainId
          projectId
          version
          account
          operator
          permissions
          isRevnetOperator
        }
      }
    }`,
  },
  [V6StoredAutoIssuancesOperation.id]: {
    operationName: "V6StoredAutoIssuances",
    query: `query V6StoredAutoIssuances(
      $where: storeAutoIssuanceAmountEventFilter
      $limit: Int
      $offset: Int
    ) {
      storeAutoIssuanceAmountEvents(where: $where, limit: $limit, offset: $offset) {
        totalCount
        items { id chainId projectId version stageId beneficiary count }
      }
    }`,
  },
  [V6AutoIssueEventsOperation.id]: {
    operationName: "V6AutoIssueEvents",
    query: `query V6AutoIssueEvents($where: autoIssueEventFilter, $limit: Int, $offset: Int) {
      autoIssueEvents(where: $where, limit: $limit, offset: $offset) {
        totalCount
        items { id chainId projectId version stageId beneficiary count }
      }
    }`,
  },
  [AllLoansOperation.id]: {
    operationName: "V6AllLoans",
    query: `query V6AllLoans($where: loanFilter, $limit: Int, $offset: Int) {
      loans(
        where: $where
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        items {
          id borrowAmount collateral beneficiary owner createdAt chainId projectId version
          token prepaidFeePercent prepaidDuration
        }
        totalCount
      }
    }`,
  },
  [IndexedLpPositionsOperation.id]: {
    operationName: "IndexedLpPositions",
    query: `query IndexedLpPositions(
      $chainId: Int!
      $poolId: String!
      $limit: Int
      $offset: Int
    ) {
      buybackPoolPositions(
        where: { chainId: $chainId, poolId: $poolId, burned: false }
        orderBy: "tokenId"
        orderDirection: "asc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          tokenId
          owner
          tickLower
          tickUpper
          liquidity
          feesClaimed0
          feesClaimed1
        }
      }
    }`,
  },
  [IndexedBuybackPoolsOperation.id]: {
    operationName: "IndexedBuybackPools",
    query: `query IndexedBuybackPools(
      $projectId: Int!
      $chainId: Int!
      $version: Int!
      $limit: Int
      $offset: Int
    ) {
      buybackPoolEvents(
        where: { projectId: $projectId, chainId: $chainId, version: $version }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          projectId
          version
          timestamp
          terminalToken
          poolId
          initialSqrtPriceX96
          projectTokenIsCurrency0
        }
      }
    }`,
  },
  [IndexedPoolLiquidityEventsOperation.id]: {
    operationName: "IndexedPoolLiquidityEvents",
    query: `query IndexedPoolLiquidityEvents(
      $projectId: Int!
      $chainId: Int!
      $version: Int!
      $limit: Int!
      $offset: Int!
    ) {
      buybackPoolLiquidityEvents(
        where: { projectId: $projectId, chainId: $chainId, version: $version }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: $limit
        offset: $offset
      ) {
        totalCount
        items {
          chainId
          projectId
          version
          timestamp
          poolId
          tokenId
          tickLower
          tickUpper
          liquidityDelta
          liquidityAfter
          sqrtPriceX96
        }
      }
    }`,
  },
  [IndexedPoolSwapsOperation.id]: {
    operationName: "IndexedPoolSwaps",
    query: `query IndexedPoolSwaps(
      $projectId: Int!
      $chainId: Int!
      $version: Int!
      $limit: Int!
      $offset: Int!
    ) {
      swapEvents(
        where: { projectId: $projectId, chainId: $chainId, version: $version }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: $limit
        offset: $offset
      ) {
        items {
          chainId
          projectId
          version
          timestamp
          direction
          poolId
          terminalTokenAmount
          projectTokenAmount
          sqrtPriceX96
          projectTokenIsCurrency0
          accountingTokenUsdRate
        }
        totalCount
      }
    }`,
  },
  [OwnedNftsOperation.id]: {
    operationName: "OwnedNfts",
    query: `query OwnedNfts($where: nftFilter, $limit: Int!, $offset: Int!) {
      nfts(
        where: $where
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        items { chainId projectId version owner tierId tokenId tokenUri }
        totalCount
      }
    }`,
  },
  [MintNftEventsOperation.id]: {
    operationName: "MintNftEvents",
    query: `query MintNftEvents($where: mintNftEventFilter, $limit: Int!, $offset: Int!) {
      mintNftEvents(
        where: $where
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        items {
          beneficiary
          chainId
          projectId
          version
          tierId
          timestamp
          tokenId
          totalAmountPaid
          txHash
        }
        totalCount
      }
    }`,
  },
  [ShieldProjectOperation.id]: {
    operationName: "ShieldProject",
    query: `query ShieldProject($chainId: Float!, $projectId: Float!) {
      project(chainId: $chainId, projectId: $projectId, version: 6) {
        id
        suckerGroupId
      }
    }`,
  },
  [PayEventRatesOperation.id]: {
    operationName: "PayEventRates",
    query: `query PayEventRates($where: payEventFilter!, $limit: Int!, $offset: Int!) {
      payEvents(where: $where, limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "asc") {
        items { timestamp amount amountUsd }
      }
    }`,
  },
  [ShieldGroupOperation.id]: {
    operationName: "ShieldGroup",
    query: `query ShieldGroup($id: String!) {
      suckerGroup(id: $id) {
        balance
        volume
        volumeUsd
        projects {
          items {
            balance
            chainId
            isRevnet
            id
            name
            volumeUsd
            volume
            token
            tokenSymbol
            decimals
            participants(limit: 100) {
              totalCount
              items { address chainId projectId lastPaidTimestamp balance }
            }
            metadata
          }
        }
      }
    }`,
  },
};

export function getRegisteredQuery(operationId: string): RegisteredQuery | undefined {
  return BENDYSTRAW_QUERY_REGISTRY[operationId];
}
