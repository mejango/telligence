import { useEnsName } from "@/hooks/ens/useEnsName";
import { formatEthAddress } from "@/lib/utils";
import Image from "next/image";
import { twMerge } from "tailwind-merge";
import { Address, Chain } from "viem";
import EtherscanLink from "./EtherscanLink";

const STAMP_FYI_BASE_URL = "https://cdn.stamp.fyi";

export function ensAvatarUrlForAddress(address: string, { size }: { size?: number } = {}) {
  let url = `${STAMP_FYI_BASE_URL}/avatar/${address}`;
  if (size) {
    url += `?s=${size}`;
  }
  return url;
}

export function EthereumAddress({
  address,
  short,
  withEnsName,
  withEnsAvatar,
  avatarProps,
  className,
  chain,
}: {
  address: Address;
  short?: boolean;
  withEnsName?: boolean;
  withEnsAvatar?: boolean;
  avatarProps?: { size?: "sm" | "md" };
  className?: string;
  chain?: Chain;
}) {
  const { data } = useEnsName(address, { enabled: withEnsName });
  const formattedAddress = short ? formatEthAddress(address) : address;
  const ensName = data as string | undefined;

  const renderValue = ensName ?? formattedAddress;

  const avatarSize = avatarProps?.size ?? "md";
  const avatarDimensions = avatarSize === "md" ? 36 : 24;

  return (
    <EtherscanLink
      className={twMerge("inline-flex items-center", className)}
      value={address}
      chain={chain}
    >
      {withEnsAvatar && (
        <Image
          src={ensAvatarUrlForAddress(address)}
          alt={ensName ?? address}
          // shrink-0 is load-bearing: as a shrinkable flex item the avatar
          // contributes nothing to this inline-flex's intrinsic width, so a
          // table column sizes itself an avatar too narrow and a long ENS name
          // spills into the next cell.
          className={twMerge(
            "inline-block shrink-0 mr-2 rounded-full",
            avatarSize === "md" ? "w-9 h-9" : "w-6 h-6",
          )}
          width={avatarDimensions}
          height={avatarDimensions}
        />
      )}
      {renderValue}
    </EtherscanLink>
  );
}
