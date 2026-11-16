"use client";

import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { StickyRecipient } from "@/components/sticky/StickyRecipient";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SkeletonLines } from "@/components/ui/skeleton";
import { isStickyHook } from "@/lib/sticky";
import {
  getJBContractAddress,
  jb721TiersHookStoreAbi,
  JB_CHAINS,
  JBChainId,
  JBCoreContracts,
  jbSplitsAbi,
} from "@bananapus/nana-sdk-core";
import { effectiveTierPrice, getProject721Shop } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { Address, PublicClient, zeroAddress } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ProjectItem } from "../shared";
import {
  customVotingUnits,
  describeTransferSchedule,
  discountLabel,
  formatShopAmount,
  ShopInventory,
  ShopTier,
  TIER_UNLIMITED_SUPPLY,
  tierDisplayName,
  TierMedia,
  tierSaleShares,
  useTierCart,
} from "./shopLib";
import type { ItemChange } from "./shopMediaEdit";
import { TierMediaPreview } from "./TierMediaPreview";

const FLAG_DESCRIPTIONS: [keyof NonNullable<ShopTier["flags"]>, string, string][] = [
  [
    "allowOwnerMint",
    "Operator can give items",
    "The operator can create and give this item without a payment.",
  ],
  ["cantBeRemoved", "Cannot be removed", "This item can never be removed from the shop."],
  [
    "cantIncreaseDiscountPercent",
    "Discount capped",
    "This item's discount can only be lowered, never increased.",
  ],
  [
    "cantBuyWithCredits",
    "Payment required",
    "This item requires a payment. Shop credits cannot be used.",
  ],
];

/**
 * The tier detail popup (website/ openTierDetail parity): media, price,
 * supply remaining per chain, quantity stepper feeding the shared cart, and
 * the tier's immutable facts + flags.
 */
export function TierDetailModal({
  shop,
  chainId,
  projects,
  tier,
  media,
  onMint,
  onChangeItem,
  onClose,
}: {
  shop: ShopInventory;
  chainId: JBChainId;
  projects: ProjectItem[];
  tier: ShopTier;
  media: TierMedia | undefined;
  onMint?: () => void;
  /** Present for a wallet that can manage the item; each dialog refuses a missing permission. */
  onChangeItem?: (change: ItemChange) => void;
  onClose: () => void;
}) {
  const config = useConfig();
  const { quantityOf, setTierQuantity } = useTierCart(shop, chainId);

  const name = tierDisplayName(media, tier.id);
  const quantity = quantityOf(tier.id);
  const soldOut = !tier.unlimited && tier.remaining <= 0;
  const cap = tier.unlimited ? 99 : tier.remaining;
  const discounted = tier.discountPercent > 0;
  const effective = effectiveTierPrice(tier.price, tier.discountPercent);

  // Remaining supply for this tier id on every linked deployment. Per-chain
  // failures stay local so one flaky RPC never hides the chains that read.
  const supply = useQuery({
    queryKey: ["v6Shop721TierSupply", tier.id, projects.map((p) => `${p.chainId}:${p.projectId}`)],
    staleTime: 30_000,
    retry: 1,
    queryFn: async () =>
      Promise.all(
        projects.map(async (project) => {
          const targetChainId = project.chainId as JBChainId;
          try {
            if (targetChainId === chainId) {
              return {
                chainId: targetChainId,
                state: "ready" as const,
                remaining: tier.remaining,
                initial: tier.initial,
              };
            }
            const client = getPublicClient(config, { chainId: targetChainId }) as
              PublicClient | undefined;
            if (!client) return { chainId: targetChainId, state: "unavailable" as const };
            const targetShop = await getProject721Shop(client, {
              chainId: targetChainId,
              projectId: BigInt(project.projectId),
              isRevnet: true,
              tierLimit: 0,
            });
            const targetTier = targetShop
              ? (
                  await client.readContract({
                    address: targetShop.store,
                    abi: jb721TiersHookStoreAbi,
                    functionName: "tiersOf",
                    args: [targetShop.hook, [], false, BigInt(tier.id), 1n],
                  })
                )[0]
              : undefined;
            if (targetTier && Number(targetTier.id) !== tier.id) {
              return { chainId: targetChainId, state: "missing" as const };
            }
            if (!targetTier) return { chainId: targetChainId, state: "missing" as const };
            return {
              chainId: targetChainId,
              state: "ready" as const,
              remaining: targetTier.remainingSupply,
              initial: targetTier.initialSupply,
            };
          } catch {
            return { chainId: targetChainId, state: "unavailable" as const };
          }
        }),
      ),
  });

  const setFlags = tier.flags ? FLAG_DESCRIPTIONS.filter(([flag]) => tier.flags![flag]) : [];
  const transferability = !tier.flags
    ? "Unavailable"
    : !tier.flags.transfersPausable
      ? "Transferable"
      : shop.fixedTierTransferability === true
        ? "Non-transferable"
        : shop.fixedTierTransferability === null
          ? "Transfer policy unavailable"
          : (describeTransferSchedule(shop.transferPauseByStage) ??
            "Set by each stage; schedule unavailable");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0">
        <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex min-h-56 items-center justify-center bg-white p-4">
            <TierMediaPreview media={media} tierId={tier.id} alt={name} detail />
          </div>

          <div className="bg-melon-50 p-5">
            <DialogTitle className="pr-8 text-xl font-medium text-zinc-900">{name}</DialogTitle>
            {media?.description ? (
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{media.description}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-lg font-medium text-zinc-900">
                {formatShopAmount(effective, shop.pricing.decimals)} {shop.pricing.symbol}
              </span>
              {discounted ? (
                <>
                  <span className="text-sm text-zinc-500 line-through">
                    {formatShopAmount(tier.price, shop.pricing.decimals)} {shop.pricing.symbol}
                  </span>
                  <span className="rounded-full bg-teal-500 px-2 py-0.5 text-[11px] font-medium text-melon-950">
                    {discountLabel(tier.discountPercent)}
                  </span>
                </>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTierQuantity(tier, media, quantity - 1)}
                disabled={quantity <= 0}
                aria-label={`Remove one ${name}`}
                className="flex h-9 w-9 items-center justify-center border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-8 text-center font-medium tabular-nums text-zinc-900">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setTierQuantity(tier, media, Math.min(cap, quantity + 1))}
                disabled={soldOut || quantity >= cap}
                aria-label={`Add one ${name}`}
                className="flex h-9 min-w-9 items-center justify-center bg-melon-500 px-3 text-melon-950 hover:bg-melon-600 disabled:opacity-40"
              >
                +
              </button>
              <span className="ml-1 text-xs text-zinc-500">
                {soldOut
                  ? "Sold out"
                  : tier.unlimited
                    ? "Unlimited inventory"
                    : `${tier.remaining.toLocaleString("en-US")} left on ${chainDisplayName(chainId)}`}
              </span>
            </div>

            {onChangeItem
              ? (
                  [
                    ["media", "Replace media across chains →"],
                    ["details", "Edit details →"],
                    ["discount", "Set discount →"],
                    ...(tier.flags?.cantBeRemoved ? [] : [["remove", "Remove item →"]]),
                  ] as [ItemChange, string][]
                ).map(([change, label]) => (
                  <button
                    key={change}
                    type="button"
                    onClick={() => onChangeItem(change)}
                    className="mt-3 block text-sm font-medium text-teal-700 underline underline-offset-4 hover:text-teal-900"
                  >
                    {label}
                  </button>
                ))
              : null}

            {onMint ? (
              <button
                type="button"
                onClick={onMint}
                className="mt-3 text-sm font-medium text-teal-700 underline underline-offset-4 hover:text-teal-900"
              >
                Give to a recipient without payment →
              </button>
            ) : null}

            <div className="mt-5 border-t border-zinc-200 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Supply by chain
              </p>
              <div className="mt-2 space-y-1.5">
                {supply.isLoading ? (
                  <SkeletonLines lines={Math.max(projects.length, 2)} />
                ) : (
                  supply.data?.map((row) => (
                    <div
                      key={row.chainId}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="inline-flex items-center gap-1.5 text-zinc-600">
                        <ChainLogo chainId={row.chainId} width={15} height={15} />
                        {chainDisplayName(row.chainId)}
                      </span>
                      <span className="tabular-nums text-zinc-900">
                        {row.state === "missing"
                          ? "Not on this chain"
                          : row.state === "unavailable"
                            ? "Unavailable"
                            : row.initial >= TIER_UNLIMITED_SUPPLY
                              ? "Unlimited"
                              : `${row.remaining.toLocaleString("en-US")} / ${row.initial.toLocaleString("en-US")} left`}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-zinc-200 pt-4 text-xs">
              <Fact label="Item ID" value={`#${tier.id}`} />
              <Fact label="Transfers" value={transferability} />
              <Fact
                label="Category"
                value={
                  media?.categoryName ??
                  (tier.category === 0 ? "General" : `Category ${tier.category}`)
                }
              />
              {discounted ? (
                <Fact label="Current discount" value={discountLabel(tier.discountPercent)} />
              ) : null}
              {tier.reserveFrequency > 0 ? (
                <Fact label="Items set aside" value={`1 per ${tier.reserveFrequency} sold`} />
              ) : null}
              {customVotingUnits(tier) !== null ? (
                <Fact label="Voting units" value={tier.votingUnits.toLocaleString("en-US")} />
              ) : null}
            </dl>

            {tier.splitPercent > 0 ? (
              <TierSaleRouting
                chainId={chainId}
                projectId={projects.find((p) => p.chainId === chainId)?.projectId}
                hook={shop.hook}
                tier={tier}
                issueTokensForSplits={shop.configFlags?.issueTokensForSplits ?? false}
              />
            ) : null}

            {setFlags.length > 0 ? (
              <div className="mt-4 border-t border-zinc-200 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Item rules
                </p>
                <div className="mt-2 space-y-2">
                  {setFlags.map(([flag, label, description]) => (
                    <div key={flag}>
                      <p className="text-xs font-medium text-zinc-900">{label}</p>
                      <p className="text-xs text-zinc-500">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where each sale of this tier goes. The tier's split share is paid out to
 * its split group (`groupId = hook | tierId << 160`, ruleset 0); whatever the
 * group leaves unclaimed, and everything outside the share, lands in the
 * project's balance.
 */
function TierSaleRouting({
  chainId,
  projectId,
  hook,
  tier,
  issueTokensForSplits,
}: {
  chainId: JBChainId;
  projectId: number | undefined;
  hook: Address;
  tier: ShopTier;
  issueTokensForSplits: boolean;
}) {
  const splits = useReadContract({
    chainId,
    address: getJBContractAddress(JBCoreContracts.JBSplits, 6, chainId),
    abi: jbSplitsAbi,
    functionName: "splitsOf",
    args: [BigInt(projectId ?? 0), 0n, BigInt(hook) | (BigInt(tier.id) << 160n)],
    query: { enabled: projectId !== undefined, staleTime: 60_000 },
  });

  const { rows, treasuryBps } = tierSaleShares(tier.splitPercent, splits.data ?? []);

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Where each sale goes
      </p>
      {splits.isPending && projectId !== undefined ? (
        <SkeletonLines className="mt-2" lines={2} />
      ) : splits.isError || projectId === undefined ? (
        <p className="mt-2 text-xs text-zinc-500">
          {formatBps(BigInt(tier.splitPercent) / 100_000n)} of each sale is split with recipients we
          could not read; the rest goes to the project.
        </p>
      ) : (
        <dl className="mt-2 space-y-1.5 text-xs">
          {rows.map(({ split, bps }, index) => {
            const toProject = split.projectId > 0n;
            const toHook = split.hook.toLowerCase() !== zeroAddress;
            return (
              <div key={index} className="flex items-start justify-between gap-4">
                <dt className="min-w-0 text-zinc-900">
                  {isStickyHook(split.hook, chainId) ? (
                    <StickyRecipient split={split} chainId={chainId} />
                  ) : toProject ? (
                    `Project #${split.projectId.toString()}`
                  ) : (
                    <EthereumAddress
                      address={toHook ? split.hook : split.beneficiary}
                      chain={JB_CHAINS[chainId].chain}
                      short
                      withEnsName
                    />
                  )}
                </dt>
                <dd className="tabular-nums text-zinc-900">{formatBps(bps)}</dd>
              </div>
            );
          })}
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-500">This project</dt>
            <dd className="tabular-nums text-zinc-900">{formatBps(treasuryBps)}</dd>
          </div>
        </dl>
      )}
      {!issueTokensForSplits ? (
        <p className="mt-2 text-xs text-zinc-500">
          Tokens are issued on the {formatBps(10_000n - BigInt(tier.splitPercent) / 100_000n)} the
          project keeps, not the full price.
        </p>
      ) : null}
    </div>
  );
}

function formatBps(bps: bigint) {
  return `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-900">{value}</dd>
    </div>
  );
}
