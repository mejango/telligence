import { isAddress, zeroAddress, type Address, type PublicClient } from "viem";

export const JB_PERMISSIONS_DEPLOYMENT_BLOCKS: Readonly<Record<number, bigint>> = {
  1: 25_327_931n,
  10: 152_994_030n,
  8453: 47_398_751n,
  42161: 473_987_853n,
  11155111: 11_070_525n,
  11155420: 44_892_020n,
  84532: 42_909_144n,
  421614: 277_723_887n,
};
// Operator history is a recovery path, not an unbounded indexer. Scan exact
// REVOwner/project topics newest-first with explicit work limits so a revnet
// which repeatedly rotates through controlled operators cannot amplify one
// handle request into an unbounded RPC/result/candidate workload.
const MAX_OPERATOR_HISTORY_REQUESTS = 32;
export const MAX_OPERATOR_HISTORY_LOGS_PER_WINDOW = 256;
export const MAX_OPERATOR_HISTORY_CANDIDATES = 64;
const OPERATOR_HISTORY_WINDOW = 50_000n;
const operatorPermissionsSetEvent = {
  type: "event",
  name: "OperatorPermissionsSet",
  anonymous: false,
  inputs: [
    { name: "operator", type: "address", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "projectId", type: "uint256", indexed: true },
    { name: "permissionIds", type: "uint8[]", indexed: false },
    { name: "packed", type: "uint256", indexed: false },
    { name: "caller", type: "address", indexed: false },
  ],
} as const;

export type RevnetOperatorRow = {
  operator?: string | null;
  permissions?: readonly unknown[] | null;
  isRevnetOperator?: boolean | null;
};

/**
 * Return every plausible indexed operator exactly once. Rows which still have
 * permissions are tried first, but role-only rows remain candidates while the
 * indexer catches up after an operator transfer.
 */
export function revnetOperatorCandidates(rows: readonly RevnetOperatorRow[]): Address[] {
  const valid = rows.filter(
    (row): row is RevnetOperatorRow & { operator: Address } =>
      typeof row.operator === "string" &&
      isAddress(row.operator) &&
      row.operator.toLowerCase() !== zeroAddress,
  );
  const ordered = [
    ...valid.filter((row) => (row.permissions?.length ?? 0) > 0),
    ...valid.filter((row) => (row.permissions?.length ?? 0) === 0),
  ];
  const seen = new Set<string>();
  return ordered.flatMap((row) => {
    const key = row.operator.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [row.operator];
  });
}

/** Fail closed while trying each indexed candidate against live REVOwner state. */
export async function findCurrentRevnetOperator(
  candidates: readonly Address[],
  isCurrent: (candidate: Address) => Promise<boolean>,
): Promise<Address | null> {
  for (const candidate of candidates) {
    try {
      if (await isCurrent(candidate)) return candidate;
    } catch {
      // A candidate-specific failure is not evidence that later indexed rows
      // are stale. If every read fails, the result remains safely unavailable.
    }
  }
  return null;
}

/**
 * Recover the current operator candidate from the canonical JBPermissions
 * history when Bendystraw is stale or unavailable. The newest record for each
 * operator wins; a zero-packed record is a revocation. `accept` must still
 * perform live REVOwner and handle checks before trusting a candidate.
 */
export async function findRevnetOperatorFromPermissionHistory({
  client,
  chainId,
  permissions,
  revOwner,
  projectId,
  throughBlock,
  accept,
}: {
  client: PublicClient;
  chainId: number;
  permissions: Address;
  revOwner: Address;
  projectId: bigint;
  throughBlock: bigint;
  accept: (candidate: Address) => Promise<boolean>;
}): Promise<Address | null> {
  const deploymentBlock = JB_PERMISSIONS_DEPLOYMENT_BLOCKS[chainId];
  if (deploymentBlock === undefined || throughBlock < deploymentBlock) return null;

  const seen = new Set<string>();
  let newestBlock = throughBlock;
  let windowSize = OPERATOR_HISTORY_WINDOW;
  let requests = 0;
  let candidates = 0;

  while (newestBlock >= deploymentBlock && requests < MAX_OPERATOR_HISTORY_REQUESTS) {
    const oldestBlock =
      newestBlock - deploymentBlock + 1n > windowSize
        ? newestBlock - windowSize + 1n
        : deploymentBlock;
    const logs = await client.getLogs({
      address: permissions,
      event: operatorPermissionsSetEvent,
      args: { account: revOwner, projectId },
      fromBlock: oldestBlock,
      toBlock: newestBlock,
    });
    requests += 1;

    // Do not trust a provider to truncate a large result consistently. Retry
    // the same newest range more narrowly; a single overfull block is a
    // fail-closed exhaustion rather than permission to inspect partial data.
    if (logs.length > MAX_OPERATOR_HISTORY_LOGS_PER_WINDOW) {
      if (oldestBlock === newestBlock) return null;
      windowSize = windowSize > 1n ? windowSize / 2n : 1n;
      continue;
    }

    logs.sort((left, right) => {
      const leftBlock = left.blockNumber ?? 0n;
      const rightBlock = right.blockNumber ?? 0n;
      if (leftBlock !== rightBlock) return leftBlock < rightBlock ? 1 : -1;
      return Number(right.logIndex ?? 0) - Number(left.logIndex ?? 0);
    });

    for (const log of logs) {
      if (log.removed) continue;
      const operator = log.args.operator;
      if (
        typeof operator !== "string" ||
        !isAddress(operator) ||
        operator.toLowerCase() === zeroAddress
      ) {
        continue;
      }
      const key = operator.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates += 1;
      if (candidates > MAX_OPERATOR_HISTORY_CANDIDATES) return null;
      if (!log.args.packed) continue;
      try {
        if (await accept(operator)) return operator;
      } catch {
        // An RPC failure or stale entry must not suppress an older candidate.
      }
    }

    if (oldestBlock === deploymentBlock) return null;
    newestBlock = oldestBlock - 1n;
    windowSize = OPERATOR_HISTORY_WINDOW;
  }

  // Reaching a request/result/candidate budget is not evidence of authority.
  return null;
}

/**
 * Pick the currently indexed revnet operator.
 *
 * Bendystraw normally leaves the active row with a non-empty permission set.
 * During an indexing transition it may expose only the role-marked row, so
 * match Juicebox Money's behavior and use that row as a truthful fallback.
 */
export function pickRevnetOperator(rows: readonly RevnetOperatorRow[]): Address | null {
  return revnetOperatorCandidates(rows.filter((row) => row.isRevnetOperator !== false))[0] ?? null;
}
