import { useEnsName } from "@/hooks/ens/useEnsName";
import { ensAvatarUrlForAddress } from "@/lib/ensAvatarUrl";
import { formatEthAddress } from "@/lib/utils";
import Image from "next/image";
import { twMerge } from "tailwind-merge";
import { Address, Chain } from "viem";
import EtherscanLink from "./EtherscanLink";
import { SafeBadge } from "./SafeBadge";

export function EthereumAddress({
  address,
  short,
  withEnsName,
  withEnsAvatar,
  avatarProps,
  className,
  chain,
  showSafe = false,
}: {
  address: Address;
  short?: boolean;
  withEnsName?: boolean;
  withEnsAvatar?: boolean;
  avatarProps?: { size?: "sm" | "md" };
  className?: string;
  chain?: Chain;
  showSafe?: boolean;
}) {
  const { data } = useEnsName(address, { enabled: withEnsName });
  const formattedAddress = short ? formatEthAddress(address) : address;
  // A disabled query still returns another component's cached lookup.
  const ensName = withEnsName === false ? undefined : (data as string | undefined);

  const renderValue = ensName ?? formattedAddress;

  const avatarSize = avatarProps?.size ?? "md";
  const avatarDimensions = avatarSize === "md" ? 36 : 24;

  const link = (
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
  return showSafe && chain ? (
    <span className="inline-flex items-center">
      {link}
      <SafeBadge address={address} chainId={chain.id} />
    </span>
  ) : (
    link
  );
}
