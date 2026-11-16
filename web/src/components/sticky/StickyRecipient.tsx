"use client";

import { readEach } from "@/lib/read-each";
import { stickyRecipientLabel } from "@/lib/sticky";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { usePublicClient } from "wagmi";

/**
 * A Sticky split's recipient: "Sticky holders stuck 4 to 52 weeks → STICKY".
 * The group is the split's projectId, so it never reads as a project. The
 * token address shows until its symbol loads, and stays on hover.
 */
export function StickyRecipient({
  split,
  chainId,
}: {
  split: { projectId: bigint; beneficiary: Address };
  chainId: JBChainId;
}) {
  const client = usePublicClient({ chainId });
  // The beneficiary is a token the project chose, so its read stays apart from
  // the page's others: one that burns its gas fails only itself.
  const { data: symbol } = useQuery({
    queryKey: ["sticky-recipient-symbol", chainId, split.beneficiary.toLowerCase()],
    enabled: !!client,
    staleTime: Infinity,
    queryFn: async () => {
      const [read] = await readEach(client!, [
        { address: split.beneficiary, abi: erc20Abi, functionName: "symbol" },
      ]);
      return read?.status === "success" && typeof read.result === "string" ? read.result : null;
    },
  });
  return <span title={split.beneficiary}>{stickyRecipientLabel(split, symbol ?? undefined)}</span>;
}
