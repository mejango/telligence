"use client";

import { useViewAs } from "@/lib/view-as";
import type { Address } from "viem";
import { useAccount } from "wagmi";

/**
 * The account the site should DISPLAY data for. While "View as" is active this
 * is the impersonated address; otherwise it is the connected wallet. Write
 * paths must keep using the real connected account (wagmi's useAccount), and
 * the reviewed-write/Relayr seams refuse to transact while view-as is active.
 */
export function useViewedAccount(): {
  address: Address | undefined;
  connectedAddress: Address | undefined;
  isViewAs: boolean;
} {
  const { viewAs } = useViewAs();
  const { address: connectedAddress } = useAccount();
  return {
    address: viewAs ?? connectedAddress,
    connectedAddress,
    isViewAs: !!viewAs,
  };
}
