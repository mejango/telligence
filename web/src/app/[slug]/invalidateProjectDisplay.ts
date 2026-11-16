"use server";

import { isSupportedChainId } from "@/app/constants";
import { invalidateProjectDisplay, type ProjectDisplayRef } from "@/lib/server/projectDisplayCache";

/** Public display eviction only; callers cannot mutate or authorize project actions here. */
export async function refreshProjectDisplay(refs: readonly ProjectDisplayRef[]): Promise<void> {
  if (
    !Array.isArray(refs) ||
    refs.length === 0 ||
    refs.length > 8 ||
    refs.some(
      (ref) =>
        !ref ||
        !isSupportedChainId(ref.chainId) ||
        !Number.isSafeInteger(ref.projectId) ||
        ref.projectId < 0 ||
        (ref.groupId !== undefined &&
          (typeof ref.groupId !== "string" || ref.groupId.length > 256)),
    )
  ) {
    throw new Error("Invalid project display refresh");
  }
  invalidateProjectDisplay(refs);
}
