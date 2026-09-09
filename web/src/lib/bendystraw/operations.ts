import type {
  AccountActivityEventsQuery,
  AccountActivityEventsQueryVariables,
  AccountPermissionHoldersQuery,
  AccountPermissionHoldersQueryVariables,
  AccountTokenBalancesQuery,
  AccountTokenBalancesQueryVariables,
  ActivityEventsQuery,
  ActivityEventsQueryVariables,
  AddToBalanceInflowsQuery,
  AddToBalanceInflowsQueryVariables,
  AllLoansQuery,
  AllLoansQueryVariables,
  AutoIssueEventsQuery,
  AutoIssueEventsQueryVariables,
  CashOutTaxSnapshotsQuery,
  CashOutTaxSnapshotsQueryVariables,
  HasPermissionQuery,
  HasPermissionQueryVariables,
  IndexedBuybackPoolsQuery,
  IndexedBuybackPoolsQueryVariables,
  IndexedLpPositionsQuery,
  IndexedLpPositionsQueryVariables,
  IndexedPoolLiquidityEventsQuery,
  IndexedPoolLiquidityEventsQueryVariables,
  IndexedPoolSwapsQuery,
  IndexedPoolSwapsQueryVariables,
  IndexedProjectsQuery,
  IndexedProjectsQueryVariables,
  IndexedSuckerGroupQuery,
  IndexedSuckerGroupQueryVariables,
  LoansByAccountQuery,
  LoansByAccountQueryVariables,
  MintNftEventsQuery,
  MintNftEventsQueryVariables,
  OwnedNftsQuery,
  OwnedNftsQueryVariables,
  ParticipantsQuery,
  ParticipantsQueryVariables,
  PayEventRatesQuery,
  PayEventRatesQueryVariables,
  PermissionHoldersQuery,
  PermissionHoldersQueryVariables,
  ProjectAccountingContextQuery,
  ProjectAccountingContextQueryVariables,
  ProjectErc20TickersQuery,
  ProjectErc20TickersQueryVariables,
  ProjectMomentsQuery,
  ProjectMomentsQueryVariables,
  ProjectOperatorQuery,
  ProjectOperatorQueryVariables,
  ProjectPayersQuery,
  ProjectPayersQueryVariables,
  ProjectQuery,
  ProjectQueryVariables,
  ProjectsByOwnerQuery,
  ProjectsByOwnerQueryVariables,
  ProjectWithPermissionsQuery,
  ProjectWithPermissionsQueryVariables,
  ShieldGroupQuery,
  ShieldGroupQueryVariables,
  ShieldProjectQuery,
  ShieldProjectQueryVariables,
  StoreAutoIssuanceAmountEventsQuery,
  StoreAutoIssuanceAmountEventsQueryVariables,
  SuckerGroupMomentsQuery,
  SuckerGroupMomentsQueryVariables,
  SuckerGroupQuery,
  SuckerGroupQueryVariables,
  TopSuckerGroupsQuery,
  TopSuckerGroupsQueryVariables,
  V6AutoIssueEventsQuery,
  V6AutoIssueEventsQueryVariables,
  V6StoredAutoIssuancesQuery,
  V6StoredAutoIssuancesQueryVariables,
} from "./types";

export type BendystrawOperation<TResult, TVariables extends Record<string, unknown>> = {
  readonly id: string;
  readonly validateData: (value: unknown) => value is TResult;
  readonly validateVariables: (value: unknown) => value is TVariables;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isInteger = (value: unknown): value is number => isNumber(value) && Number.isInteger(value);
const isOptionalString = (value: unknown): boolean => value === undefined || isString(value);

function isSafeInput(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return typeof value !== "string" || value.length <= 4_096;
  }
  if (Array.isArray(value)) {
    return value.length <= 500 && value.every((item) => isSafeInput(item, depth + 1));
  }
  if (!isObject(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(
    ([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) && isSafeInput(item, depth + 1),
  );
}

function variablesWith(
  required: Record<string, (value: unknown) => boolean>,
  optional: Record<string, (value: unknown) => boolean> = {},
) {
  const allowed = new Set([...Object.keys(required), ...Object.keys(optional)]);
  return (value: unknown): value is Record<string, unknown> => {
    if (!isObject(value) || !isSafeInput(value)) return false;
    if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    return (
      Object.entries(required).every(([key, validate]) => key in value && validate(value[key])) &&
      Object.entries(optional).every(([key, validate]) => !(key in value) || validate(value[key]))
    );
  };
}

const filter = (value: unknown): boolean => isObject(value) && isSafeInput(value);
const positiveLimit = (value: unknown): boolean => isInteger(value) && value > 0 && value <= 1_000;
const offset = (value: unknown): boolean => isInteger(value) && value >= 0;

function hasRoot(
  root: string,
  shape: "object" | "nullable-object" | "items" | "nullable-items",
): (value: unknown) => boolean {
  return (value) => {
    if (!isObject(value) || !(root in value)) return false;
    const rootValue = value[root];
    if (rootValue === null) return shape === "nullable-object" || shape === "nullable-items";
    if (!isObject(rootValue)) return false;
    if (shape === "object" || shape === "nullable-object") return true;
    return Array.isArray(rootValue.items) && rootValue.items.every(isObject);
  };
}

function hasDeploymentIdentity(value: unknown): boolean {
  return (
    isObject(value) &&
    isInteger(value.chainId) &&
    value.chainId > 0 &&
    isInteger(value.projectId) &&
    value.projectId > 0 &&
    isInteger(value.version) &&
    value.version > 0
  );
}

function hasIdentityItems(root: string, nullableRoot = false): (value: unknown) => boolean {
  return (value) => {
    if (!isObject(value) || !(root in value)) return false;
    const rootValue = value[root];
    if (rootValue === null) return nullableRoot;
    return (
      isObject(rootValue) &&
      Array.isArray(rootValue.items) &&
      rootValue.items.every(hasDeploymentIdentity)
    );
  };
}

function operation<TResult, TVariables extends Record<string, unknown>>(
  id: string,
  validateVariables: (value: unknown) => boolean,
  validateData: (value: unknown) => boolean,
): BendystrawOperation<TResult, TVariables> {
  return {
    id,
    validateVariables: validateVariables as (value: unknown) => value is TVariables,
    validateData: validateData as (value: unknown) => value is TResult,
  };
}

const projectVariables = variablesWith({
  projectId: isNumber,
  chainId: isNumber,
  version: isNumber,
});

export const ProjectOperation = operation<ProjectQuery, ProjectQueryVariables>(
  "project.v1",
  projectVariables,
  hasRoot("project", "nullable-object"),
);
export const ProjectAccountingContextOperation = operation<
  ProjectAccountingContextQuery,
  ProjectAccountingContextQueryVariables
>("project-accounting-context.v1", projectVariables, hasRoot("project", "nullable-object"));
export const IndexedProjectsOperation = operation<
  IndexedProjectsQuery,
  IndexedProjectsQueryVariables
>(
  "indexed-projects.v1",
  variablesWith(
    { where: filter },
    {
      orderBy: isString,
      orderDirection: isString,
      limit: positiveLimit,
      offset,
    },
  ),
  hasRoot("projects", "items"),
);
export const IndexedSuckerGroupOperation = operation<
  IndexedSuckerGroupQuery,
  IndexedSuckerGroupQueryVariables
>(
  "indexed-sucker-group.v1",
  variablesWith({ id: isString }),
  hasRoot("suckerGroup", "nullable-object"),
);
export const SuckerGroupOperation = operation<SuckerGroupQuery, SuckerGroupQueryVariables>(
  "sucker-group.v1",
  variablesWith({ id: isString }),
  hasRoot("suckerGroup", "nullable-object"),
);
export const ParticipantsOperation = operation<ParticipantsQuery, ParticipantsQueryVariables>(
  "participants.v1",
  variablesWith(
    {},
    {
      where: filter,
      orderBy: isString,
      orderDirection: isString,
      limit: positiveLimit,
      offset,
    },
  ),
  hasIdentityItems("participants"),
);
export const ActivityEventsOperation = operation<ActivityEventsQuery, ActivityEventsQueryVariables>(
  "activity-events.v1",
  variablesWith(
    {},
    {
      where: filter,
      orderBy: isString,
      orderDirection: isString,
      limit: positiveLimit,
      offset,
    },
  ),
  hasRoot("activityEvents", "items"),
);
export const AccountActivityEventsOperation = operation<
  AccountActivityEventsQuery,
  AccountActivityEventsQueryVariables
>(
  "account-activity-events.v1",
  variablesWith({ address: isString }, { limit: positiveLimit, offset }),
  hasRoot("activityEvents", "items"),
);
export const AccountTokenBalancesOperation = operation<
  AccountTokenBalancesQuery,
  AccountTokenBalancesQueryVariables
>(
  "account-token-balances.v1",
  variablesWith({ account: isString }, { limit: positiveLimit, offset }),
  hasIdentityItems("participants"),
);
export const ProjectsByOwnerOperation = operation<
  ProjectsByOwnerQuery,
  ProjectsByOwnerQueryVariables
>(
  "projects-by-owner.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasRoot("projects", "items"),
);
export const ProjectErc20TickersOperation = operation<
  ProjectErc20TickersQuery,
  ProjectErc20TickersQueryVariables
>(
  "project-erc20-tickers.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasRoot("deployErc20Events", "items"),
);
/** Pay events carrying both the accounting amount and its USD valuation, for deriving the
 *  historical base-currency rate a price chart needs (see lib/baseCurrencyRate.ts). */
export const PayEventRatesOperation = operation<PayEventRatesQuery, PayEventRatesQueryVariables>(
  "pay-event-rates.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasRoot("payEvents", "items"),
);
export const AccountPermissionHoldersOperation = operation<
  AccountPermissionHoldersQuery,
  AccountPermissionHoldersQueryVariables
>(
  "account-permission-holders.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasIdentityItems("permissionHolders", true),
);
export const HasPermissionOperation = operation<HasPermissionQuery, HasPermissionQueryVariables>(
  "has-permission.v1",
  variablesWith({
    account: isString,
    chainId: isNumber,
    projectId: isNumber,
    operator: isString,
    version: isNumber,
  }),
  hasRoot("permissionHolder", "nullable-object"),
);
export const ProjectOperatorOperation = operation<
  ProjectOperatorQuery,
  ProjectOperatorQueryVariables
>("project-operator.v1", projectVariables, hasIdentityItems("permissionHolders"));
export const ProjectWithPermissionsOperation = operation<
  ProjectWithPermissionsQuery,
  ProjectWithPermissionsQueryVariables
>("project-with-permissions.v1", projectVariables, hasRoot("project", "nullable-object"));
export const StoreAutoIssuanceAmountEventsOperation = operation<
  StoreAutoIssuanceAmountEventsQuery,
  StoreAutoIssuanceAmountEventsQueryVariables
>(
  "stored-auto-issuance-events.v1",
  variablesWith({}, { where: filter, orderBy: isString, orderDirection: isString }),
  hasIdentityItems("storeAutoIssuanceAmountEvents"),
);
export const AutoIssueEventsOperation = operation<
  AutoIssueEventsQuery,
  AutoIssueEventsQueryVariables
>(
  "auto-issue-events.v1",
  variablesWith({}, { where: filter, orderBy: isString, orderDirection: isString }),
  hasIdentityItems("autoIssueEvents"),
);
export const LoansByAccountOperation = operation<LoansByAccountQuery, LoansByAccountQueryVariables>(
  "loans-by-account.v2",
  variablesWith({ owner: isString, version: isNumber }, { limit: positiveLimit, offset }),
  hasRoot("loans", "items"),
);
export const CashOutTaxSnapshotsOperation = operation<
  CashOutTaxSnapshotsQuery,
  CashOutTaxSnapshotsQueryVariables
>(
  "cash-out-tax-snapshots.v1",
  variablesWith({ suckerGroupId: isString }, { after: isOptionalString }),
  hasRoot("cashOutTaxSnapshots", "items"),
);
export const SuckerGroupMomentsOperation = operation<
  SuckerGroupMomentsQuery,
  SuckerGroupMomentsQueryVariables
>(
  "sucker-group-moments.v1",
  variablesWith({ suckerGroupId: isString }, { after: isOptionalString }),
  hasRoot("suckerGroupMoments", "items"),
);
export const AddToBalanceInflowsOperation = operation<
  AddToBalanceInflowsQuery,
  AddToBalanceInflowsQueryVariables
>(
  "add-to-balance-inflows.v1",
  variablesWith({}, { after: isOptionalString }),
  hasRoot("addToBalanceEvents", "items"),
);
export const ProjectMomentsOperation = operation<ProjectMomentsQuery, ProjectMomentsQueryVariables>(
  "project-moments.v1",
  variablesWith(
    { projectId: isNumber, chainId: isNumber, version: isNumber },
    { after: isOptionalString },
  ),
  hasRoot("projectMoments", "items"),
);
export const TopSuckerGroupsOperation = operation<
  TopSuckerGroupsQuery,
  TopSuckerGroupsQueryVariables
>(
  "top-sucker-groups.v1",
  variablesWith({}, { limit: positiveLimit, offset }),
  hasRoot("suckerGroups", "items"),
);
export const ProjectPayersOperation = operation<ProjectPayersQuery, ProjectPayersQueryVariables>(
  "project-payers.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasIdentityItems("projectPayers", true),
);
export const PermissionHoldersOperation = operation<
  PermissionHoldersQuery,
  PermissionHoldersQueryVariables
>(
  "permission-holders.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasIdentityItems("permissionHolders", true),
);
export const V6StoredAutoIssuancesOperation = operation<
  V6StoredAutoIssuancesQuery,
  V6StoredAutoIssuancesQueryVariables
>(
  "v6-stored-auto-issuances.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasIdentityItems("storeAutoIssuanceAmountEvents"),
);
export const V6AutoIssueEventsOperation = operation<
  V6AutoIssueEventsQuery,
  V6AutoIssueEventsQueryVariables
>(
  "v6-auto-issue-events.v1",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasIdentityItems("autoIssueEvents"),
);
export const AllLoansOperation = operation<AllLoansQuery, AllLoansQueryVariables>(
  "all-loans.v2",
  variablesWith({ where: filter }, { limit: positiveLimit, offset }),
  hasIdentityItems("loans", true),
);
export const IndexedBuybackPoolsOperation = operation<
  IndexedBuybackPoolsQuery,
  IndexedBuybackPoolsQueryVariables
>(
  "indexed-buyback-pools.v1",
  variablesWith(
    { projectId: isNumber, chainId: isNumber, version: isNumber },
    { limit: positiveLimit, offset },
  ),
  hasIdentityItems("buybackPoolEvents"),
);
export const IndexedLpPositionsOperation = operation<
  IndexedLpPositionsQuery,
  IndexedLpPositionsQueryVariables
>(
  "indexed-lp-positions.v1",
  variablesWith({ chainId: isNumber, poolId: isString }, { limit: positiveLimit, offset }),
  // Rows carry no projectId, so the shared identity guard does not apply: a
  // position is identified by its pool, which the query already pins.
  (value) => {
    if (!isObject(value) || !("buybackPoolPositions" in value)) return false;
    const root = value.buybackPoolPositions;
    if (root === null) return true;
    return isObject(root) && Array.isArray(root.items);
  },
);
export const IndexedPoolSwapsOperation = operation<
  IndexedPoolSwapsQuery,
  IndexedPoolSwapsQueryVariables
>(
  "indexed-pool-swaps.v1",
  variablesWith({
    projectId: isNumber,
    chainId: isNumber,
    version: isNumber,
    limit: positiveLimit,
    offset,
  }),
  hasIdentityItems("swapEvents"),
);
export const IndexedPoolLiquidityEventsOperation = operation<
  IndexedPoolLiquidityEventsQuery,
  IndexedPoolLiquidityEventsQueryVariables
>(
  "indexed-pool-liquidity-events.v1",
  variablesWith({
    projectId: isNumber,
    chainId: isNumber,
    version: isNumber,
    limit: positiveLimit,
    offset,
  }),
  hasIdentityItems("buybackPoolLiquidityEvents"),
);
export const OwnedNftsOperation = operation<OwnedNftsQuery, OwnedNftsQueryVariables>(
  "owned-nfts.v1",
  variablesWith({ where: filter, limit: positiveLimit, offset }),
  hasIdentityItems("nfts"),
);
export const MintNftEventsOperation = operation<MintNftEventsQuery, MintNftEventsQueryVariables>(
  "mint-nft-events.v1",
  variablesWith({ where: filter, limit: positiveLimit, offset }),
  hasIdentityItems("mintNftEvents"),
);
export const ShieldProjectOperation = operation<ShieldProjectQuery, ShieldProjectQueryVariables>(
  "shield-project.v1",
  variablesWith({ chainId: isNumber, projectId: isNumber }),
  hasRoot("project", "nullable-object"),
);
export const ShieldGroupOperation = operation<ShieldGroupQuery, ShieldGroupQueryVariables>(
  "shield-group.v1",
  variablesWith({ id: isString }),
  hasRoot("suckerGroup", "nullable-object"),
);

export const BENDYSTRAW_OPERATIONS = [
  ProjectOperation,
  ProjectAccountingContextOperation,
  IndexedProjectsOperation,
  IndexedSuckerGroupOperation,
  SuckerGroupOperation,
  ParticipantsOperation,
  ActivityEventsOperation,
  AccountActivityEventsOperation,
  AccountTokenBalancesOperation,
  ProjectsByOwnerOperation,
  ProjectErc20TickersOperation,
  AccountPermissionHoldersOperation,
  HasPermissionOperation,
  ProjectOperatorOperation,
  ProjectWithPermissionsOperation,
  StoreAutoIssuanceAmountEventsOperation,
  AutoIssueEventsOperation,
  LoansByAccountOperation,
  CashOutTaxSnapshotsOperation,
  SuckerGroupMomentsOperation,
  AddToBalanceInflowsOperation,
  ProjectMomentsOperation,
  TopSuckerGroupsOperation,
  ProjectPayersOperation,
  PermissionHoldersOperation,
  V6StoredAutoIssuancesOperation,
  V6AutoIssueEventsOperation,
  AllLoansOperation,
  IndexedBuybackPoolsOperation,
  IndexedLpPositionsOperation,
  IndexedPoolSwapsOperation,
  IndexedPoolLiquidityEventsOperation,
  OwnedNftsOperation,
  MintNftEventsOperation,
  ShieldProjectOperation,
  ShieldGroupOperation,
  PayEventRatesOperation,
] as const;

/**
 * Operations needed by client components through the same-origin BFF.
 *
 * Server-rendered pages and server routes call `queryBendystraw` directly.
 * Keeping those operations out of this list prevents the public proxy from
 * exposing heavier history, ranking, price, and shield queries which have no
 * browser consumer.
 */
export const BROWSER_BENDYSTRAW_OPERATIONS = [
  ProjectOperation,
  ProjectAccountingContextOperation,
  SuckerGroupOperation,
  ParticipantsOperation,
  ActivityEventsOperation,
  AccountActivityEventsOperation,
  AccountTokenBalancesOperation,
  ProjectsByOwnerOperation,
  ProjectErc20TickersOperation,
  AccountPermissionHoldersOperation,
  HasPermissionOperation,
  ProjectOperatorOperation,
  ProjectWithPermissionsOperation,
  StoreAutoIssuanceAmountEventsOperation,
  AutoIssueEventsOperation,
  LoansByAccountOperation,
  ProjectPayersOperation,
  PermissionHoldersOperation,
  V6StoredAutoIssuancesOperation,
  V6AutoIssueEventsOperation,
  AllLoansOperation,
  OwnedNftsOperation,
  MintNftEventsOperation,
  IndexedLpPositionsOperation,
  IndexedPoolLiquidityEventsOperation,
] as const;

export type BrowserBendystrawOperation = (typeof BROWSER_BENDYSTRAW_OPERATIONS)[number];

export function getBrowserOperationById(id: string): BrowserBendystrawOperation | undefined {
  return BROWSER_BENDYSTRAW_OPERATIONS.find((operation) => operation.id === id);
}
