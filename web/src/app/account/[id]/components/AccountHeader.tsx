"use client";

import { EthereumAddress, ensAvatarUrlForAddress } from "@/components/EthereumAddress";
import { Button } from "@/components/ui/button";
import { useEnsName } from "@/hooks/ens/useEnsName";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { mainnet } from "@/lib/chains";
import { useViewAs } from "@/lib/view-as";
import Image from "next/image";
import { type Address } from "viem";

export function AccountHeader({ address, ensName }: { address: Address; ensName?: string }) {
  const { data: reverseName } = useEnsName(address, { enabled: !ensName });
  const displayName = ensName ?? reverseName ?? undefined;

  const { address: viewed } = useViewedAccount();
  const isSelf = !!viewed && viewed.toLowerCase() === address.toLowerCase();

  const { viewAs, setViewAs, clearViewAs } = useViewAs();
  const viewingThisAccount = viewAs?.toLowerCase() === address.toLowerCase();

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-3">
        <Image
          src={ensAvatarUrlForAddress(address, { size: 96 })}
          alt={displayName ?? address}
          width={48}
          height={48}
          className="h-12 w-12 rounded-full"
        />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-zinc-800">
            {displayName ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
          </h1>
          <div className="break-all font-mono text-xs text-zinc-500">
            <EthereumAddress address={address} withEnsName={false} chain={mainnet} />
          </div>
          {isSelf ? (
            <span className="mt-1 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
              This is you
            </span>
          ) : null}
        </div>
      </div>
      {viewingThisAccount ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          onClick={clearViewAs}
        >
          Exit View as
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          onClick={() => setViewAs(address)}
        >
          View site as this account
        </Button>
      )}
    </header>
  );
}
