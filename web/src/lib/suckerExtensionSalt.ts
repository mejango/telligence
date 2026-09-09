import { createSalt } from "@bananapus/nana-sdk-core";
import type { Address } from "viem";

/**
 * The salt for one sucker-extension attempt, held until the attempt completes.
 *
 * `JBSuckerRegistry.deploySuckersFor` derives each sucker's address from
 * `keccak256(abi.encode(sender, salt))` (JBSuckerRegistry.sol:1043), which is what makes a
 * pair of peers land on the SAME address on both chains — the registry's own comment calls
 * this "an intentional part of the same-address peer invariant".
 *
 * An extension writes to several chains in sequence, and `runSequentialWrites` throws on the
 * first failure — including the Safe path, which always throws a pending error at the first
 * proposal. So a partial run is the NORMAL case, not an edge case. Minting a fresh salt on
 * the retry would deploy the remaining suckers at addresses the already-deployed peers can
 * never pair with, leaving orphans that bridged funds can reach but nothing can claim from.
 *
 * The salt is therefore keyed by (sender, project, target chain) and reused until the
 * attempt is finished. It is scoped to the sender because the derivation includes it: a
 * different wallet resuming the same extension must NOT reuse the salt, since its suckers
 * would land elsewhere regardless.
 */
const STORAGE_KEY = "revnet-sucker-extension-salt-v1";

type SaltStore = Record<string, `0x${string}`>;

function attemptKey(sender: Address, projectId: bigint | number, targetChainId: number): string {
  return `${sender.toLowerCase()}:${projectId.toString()}:${targetChainId}`;
}

function read(): SaltStore {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as SaltStore;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: SaltStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable: the attempt still works, it just cannot be resumed safely.
  }
}

/** The salt for this attempt: the one already in flight, or a fresh one recorded for reuse. */
export function saltForExtension(
  sender: Address,
  projectId: bigint | number,
  targetChainId: number,
): `0x${string}` {
  const key = attemptKey(sender, projectId, targetChainId);
  const store = read();
  const existing = store[key];
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing;
  const salt = createSalt();
  write({ ...store, [key]: salt });
  return salt;
}

/** Clear the attempt once every chain succeeded, so the next extension starts fresh. */
export function clearExtensionSalt(
  sender: Address,
  projectId: bigint | number,
  targetChainId: number,
): void {
  const key = attemptKey(sender, projectId, targetChainId);
  const store = read();
  if (!(key in store)) return;
  delete store[key];
  write(store);
}
