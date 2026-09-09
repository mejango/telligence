import { isAddress, zeroAddress, type Address, type Hex } from "viem";
import { validateComputeDraft } from "./presentation";
import type { ComputeProjectDraft } from "./types";

export type PendingLaunch = {
  version: 1;
  creator: Address;
  factory: Address;
  hash: Hex;
  preparationId: string;
  draft: ComputeProjectDraft;
};
export const pendingLaunchKey = (address: string) =>
  `telligence:launch:8453:${address.toLowerCase()}`;

/** Storage is untrusted and contains only public transaction intent, never credentials.
 * Callers must distinguish absent storage from an invalid record before permitting another deployment.
 */
export function parsePendingLaunch(raw: string | null, creator: string): PendingLaunch | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value ||
      value.version !== 1 ||
      typeof value.creator !== "string" ||
      !isAddress(value.creator) ||
      value.creator.toLowerCase() === zeroAddress ||
      value.creator.toLowerCase() !== creator.toLowerCase() ||
      typeof value.factory !== "string" ||
      !isAddress(value.factory) ||
      value.factory.toLowerCase() === zeroAddress ||
      typeof value.hash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(value.hash) ||
      typeof value.preparationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.preparationId,
      )
    )
      return null;
    const source = value.draft;
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      typeof source.name !== "string" ||
      typeof source.purpose !== "string" ||
      typeof source.workload !== "string" ||
      typeof source.targetDailyCreditUsd !== "string" ||
      !Number.isInteger(source.productionSplitBps) ||
      source.productionSplitBps <= 0 ||
      source.productionSplitBps >= 10_000 ||
      !Number.isInteger(source.cashOutTaxBps) ||
      source.cashOutTaxBps < 0 ||
      source.cashOutTaxBps >= 10_000 ||
      (source.recoveryAddress !== undefined &&
        (typeof source.recoveryAddress !== "string" ||
          !isAddress(source.recoveryAddress) ||
          source.recoveryAddress.toLowerCase() === zeroAddress))
    )
      return null;
    const draft: ComputeProjectDraft = {
      name: source.name,
      purpose: source.purpose,
      workload: source.workload,
      targetDailyCreditUsd:
        source.targetDailyCreditUsd.trim() === "" ? "" : source.targetDailyCreditUsd,
      productionSplitBps: source.productionSplitBps,
      operatorSplitBps: source.operatorSplitBps === undefined ? 0 : source.operatorSplitBps,
      cashOutTaxBps: source.cashOutTaxBps,
      ...(source.recoveryAddress !== undefined ? { recoveryAddress: source.recoveryAddress } : {}),
    };
    if (Object.keys(validateComputeDraft(draft)).length) return null;
    return {
      version: 1,
      creator: value.creator,
      factory: value.factory,
      hash: value.hash,
      preparationId: value.preparationId,
      draft,
    };
  } catch {
    return null;
  }
}
