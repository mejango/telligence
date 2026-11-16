import { legacyIntents } from "@/lib/legacy-intents";
import { savedAttempts, writeHolds } from "@/lib/write-hold";
import {
  getJBContractAddress,
  revDeployerAbi,
  RevnetCoreContracts,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  intent,
  launchIntent,
  SAVED_ATTEMPT_UNREADABLE_LINE,
  type IntentValue,
  type SavedAttempt,
  type WriteHoldHandle,
} from "@bananapus/nana-sdk-core/review";
import { getAbiItem, keccak256, stringToHex, type Hex, type PublicClient } from "viem";

/** The user's launch config as stable text: object keys sorted, bigints in decimal. */
function canonical(config: unknown): string {
  return JSON.stringify(config, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    return item;
  });
}

/** The hash of the user's launch config, as stable text. */
export function launchConfigHash(config: unknown): Hex {
  return keccak256(stringToHex(canonical(config)));
}

/**
 * The launch input every launch key is built from: the form exactly as the user submitted it,
 * copied, so metadata the page refreshes later (a token's symbol) never changes the intent, the
 * salt or the saved-launch lookup.
 */
export function launchInputOf<T>(form: T): T {
  try {
    return structuredClone(form);
  } catch {
    // A value structuredClone can't copy: a plain copy of its data, which is all a key reads.
    return JSON.parse(
      JSON.stringify(form, (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ) as T;
  }
}

/**
 * The launch input as the SDK's launchIntent reads it: addresses and bytes tagged, numbers that
 * aren't whole as text, undefined fields left out. What the page generates for each attempt (the
 * salt, the default stage start, the metadata pin) is never in it.
 */
export function launchConfigOf(input: unknown): IntentValue {
  if (typeof input === "string")
    return /^0x[0-9a-fA-F]{40}$/.test(input)
      ? intent.address(input)
      : /^0x([0-9a-fA-F]{2})*$/.test(input)
        ? intent.hex(input)
        : input;
  if (typeof input === "number") return Number.isSafeInteger(input) ? input : String(input);
  if (typeof input === "bigint" || typeof input === "boolean" || input === null) return input;
  if (Array.isArray(input)) return input.map((item) => launchConfigOf(item ?? null));
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .map(([key, item]) => [key, launchConfigOf(item)]),
    );
  return null;
}

const PREFIX = "revnet:launch-salt:";
const accountPrefix = (account: string) => `${PREFIX}${account.toLowerCase()}:`;

/** Where the single-chain launch of `config` from `account` on `chainId` is journaled. */
export function launchKeyOf(account: string, chainId: number, config: unknown): string {
  return `${accountPrefix(account)}${chainId}:${launchConfigHash(config)}`;
}

/**
 * A single-chain launch the hold reserved for the wallet: its salt (the DeployRevnet event carries
 * it), the block it was sent after, the holds it is held by and the settlements they already showed
 * before it. The main-era build saved only the salt and the block. Domain data only: the SDK's
 * saved-attempt recovery decides what may be sent.
 */
type SavedLaunch = {
  salt: Hex;
  fromBlock?: string;
  namespaces?: string[];
  before?: string[];
  /** The success the hold settled for it, journaled once recovery found it. */
  settled?: { result: "success"; hash: Hex };
};

/**
 * The launch journaled at `key`: undefined only when none is kept. A journal storage won't read,
 * or a malformed record, throws SAVED_ATTEMPT_UNREADABLE_LINE: it is never taken for an absent one.
 */
export function savedLaunchAt(key: string): SavedLaunch | undefined {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    throw new Error(SAVED_ATTEMPT_UNREADABLE_LINE);
  }
  if (raw === null) return undefined;
  let saved: SavedLaunch | undefined;
  try {
    saved = JSON.parse(raw) as SavedLaunch;
  } catch {
    throw new Error(SAVED_ATTEMPT_UNREADABLE_LINE);
  }
  if (!/^0x[0-9a-f]{64}$/i.test(saved?.salt ?? "")) throw new Error(SAVED_ATTEMPT_UNREADABLE_LINE);
  return saved;
}

function persist(key: string, saved: SavedLaunch): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Storage refused: the hold still carries the settlement.
  }
}

/** Journal the attempt the hold just reserved for the wallet. */
export function saveLaunchAttempt(
  key: string,
  attempt: { salt: Hex; fromBlock?: bigint; namespaces: string[]; before: Hex[] },
): void {
  // The retry is journaled now: the salt it kept is its journal's.
  try {
    window.localStorage.removeItem(`${RETRY_PREFIX}${key}`);
  } catch {
    // Kept: the same salt again.
  }
  persist(key, {
    salt: attempt.salt,
    namespaces: attempt.namespaces,
    before: attempt.before,
    ...(attempt.fromBlock !== undefined ? { fromBlock: attempt.fromBlock.toString() } : {}),
  });
}

/** Where the salt of a launch the user checked is kept for its retry. */
const RETRY_PREFIX = "revnet:launch-retry-salt:";

/**
 * The user checked a launch whose result can't be shown (or took its exit): its retry keeps the
 * same salt, so if the earlier attempt landed after all, the retry reverts instead of launching a
 * second revnet.
 */
export function keepSaltForRetry(attempt: { key: string; salt?: Hex }): void {
  if (!attempt.salt) return;
  try {
    window.localStorage.setItem(`${RETRY_PREFIX}${attempt.key}`, attempt.salt);
  } catch {
    // Unsaved: the retry takes a fresh salt.
  }
}

/** The salt a retry of the launch at `key` keeps, if the user checked an earlier attempt. */
export function retrySaltOf(key: string): Hex | undefined {
  try {
    const salt = window.localStorage.getItem(`${RETRY_PREFIX}${key}`);
    return salt && /^0x[0-9a-f]{64}$/i.test(salt) ? (salt as Hex) : undefined;
  } catch {
    return undefined;
  }
}

function removeLaunch(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing kept.
  }
}

/** The keys of every launch `account` has journaled, on any chain. */
export function savedLaunchKeys(account: string): string[] {
  try {
    return Object.keys(window.localStorage).filter((key) => key.startsWith(accountPrefix(account)));
  } catch {
    return [];
  }
}

/** The Center RPC's getLogs window, and the most blocks recovery scans for a saved launch. */
const SCAN_WINDOW = 500n;
const SCAN_RANGE = 50_000n;

/**
 * The revnet the saved launch's salt made: REVDeployer's DeployRevnet event from `account` with its
 * salt, scanned in 500-block windows from the block it was sent after, at most 50,000 blocks,
 * stopping at the first match. None found (a node may answer [] for a window with logs) is
 * undefined: it proves nothing.
 */
async function scanForLaunch(
  client: Pick<PublicClient, "getBlockNumber" | "getLogs">,
  chainId: number,
  account: string,
  saved: { salt: Hex; fromBlock: string },
): Promise<bigint | undefined> {
  const deployer = deployerOf(chainId);
  const head = await client.getBlockNumber();
  const start = BigInt(saved.fromBlock);
  const end = head - start + 1n > SCAN_RANGE ? start + SCAN_RANGE - 1n : head;
  for (let from = start; from <= end; from += SCAN_WINDOW) {
    const to = from + SCAN_WINDOW - 1n > end ? end : from + SCAN_WINDOW - 1n;
    const logs = await client.getLogs({
      address: deployer,
      event: DEPLOY_REVNET,
      fromBlock: from,
      toBlock: to,
    });
    const match = logs.find((log) => !log.removed && sameLaunch(log.args, account, saved.salt));
    if (match?.args.revnetId !== undefined) return match.args.revnetId;
  }
  return undefined;
}

const DEPLOY_REVNET = getAbiItem({ abi: revDeployerAbi, name: "DeployRevnet" });
const deployerOf = (chainId: number) =>
  getJBContractAddress(RevnetCoreContracts.REVDeployer, 6, chainId as JBChainId);

/** The namespaces a single-chain launch of `config` is held by: its SDK intent, then the main era's. */
export function launchNamespacesOf(chainId: number, account: Hex, config: unknown): string[] {
  return [
    launchIntent({ chainId, account, config: launchConfigOf(config) }),
    ...legacyIntents.launch(launchConfigHash(config)),
  ];
}

/** Every hold a launch held by `namespaces` can be held by. */
export function launchHoldsOf(
  chainId: number,
  account: string,
  namespaces: readonly string[],
): WriteHoldHandle[] {
  const to = deployerOf(chainId);
  return namespaces.map((namespace) =>
    writeHolds.open({
      chainId,
      account: account as Hex,
      safe: false,
      namespace,
      call: { to, data: "0x" },
    }),
  );
}

/** Every settlement `holds` show now: what a new attempt journals as already there before it. */
export function settlementsOf(holds: readonly Pick<WriteHoldHandle, "peek">[]): Hex[] {
  return holds.flatMap((hold) => {
    const now = hold.peek();
    return now.status === "clear" && now.settled && "hash" in now.settled ? [now.settled.hash] : [];
  });
}

type LaunchClient = Pick<PublicClient, "getBlockNumber" | "getLogs" | "getTransactionReceipt">;

/** A journaled launch as the SDK's saved-attempt recovery reads it. */
export type LaunchAttempt = SavedAttempt<bigint> & { key: string; salt?: Hex };

/**
 * The launch journaled at `key` as a saved attempt: only what was saved, so it is recovered before
 * anything else is prepared. Its domain check is its own DeployRevnet event with the saved salt
 * (in the settled transaction, or scanned for from the block it was sent after); the journal's
 * strict re-read is the final say before any check or exit retires it. A journal that won't read
 * is still an attempt, held by `namespaces` (the form's, when the caller has it) or the main
 * era's keys, and only the warned exit (`forceUnreadable`) may retire it.
 */
export function launchAttemptOf(
  key: string,
  account: Hex,
  client: LaunchClient,
  namespaces?: readonly string[],
  forceUnreadable: () => boolean = () => false,
): LaunchAttempt {
  const [chainText, configHash] = key.slice(accountPrefix(account).length).split(":");
  const chainId = Number(chainText);
  let saved: SavedLaunch | undefined;
  try {
    saved = savedLaunchAt(key);
  } catch {
    saved = undefined;
  }
  const salt = saved?.salt;
  return {
    key,
    salt,
    chainId,
    account,
    namespaces: saved?.namespaces?.length
      ? saved.namespaces
      : (namespaces ?? legacyIntents.launch(configHash as Hex)),
    saved: {
      started: true,
      ...(saved?.settled ? { hash: saved.settled.hash } : {}),
      ...(saved?.fromBlock && /^\d+$/.test(saved.fromBlock)
        ? { fromBlock: BigInt(saved.fromBlock) }
        : {}),
      before: (saved?.before ?? []) as Hex[],
    },
    async authenticate(hash) {
      if (!salt) return { result: "unknown", reason: SAVED_ATTEMPT_UNREADABLE_LINE };
      const revnetId = hash
        ? await launchOfTransaction(client, chainId, account, salt, hash)
        : saved?.fromBlock && /^\d+$/.test(saved.fromBlock)
          ? await scanForLaunch(client, chainId, account, { salt, fromBlock: saved.fromBlock })
          : undefined;
      return revnetId === undefined ? { result: "unknown" } : { result: "proven", value: revnetId };
    },
    async confirmRetirable() {
      let now: SavedLaunch | undefined;
      try {
        now = savedLaunchAt(key);
      } catch {
        return forceUnreadable();
      }
      // Another tab's newer attempt took the key, or a success is journaled: kept.
      return !now || (now.salt.toLowerCase() === salt?.toLowerCase() && !now.settled);
    },
  };
}

/**
 * Journal the success the SDK's recovery found for a launch, before anything else reads it: from
 * then on it is only followed, never discarded or sent again.
 */
export function journalLaunchSuccess(attempt: LaunchAttempt, hash: Hex): void {
  let saved: SavedLaunch | undefined;
  try {
    saved = savedLaunchAt(attempt.key);
  } catch {
    return;
  }
  if (saved && !saved.settled)
    persist(attempt.key, { ...saved, settled: { result: "success", hash } });
}

/**
 * The journal goes once the SDK lets it (`canDiscard`): never while the hold holds the launch or a
 * success it settled hasn't been followed. It only removes the attempt it was read for, and a
 * journaled success only once that success (`settled`) was followed.
 */
export function discardLaunch(attempt: LaunchAttempt, settled?: Hex): boolean {
  if (!savedAttempts.canDiscard(attempt)) return false;
  let now: SavedLaunch | undefined;
  try {
    now = savedLaunchAt(attempt.key);
  } catch {
    removeLaunch(attempt.key);
    return true;
  }
  if (!now) return true;
  if (attempt.salt && now.salt.toLowerCase() !== attempt.salt.toLowerCase()) return false;
  if (now.settled && now.settled.hash.toLowerCase() !== settled?.toLowerCase()) return false;
  removeLaunch(attempt.key);
  return true;
}

/** The revnet `hash` launched for `account` with `salt`: its own DeployRevnet event, if found. */
async function launchOfTransaction(
  client: Pick<PublicClient, "getLogs" | "getTransactionReceipt">,
  chainId: number,
  account: string,
  salt: Hex,
  hash: Hex,
): Promise<bigint | undefined> {
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") return undefined;
  const logs = await client.getLogs({
    address: deployerOf(chainId),
    event: DEPLOY_REVNET,
    blockHash: receipt.blockHash,
  });
  return logs.find(
    (log) =>
      !log.removed &&
      log.transactionHash?.toLowerCase() === hash.toLowerCase() &&
      sameLaunch(log.args, account, salt),
  )?.args.revnetId;
}

/** Whether a DeployRevnet event's arguments are `account`'s launch with `salt`. */
function sameLaunch(
  args: { caller?: string; configuration?: { description: { salt?: string } } },
  account: string,
  salt: Hex,
): boolean {
  return (
    args.caller?.toLowerCase() === account.toLowerCase() &&
    args.configuration?.description.salt?.toLowerCase() === salt.toLowerCase()
  );
}
