"use client";

import { useOnRamp } from "@/components/GetFunds";
import { ImageWithFallback } from "@/components/IpfsImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllowance } from "@/hooks/useAllowance";
import { useReviewedPermit2Signature } from "@/hooks/useReviewedPermit2Signature";
import {
  isSafeProposalPendingError,
  requireOnchainExecution,
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import {
  addPermit2SignatureToDirectPaySwap,
  buildDirectPaySwapTx,
  PERMIT2_ADDRESS,
  permit2Abi,
  type Permit2SignatureAuthorization,
  permit2SignatureNeedsOnchainFallback,
  quoteDirectPaySwap,
  UNIVERSAL_ROUTER_BY_CHAIN,
} from "@/lib/directPaySwap";
import { useJBTokenContext } from "@/lib/nana/project";
import { useSuckers } from "@/lib/nana/suckers";
import { resolveBestV6PayRoute } from "@/lib/paymentTerminal";
import { minReturnedTokens } from "@/lib/quote";
import { Token } from "@/lib/token";
import { formatTokenSymbol, formatWalletError } from "@/lib/utils";
import {
  formatPayAmount,
  formatStartCountdown,
  isNativePayToken,
  payTokenKey,
  V6PayMode,
} from "@/lib/v6/pay";
import {
  isTransactionReceiptUnavailableError,
  waitForReceiptWithRetry,
} from "@/lib/waitForReceipt";
import { useParaAuth } from "@/providers/ParaAuthContext";
import {
  JB_CHAINS,
  JBChainId,
  jbContractAddress,
  JBCoreContracts,
  jbMultiTerminalAbi,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import {
  build721PayMetadata,
  buildPayTx,
  effectiveTierPrice,
  previewPay,
  resolvePaymentTerminal,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  Hex,
  parseUnits,
  PublicClient,
  zeroAddress,
} from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useSelectedSucker } from "../../PayCard/SelectedSuckerContext";
import { readPoolSnapshot } from "../owners/market/lib";
import { useShopCart } from "../ShopCartContext";
import {
  buyableAsset,
  defaultsToDollars,
  payButtonAction,
  payPanelLayoutClasses,
  paySettlementLabel,
} from "./payCardLayout";
import { TextSelect } from "./TextSelect";
import {
  BASE_CURRENCY_ETH,
  BASE_CURRENCY_USD,
  usePayShop,
  usePayShopCredits,
  usePayShopRoutes,
} from "./usePayShop";
import { usePaySurface } from "./usePaySurface";
import {
  PreparedV6Pay,
  type PreparedV6TransactionAction,
  V6PayConfirmDialog,
  V6PayPhase,
} from "./V6PayConfirmDialog";
import { V6PayShopStrip } from "./V6PayShopStrip";

function payChainName(chainId: JBChainId): string {
  const compactNames: Partial<Record<JBChainId, string>> = {
    11155420: "OP Sep",
    84532: "Base Sep",
    421614: "Arb Sep",
  };
  return compactNames[chainId] ?? JB_CHAINS[chainId]?.name ?? String(chainId);
}

/**
 * The full-featured v6 pay card (website/ pay-card parity): mode + chain
 * header, on-chain accepted-token list (direct + live-probed via-router),
 * debounced live preview, 721 shop strip with credits, memo, and a
 * confirm-before-send flow with a fresh previewed minimum and simulate-first
 * sends.
 */
/** Sentinel for the token menu's buy entry; never a token index. */
const BUY_OPTION = "buy";

export function V6PayCard() {
  const { selectedSucker, setSelectedSucker } = useSelectedSucker();
  const chainId = selectedSucker.peerChainId;
  const projectId = selectedSucker.projectId;

  const { data: suckers } = useSuckers();
  const chainOptions = useMemo(
    () => (suckers && suckers.length > 0 ? suckers : [selectedSucker]),
    [suckers, selectedSucker],
  );

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId });
  // Every wallet action confirms through the one transaction safety check —
  // the same shell every multi-step flow uses. The confirm dialog only shows
  // the intent summary and the step queue.
  const { writeContractAsync } = useWriteContract({
    transactionReview: {
      title: "Review the payment",
      confirmLabel: "Agree & send",
    },
  });
  const { signPermit2Async } = useReviewedPermit2Signature();
  const { ensureAllowance, getApprovalReceipt } = useAllowance(chainId);

  const projectToken = useJBTokenContext().token.data;
  const projectTokenLabel = projectToken?.symbol
    ? formatTokenSymbol(projectToken.symbol)
    : "tokens";
  const nativeSymbol = "ETH";

  // ---- Form state ----
  const [mode, setMode] = useState<V6PayMode>("pay");
  const [amount, setAmount] = useState("");
  const [debouncedAmount, setDebouncedAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [showRouteComparison, setShowRouteComparison] = useState(false);
  const [tokenIndex, setTokenIndex] = useState(0);
  // True once the user explicitly picks a pay token. Until then the selection
  // auto-defaults to the project's accounting token (list[0]) so an ETH/USDC
  // router option never shadows a USDC/ETH project's real token.
  const [tokenTouched, setTokenTouched] = useState(false);
  /** "$" is picked in the token menu: the payer has dollars, not the token this project takes.
   *  Nothing is bought until they press Pay — the amount is theirs to type first. */
  const [payWithDollars, setPayWithDollars] = useState(false);
  const [buyExplainerOpen, setBuyExplainerOpen] = useState(false);
  // The (address+route) identity of the user's pick, so a background refetch or
  // chain switch remaps the index to the same token rather than clobbering it.
  const selectedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAmount(amount), 400);
    return () => clearTimeout(t);
  }, [amount]);

  // ---- Payment surface: accepted tokens + live ruleset gates ----
  const { data: surface, isError: surfaceError } = usePaySurface(chainId, projectId);
  const tokens = useMemo(() => surface?.tokens ?? [], [surface]);
  const selected = tokens.length > 0 ? tokens[Math.min(tokenIndex, tokens.length - 1)] : undefined;
  const decimals = selected?.decimals ?? 18;

  // Keep the index in lock-step with the token list as it (re)resolves: default
  // to list[0] (the accounting token) until touched; re-find an explicit pick.
  useEffect(() => {
    if (tokens.length === 0) return;
    if (!tokenTouched) {
      if (tokenIndex !== 0) setTokenIndex(0);
      return;
    }
    const key = selectedKeyRef.current;
    const idx = key ? tokens.findIndex((t) => payTokenKey(t) === key) : -1;
    if (idx >= 0) {
      if (idx !== tokenIndex) setTokenIndex(idx);
    } else {
      selectedKeyRef.current = null;
      setTokenTouched(false);
      setTokenIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, tokenTouched]);

  // ---- Ruleset start countdown ----
  const startsAt = surface?.rulesetStart ?? 0;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!startsAt || startsAt <= now) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [startsAt, now]);
  const notStarted = startsAt > now;

  const amountRaw = useMemo(() => {
    try {
      const trimmed = debouncedAmount.trim();
      if (!trimmed || Number(trimmed) <= 0) return 0n;
      return parseUnits(trimmed, decimals);
    } catch {
      return 0n;
    }
  }, [debouncedAmount, decimals]);

  // ---- 721 shop ----
  const { data: shop } = usePayShop(chainId, projectId);
  const { data: shopCredits = 0n, isLoading: shopCreditsLoading } = usePayShopCredits(
    chainId,
    shop?.hook,
  );
  const { data: shopRoutes, isLoading: shopRoutesLoading } = usePayShopRoutes(
    chainId,
    projectId,
    shop,
    tokens,
  );

  const cart = useShopCart();
  const chainCartItems = useMemo(
    () =>
      cart.items.filter(
        (i) =>
          i.chainId === Number(chainId) &&
          (!shop || i.hook.toLowerCase() === shop.hook.toLowerCase()),
      ),
    [cart.items, chainId, shop],
  );
  const cartCount = chainCartItems.reduce((sum, i) => sum + i.quantity, 0);

  // Clamp stale cart quantities against live per-chain supply; drop dead tiers.
  useEffect(() => {
    if (!shop) return;
    for (const item of chainCartItems) {
      const tier = shop.tiers.find((t) => t.id === Number(item.tierId));
      if (!tier) {
        cart.remove(item.tierId, item.chainId);
        continue;
      }
      const cap = tier.unlimited ? 99 : tier.remaining;
      if (item.quantity > cap) cart.setQuantity(item.tierId, item.chainId, cap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop, chainCartItems]);

  const selectedShopRoute = selected ? shopRoutes?.[payTokenKey(selected)] : undefined;
  const shopMatchesToken = !!selectedShopRoute?.supported;
  // A feed the app could not READ is not a feed the protocol lacks. Both hide the route, but
  // only one of them is permanent, and only one of them is worth retrying.
  const shopRouteCheckFailed = useMemo(
    () => !!shopRoutes && tokens.some((t) => shopRoutes[payTokenKey(t)]?.unavailable),
    [shopRoutes, tokens],
  );
  const supportedShopTokenIndexes = useMemo(
    () => tokens.flatMap((t, index) => (shopRoutes?.[payTokenKey(t)]?.supported ? [index] : [])),
    [tokens, shopRoutes],
  );

  // Selecting items moves the token selector to the best verified checkout
  // token instead of silently discarding the cart.
  useEffect(() => {
    if (cartCount === 0 || shopRoutesLoading || shopMatchesToken || !shop) return;
    const preferred = supportedShopTokenIndexes
      .map((index) => ({ index, token: tokens[index] }))
      .sort((a, b) => {
        const score = (t: (typeof tokens)[number]) =>
          t.currency === shop.pricingCurrency
            ? 3
            : shop.pricingCurrency === BASE_CURRENCY_ETH && isNativePayToken(t.token)
              ? 2
              : shop.pricingCurrency === BASE_CURRENCY_USD && t.symbol.toUpperCase() === "USDC"
                ? 2
                : 1;
        return score(b.token) - score(a.token);
      })[0];
    if (!preferred) return;
    setTokenIndex(preferred.index);
    selectedKeyRef.current = payTokenKey(preferred.token);
    setTokenTouched(true);
  }, [cartCount, shopRoutesLoading, shopMatchesToken, supportedShopTokenIndexes, tokens, shop]);

  const shopPricingSymbol = !shop
    ? ""
    : shop.pricingCurrency === BASE_CURRENCY_ETH
      ? nativeSymbol
      : shop.pricingCurrency === BASE_CURRENCY_USD
        ? "USD"
        : (tokens.find((t) => t.currency === shop.pricingCurrency)?.symbol ?? "units");

  // Checkout totals, in the shop's pricing units.
  const cartTotal = useMemo(() => {
    if (!shop || cartCount === 0) return 0n;
    return shop.tiers.reduce((sum, tier) => {
      const qty = chainCartItems.find((i) => Number(i.tierId) === tier.id)?.quantity ?? 0;
      return sum + effectiveTierPrice(tier.price, tier.discountPercent) * BigInt(qty);
    }, 0n);
  }, [shop, chainCartItems, cartCount]);
  const restrictedCartTotal = useMemo(() => {
    if (!shop) return 0n;
    return shop.tiers.reduce((sum, tier) => {
      if (!tier.cantBuyWithCredits) return sum;
      const qty = chainCartItems.find((i) => Number(i.tierId) === tier.id)?.quantity ?? 0;
      return sum + effectiveTierPrice(tier.price, tier.discountPercent) * BigInt(qty);
    }, 0n);
  }, [shop, chainCartItems]);
  const shopCreditApplied = useMemo(() => {
    const eligible = cartTotal - restrictedCartTotal;
    if (eligible <= 0n || shopCredits <= 0n) return 0n;
    return shopCredits < eligible ? shopCredits : eligible;
  }, [cartTotal, restrictedCartTotal, shopCredits]);
  const cartAmountDue = cartTotal - shopCreditApplied;

  // Keep the entered amount at least the verified checkout total. The price
  // feed is expressed in payment-token units and this direction rounds up,
  // matching the hook's fail-safe normalization.
  const cartTotalInToken = useMemo(() => {
    const pricePerUnit = selectedShopRoute?.pricePerUnit;
    if (!shop || mode !== "pay" || cartAmountDue === 0n || !selected || !pricePerUnit) return 0n;
    const denominator = 10n ** BigInt(shop.pricingDecimals);
    return (cartAmountDue * pricePerUnit + denominator - 1n) / denominator;
  }, [shop, mode, cartAmountDue, selected, selectedShopRoute]);

  useEffect(() => {
    if (mode !== "pay" || cartCount === 0 || !shopMatchesToken) return;
    const current = (() => {
      try {
        return parseUnits(amount.trim() || "0", decimals);
      } catch {
        return 0n;
      }
    })();
    if (current === cartTotalInToken) return;
    const next = formatUnits(cartTotalInToken, decimals);
    setAmount(next);
    setDebouncedAmount(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartTotalInToken, cartCount, shopMatchesToken, mode]);

  const tierIds = useMemo(
    () =>
      chainCartItems.flatMap((item) => Array.from({ length: item.quantity }, () => item.tierId)),
    [chainCartItems],
  );
  // Metadata ids key off the hook's METADATA_ID_TARGET (the shared
  // implementation), never the clone — else the payment mints ZERO NFTs.
  const metadata: Hex | undefined =
    shop && tierIds.length > 0 && shopMatchesToken
      ? build721PayMetadata({ metadataIdTarget: shop.idTarget, tierIdsToMint: tierIds })
      : undefined;

  // ---- Debounced live preview via the best route (multi vs router) ----
  const {
    data: preview,
    isFetching: previewLoading,
    isError: previewError,
    isPlaceholderData: previewIsPrevious,
    isStale: previewIsStale,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: [
      "v6PayPreview",
      chainId,
      projectId.toString(),
      selected ? payTokenKey(selected) : "",
      amountRaw.toString(),
      metadata ?? "0x",
      address ?? zeroAddress,
    ],
    enabled: !!publicClient && !!selected && mode === "pay" && (amountRaw > 0n || cartCount > 0),
    placeholderData: (previous) => previous,
    retry: false,
    queryFn: async () => {
      const client = publicClient as PublicClient;
      const beneficiary = address ?? zeroAddress;
      if (metadata) {
        // Item checkout goes to the directly resolved terminal so the 721 hook
        // sees the tier metadata.
        const resolved = await resolvePaymentTerminal(client, {
          chainId,
          projectId,
          token: selected!.token,
        });
        const p = await previewPay(client, {
          chainId,
          terminal: resolved.address,
          projectId,
          token: selected!.token,
          amount: amountRaw,
          beneficiary,
          metadata,
        });
        return {
          ...p,
          terminal: resolved.address,
          routeType: resolved.isRouter ? "swap" : "multi",
        } as const;
      }
      const route = await resolveBestV6PayRoute({
        client,
        chainId,
        projectId,
        token: selected!.token,
        amount: amountRaw,
        beneficiary,
      });
      if (!route) throw new Error("No pay route with a live quote");
      const directSwap = await readPoolSnapshot(chainId, projectId)
        .then(({ pool }) =>
          pool
            ? quoteDirectPaySwap({
                client,
                chainId,
                poolKey: pool.key,
                pairIsCurrency0: pool.pairIsC0,
                paymentToken: selected!.token,
                amount: amountRaw,
                payPreview: route.preview,
              })
            : null,
        )
        .catch(() => null);
      if (directSwap) {
        return {
          beneficiaryTokenCount: directSwap.beneficiaryTokenCount,
          reservedTokenCount: directSwap.reservedTokenCount,
          issuanceTokenCount: route.preview.beneficiaryTokenCount,
          terminal: UNIVERSAL_ROUTER_BY_CHAIN[chainId]!,
          routeType: "swap",
          directSwap,
        } as const;
      }
      return {
        beneficiaryTokenCount: route.preview.beneficiaryTokenCount,
        reservedTokenCount: route.preview.reservedTokenCount,
        terminal: route.address,
        routeType: route.type,
      } as const;
    },
  });

  // A VERIFIED zero preview may submit (zero-issuance pay is legitimate); an
  // unavailable preview blocks — never send blind.
  const previewReady =
    mode === "addbalance" || (!!preview && !previewError && !previewLoading && !previewIsPrevious);
  const routeIsRouter = preview?.routeType === "swap";

  // ---- Wallet balance ----
  // Every accepted token, not only the selected one: whether this wallet can pay AT ALL is what
  // decides the default choice below, and one token's balance cannot answer that.
  const balanceToken = useMemo<Token[]>(
    () =>
      tokens.map((token) => ({
        address: token.token,
        symbol: token.symbol,
        decimals: token.decimals,
        isNative: isNativePayToken(token.token),
      })),
    [tokens],
  );
  const { balances } = useTokenBalances(balanceToken, chainId);
  const buyableLabel = buyableAsset({
    accepted: tokens.map((token) => token.symbol),
    preferred: selected?.symbol,
  });
  const holdsNothing = defaultsToDollars({
    isConnected,
    balances: balanceToken.map((token) => balances.get(token.address) ?? 0n),
  });
  const walletBalance = selected ? (balances.get(selected.token) ?? 0n) : 0n;
  const insufficientBalance =
    isConnected && !!selected && amountRaw > 0n && amountRaw > walletBalance;

  // A wallet with nothing in it cannot pay in any of these tokens, so the menu opens on "$"
  // rather than on a token the payer would have to go and acquire first. Their own choice wins
  // the moment they make one.
  useEffect(() => {
    if (tokenTouched) return;
    setPayWithDollars(holdsNothing);
  }, [holdsNothing, tokenTouched]);

  // Offered from inside the token menu: buying the token is a way of getting
  // one, so it belongs where the token is chosen.
  const { requestSignIn } = useParaAuth();

  const onRamp = useOnRamp({
    symbol: selected?.symbol ?? "",
    chainId,
    needed: amountRaw,
    balance: walletBalance,
    decimals: selected?.decimals,
  });

  // Add-to-balance has no on-chain minimum-output field, so a router swap
  // can't be bounded — refuse it; only direct tokens top up.
  const addBalanceViaRouter = mode === "addbalance" && !!selected?.viaRouter;

  // ---- Confirm + send flow ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedV6Pay | null>(null);
  const [phase, setPhase] = useState<V6PayPhase>("preparing");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [txError, setTxError] = useState<string | null>(null);
  const safeReceipt = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: prepared?.chainId,
  });

  const busy =
    phase === "safe-proposed" ||
    (confirmOpen &&
      (phase === "approving-token" ||
        phase === "approving-router" ||
        phase === "simulating" ||
        phase === "signing" ||
        phase === "pending"));

  const creditOnlyCheckout = mode === "pay" && cartCount > 0 && cartAmountDue === 0n;

  const openConfirm = () => {
    if (phase === "safe-proposed") return;
    if (!selected) return;
    if (amountRaw <= 0n && !creditOnlyCheckout) return;
    if (notStarted || surfaceError || addBalanceViaRouter || insufficientBalance) return;
    if (mode === "pay" && (surface?.pausePay || !previewReady)) return;
    if (cartCount > 0 && (shopRoutesLoading || shopCreditsLoading || !shopMatchesToken)) return;

    setTxError(null);
    setTxHash(undefined);
    setPrepared(null);
    setPhase("preparing");
    setConfirmOpen(true);
  };

  // Preparing runs as an effect so the confirm dialog can open BEFORE a wallet
  // is connected (connect/switch-chain prompts live inside the dialog, old
  // PayDialog style) and re-prepares after an in-dialog connect or chain
  // switch. The card's quote is reused unless it is stale.
  useEffect(() => {
    if (!confirmOpen || phase !== "preparing") return;
    if (!address || !publicClient || !selected) return;
    let cancelled = false;
    const client = publicClient as PublicClient;
    (async () => {
      const cartRows = chainCartItems.map((item) => ({
        tierId: Number(item.tierId),
        quantity: item.quantity,
        name: item.name ?? `Item #${item.tierId}`,
      }));

      let next: PreparedV6Pay;
      if (mode === "pay") {
        if (metadata && selected.viaRouter) {
          throw new Error("Item checkout requires a directly accepted token.");
        }
        // The card's live quote is the quote. Only a stale, missing, or
        // previous-amount quote is refetched here (fail closed either way).
        const quote =
          preview && !previewIsPrevious && !previewError && !previewLoading && !previewIsStale
            ? preview
            : (await refetchPreview()).data;
        if (cancelled) return;
        if (!quote) {
          throw new Error(
            "Couldn't verify what this payment returns — not sending without a live quote.",
          );
        }
        let terminal: Address = quote.terminal;
        let routeType: "multi" | "swap" = quote.routeType;
        const freshPreview = quote;
        const directSwap = "directSwap" in quote ? quote.directSwap : null;

        // The direct swap quote already carries its 1% slippage floor. Terminal
        // payments derive the same floor from their fresh preview.
        const minReturned = directSwap
          ? directSwap.beneficiaryTokenCount
          : minReturnedTokens(freshPreview.beneficiaryTokenCount, 100n);
        const request = directSwap
          ? buildDirectPaySwapTx({
              chainId,
              quote: directSwap,
              amount: amountRaw,
              recipient: address,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 1_800),
            })
          : buildPayTx({
              chainId,
              terminal,
              projectId,
              token: selected.token,
              amount: amountRaw,
              beneficiary: address,
              minReturnedTokens: minReturned,
              memo: memo.trim() || undefined,
              metadata,
            });
        terminal = request.address;
        routeType = directSwap ? "swap" : routeType;
        const abi = directSwap
          ? request.abi
          : routeType === "swap"
            ? jbRouterTerminalRegistryAbi
            : jbMultiTerminalAbi;
        const approvalSpender = directSwap ? PERMIT2_ADDRESS : terminal;
        const router = UNIVERSAL_ROUTER_BY_CHAIN[chainId];
        const permit2State =
          directSwap && router && !isNativePayToken(selected.token)
            ? await client.readContract({
                address: PERMIT2_ADDRESS,
                abi: permit2Abi,
                functionName: "allowance",
                args: [address, selected.token, router],
              })
            : null;
        const permit2Approval =
          !!directSwap &&
          !!router &&
          !isNativePayToken(selected.token) &&
          (!permit2State ||
            permit2State[0] < amountRaw ||
            Number(permit2State[1]) <= Math.floor(Date.now() / 1000) + 1_800);
        const tokenApprovalNeeded = await needsApproval(
          client,
          selected.token,
          address,
          approvalSpender,
          amountRaw,
        );
        const tokenApproval = tokenApprovalNeeded
          ? {
              kind: "token-approval" as const,
              label: `Approve ${selected.symbol} access`,
              request: {
                address: selected.token,
                abi: erc20Abi,
                functionName: "approve",
                args: [approvalSpender, amountRaw] as const,
                value: 0n,
              },
              calldata: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [approvalSpender, amountRaw],
              }),
            }
          : null;
        const now = Math.floor(Date.now() / 1000);
        const walletBytecode = permit2Approval
          ? await client.getBytecode({ address }).catch(() => "0x01" as Hex)
          : undefined;
        const routerAuthorization: Permit2SignatureAuthorization | null =
          permit2Approval && router
            ? {
                chainId,
                token: selected.token,
                spender: router,
                amount: amountRaw,
                expiration: now + 1_800,
                nonce: Number(permit2State?.[2] ?? 0),
                sigDeadline: BigInt(now + 1_800),
              }
            : null;
        const routerSignature =
          routerAuthorization && !walletBytecode
            ? {
                kind: "router-signature" as const,
                label: "Sign the swap authorization",
                authorization: routerAuthorization,
              }
            : null;
        const routerApproval =
          routerAuthorization && !routerSignature
            ? {
                kind: "router-approval" as const,
                label: "Authorize the Uniswap swap router",
                request: {
                  address: PERMIT2_ADDRESS,
                  abi: permit2Abi,
                  functionName: "approve",
                  args: [
                    selected.token,
                    routerAuthorization.spender,
                    amountRaw,
                    now + 30 * 24 * 60 * 60,
                  ] as const,
                  value: 0n,
                },
                calldata: encodeFunctionData({
                  abi: permit2Abi,
                  functionName: "approve",
                  args: [
                    selected.token,
                    routerAuthorization.spender,
                    amountRaw,
                    now + 30 * 24 * 60 * 60,
                  ],
                }),
              }
            : null;
        next = {
          mode,
          chainId,
          token: selected,
          amount: amountRaw,
          memo: memo.trim(),
          terminal,
          viaRouterRoute: routeType === "swap",
          directSwapRoute: !!directSwap,
          swapInputRoute: directSwap?.inputRoute ?? null,
          expectedTokens: directSwap
            ? directSwap.beneficiaryTokenCount
            : freshPreview.beneficiaryTokenCount,
          reservedTokens: directSwap ? 0n : freshPreview.reservedTokenCount,
          minReturned,
          needsApproval: tokenApprovalNeeded,
          needsPermit2Approval: permit2Approval,
          tokenApprovalComplete: false,
          routerAuthorizationComplete: false,
          tokenApproval,
          routerApproval,
          routerSignature,
          cartRows,
          request: {
            address: request.address,
            abi,
            functionName: request.functionName,
            args: request.args,
            value: request.value,
          },
          calldata: encodeFunctionData({
            abi,
            functionName: request.functionName,
            args: request.args,
          }),
        };
      } else {
        if (selected.viaRouter) {
          throw new Error("Add to balance only supports tokens the project accepts directly.");
        }
        const terminal = jbContractAddress[6][JBCoreContracts.JBMultiTerminal][chainId];
        const args = [projectId, selected.token, amountRaw, false, memo.trim(), "0x"] as const;
        const value = isNativePayToken(selected.token) ? amountRaw : 0n;
        const tokenApprovalNeeded = await needsApproval(
          client,
          selected.token,
          address,
          terminal,
          amountRaw,
        );
        next = {
          mode,
          chainId,
          token: selected,
          amount: amountRaw,
          memo: memo.trim(),
          terminal,
          viaRouterRoute: false,
          directSwapRoute: false,
          swapInputRoute: null,
          expectedTokens: null,
          reservedTokens: null,
          minReturned: 0n,
          needsApproval: tokenApprovalNeeded,
          needsPermit2Approval: false,
          tokenApprovalComplete: false,
          routerAuthorizationComplete: false,
          tokenApproval: tokenApprovalNeeded
            ? {
                kind: "token-approval",
                label: `Approve ${selected.symbol} access`,
                request: {
                  address: selected.token,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [terminal, amountRaw],
                  value: 0n,
                },
                calldata: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [terminal, amountRaw],
                }),
              }
            : null,
          routerApproval: null,
          routerSignature: null,
          cartRows: [],
          request: {
            address: terminal,
            abi: jbMultiTerminalAbi,
            functionName: "addToBalanceOf",
            args,
            value,
          },
          calldata: encodeFunctionData({
            abi: jbMultiTerminalAbi,
            functionName: "addToBalanceOf",
            args,
          }),
        };
      }
      if (cancelled) return;
      setPrepared(next);
      setPhase("ready");
    })().catch((err) => {
      if (cancelled) return;
      setPhase("ready");
      setTxError(formatWalletError(err, "Couldn't prepare the transaction. Please try again."));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, phase, address, publicClient, chainId, selected, amountRaw, metadata, mode]);

  const confirm = async () => {
    if (!publicClient || !address) return;
    if (!prepared) {
      // Preparing failed — retry with a fresh quote.
      setTxError(null);
      setPhase("preparing");
      return;
    }
    setTxError(null);
    try {
      // Keep the newest prerequisite block. Base RPC providers are load
      // balanced: a receipt can be visible on one backend while `latest` on a
      // sibling still predates that approval, producing a false
      // Permit2.AllowanceExpired during the immediate swap simulation.
      let approvalBlock: bigint | undefined;
      let paymentRequest = prepared.request;
      if (prepared.tokenApproval && !prepared.tokenApprovalComplete) {
        // Direct ERC-20 swaps approve canonical Permit2; terminal routes approve
        // the resolved terminal.
        setPhase("approving-token");
        await nextUiPaint();
        const approvalHash = await ensureAllowance(
          prepared.token.token,
          prepared.directSwapRoute ? PERMIT2_ADDRESS : prepared.request.address,
          prepared.amount,
        );
        const approvalReceipt = getApprovalReceipt(approvalHash);
        if (approvalReceipt?.blockNumber !== undefined) {
          approvalBlock = approvalReceipt.blockNumber;
        }
        setPrepared((current) => (current ? { ...current, tokenApprovalComplete: true } : current));
      }
      let routerApproval = prepared.routerApproval;
      if (
        prepared.routerSignature &&
        !prepared.routerAuthorizationComplete &&
        !isNativePayToken(prepared.token.token)
      ) {
        setPhase("approving-router");
        await nextUiPaint();
        try {
          const signature = await signPermit2Async({
            expectedAccount: address,
            authorization: prepared.routerSignature.authorization,
          });
          const signedRequest = addPermit2SignatureToDirectPaySwap(
            prepared.request as ReturnType<typeof buildDirectPaySwapTx>,
            prepared.routerSignature.authorization,
            signature,
          );
          paymentRequest = {
            address: signedRequest.address,
            abi: signedRequest.abi,
            functionName: signedRequest.functionName,
            args: signedRequest.args,
            value: signedRequest.value,
          };
          setPrepared((current) =>
            current
              ? {
                  ...current,
                  routerAuthorizationComplete: true,
                  request: paymentRequest,
                  calldata: encodeFunctionData({
                    abi: paymentRequest.abi,
                    functionName: paymentRequest.functionName,
                    args: paymentRequest.args,
                  }),
                }
              : current,
          );
        } catch (reason) {
          if (!permit2SignatureNeedsOnchainFallback(reason)) throw reason;
          const authorization = prepared.routerSignature.authorization;
          const expiration = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
          routerApproval = {
            kind: "router-approval",
            label: "Authorize the Uniswap swap router",
            request: {
              address: PERMIT2_ADDRESS,
              abi: permit2Abi,
              functionName: "approve",
              args: [authorization.token, authorization.spender, authorization.amount, expiration],
              value: 0n,
            },
            calldata: encodeFunctionData({
              abi: permit2Abi,
              functionName: "approve",
              args: [authorization.token, authorization.spender, authorization.amount, expiration],
            }),
          } satisfies PreparedV6TransactionAction;
          setPrepared((current) =>
            current
              ? {
                  ...current,
                  tokenApprovalComplete: true,
                  routerAuthorizationComplete: false,
                  routerSignature: null,
                  routerApproval,
                }
              : current,
          );
          setPhase("ready");
          setTxError(
            "This wallet cannot sign Permit2 authorizations. Review the onchain fallback, then confirm again.",
          );
          await nextUiPaint();
          return;
        }
      }
      if (
        routerApproval &&
        !prepared.routerAuthorizationComplete &&
        !isNativePayToken(prepared.token.token)
      ) {
        const router = routerApproval.request.args[1] as Address;
        setPhase("approving-router");
        await nextUiPaint();
        const approvalHash = await writeContractAsync({
          chainId: prepared.chainId,
          ...routerApproval.request,
        });
        requireOnchainExecution(approvalHash, "Swap authorization");
        const approvalReceipt = await waitForReceiptWithRetry(
          publicClient as PublicClient,
          approvalHash,
        );
        if (approvalReceipt.status !== "success") {
          throw new Error(`Swap authorization ${approvalHash} reverted onchain.`);
        }
        const [approvedAmount, approvedExpiration] = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: permit2Abi,
          functionName: "allowance",
          args: [address, prepared.token.token, router],
          blockNumber: approvalReceipt.blockNumber,
        });
        if (
          approvedAmount < prepared.amount ||
          approvedExpiration <= BigInt(Math.floor(Date.now() / 1000) + 1_800)
        ) {
          throw new Error("Swap authorization confirmed but did not grant the reviewed amount.");
        }
        if (approvalBlock === undefined || approvalReceipt.blockNumber > approvalBlock) {
          approvalBlock = approvalReceipt.blockNumber;
        }
        setPrepared((current) =>
          current
            ? {
                ...current,
                routerAuthorizationComplete: true,
              }
            : current,
        );
      }
      setPhase("simulating");
      await nextUiPaint();
      await publicClient.simulateContract({
        address: paymentRequest.address,
        abi: paymentRequest.abi,
        functionName: paymentRequest.functionName,
        args: paymentRequest.args as unknown[],
        value: paymentRequest.value,
        account: address,
        blockNumber: approvalBlock,
      } as unknown as Parameters<typeof publicClient.simulateContract>[0]);
      setPhase("signing");
      const hash = await writeContractAsync({
        chainId: prepared.chainId,
        address: paymentRequest.address,
        abi: paymentRequest.abi,
        functionName: paymentRequest.functionName,
        args: paymentRequest.args as unknown[],
        value: paymentRequest.value,
      } as unknown as Parameters<typeof writeContractAsync>[0]);
      setTxHash(hash);
      setPhase("pending");
      if (submittedViaSafe(hash)) {
        setPhase("safe-proposed");
        return;
      }
      requireOnchainExecution(hash, prepared.mode === "pay" ? "Payment" : "Balance addition");
      const receipt = await waitForReceiptWithRetry(publicClient as PublicClient, hash);
      if (receipt.status !== "success") {
        throw new Error(`Transaction ${hash} reverted onchain.`);
      }
      setPhase("success");
    } catch (err) {
      if (isSafeProposalPendingError(err)) {
        setPhase("safe-proposed");
        setTxHash(err.hash);
        return;
      }
      if (isTransactionReceiptUnavailableError(err)) {
        setPhase("pending");
        setTxHash(err.hash);
        setTxError(err.message);
        return;
      }
      setPhase("ready");
      const message = formatWalletError(err);
      setTxError(message);
    }
  };

  const resetAfterSuccess = () => {
    setConfirmOpen(false);
    setPrepared(null);
    setPhase("preparing");
    setTxHash(undefined);
    setTxError(null);
    setAmount("");
    setDebouncedAmount("");
    setMemo("");
    for (const item of chainCartItems) cart.remove(item.tierId, item.chainId);
  };

  useEffect(() => {
    if (phase !== "safe-proposed") return;
    if (safeReceipt.isSuccess) {
      setPhase("success");
      setTxError(null);
      setAmount("");
      setDebouncedAmount("");
      setMemo("");
      for (const item of chainCartItems) cart.remove(item.tierId, item.chainId);
    } else if (safeReceipt.isError) {
      setPhase("ready");
      setTxError(
        safeReceipt.error instanceof Error
          ? safeReceipt.error.message
          : "The Safe proposal executed but failed onchain.",
      );
    }
  }, [
    cart,
    chainCartItems,
    phase,
    prepared?.mode,
    safeReceipt.error,
    safeReceipt.isError,
    safeReceipt.isSuccess,
  ]);

  // Chain switching lives in the confirm dialog (old PayDialog style). The
  // token selection re-maps to the same token on the new chain via the
  // key-remap effect; an open confirm re-prepares from a fresh quote.
  const switchChain = (value: string) => {
    if (busy) return;
    const next = chainOptions.find((s) => Number(s.peerChainId) === Number(value));
    if (!next) return;
    setSelectedSucker(next);
    if (confirmOpen) {
      setPrepared(null);
      setTxError(null);
      setTxHash(undefined);
      setPhase("preparing");
    }
  };

  // Signed out, this button signs in, so the checks that describe a payment
  // do not apply to it yet — gating on them would leave a disabled button
  // with nothing explaining why.
  const payDisabled =
    busy ||
    notStarted ||
    surfaceError ||
    // Paying in dollars is a purchase, not a send: it needs an amount and nothing else. The
    // checks below are about a token this payer does not hold yet.
    (isConnected && payWithDollars && amountRaw <= 0n) ||
    (isConnected &&
      !payWithDollars &&
      (!selected ||
        addBalanceViaRouter ||
        insufficientBalance ||
        (surface?.pausePay === true && mode === "pay") ||
        (cartCount > 0 && (shopRoutesLoading || shopCreditsLoading || !shopMatchesToken)) ||
        (amountRaw <= 0n && !creditOnlyCheckout) ||
        (mode === "pay" && !previewReady)));

  const hasShopStrip = Boolean(shop && shop.tiers.length > 0 && mode === "pay");
  const payPanelLayout = payPanelLayoutClasses({
    mode,
    shopTierCount: shop?.tiers.length,
  });
  const showPayReceipt =
    mode === "pay" &&
    (cartCount > 0 ||
      (amountRaw > 0n &&
        !previewError &&
        (previewLoading || (!!preview && preview.beneficiaryTokenCount > 0n))));

  return (
    <div>
      <div className="w-full">
        <div className="relative w-full border border-b-0 border-melon-600">
          {/* 721 shop strip — same gray as the pay block, flush inside the outline. */}
          {hasShopStrip ? (
            <div className="w-full bg-zinc-100 px-4 pt-3">
              <V6PayShopStrip
                shop={shop!}
                chainId={chainId}
                pricingSymbol={shopPricingSymbol}
                busy={busy}
              />
              {cartCount > 0 && shopRoutesLoading ? (
                <div
                  className="mb-2 flex items-center gap-2"
                  role="status"
                  aria-label="Loading checkout currencies"
                >
                  <Skeleton className="h-3 w-36" />
                </div>
              ) : cartCount > 0 && supportedShopTokenIndexes.length === 0 ? (
                <p className="mb-2 text-xs text-red-600">
                  {shopRouteCheckFailed
                    ? "Couldn't check which payment tokens have a price feed for these items. Try again in a moment."
                    : "No directly accepted payment token has a verified price feed for these items."}
                </p>
              ) : cartCount > 0 && !shopMatchesToken ? (
                <p className="mb-2 text-xs text-zinc-500">
                  Switching to a supported checkout currency…
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-center items-center flex-col">
            {/* Pay block: mode dropdown in the label spot, big amount input, token selector at right */}
            <div
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] content-center bg-zinc-100 px-4 ${payPanelLayout} ${
                showPayReceipt ? "border-b border-melon-200" : ""
              }`}
            >
              <div className="col-start-1 row-start-1 flex items-center gap-1.5 self-start whitespace-nowrap">
                <TextSelect
                  value={mode}
                  onChange={(v) => setMode(v as V6PayMode)}
                  disabled={busy}
                  ariaLabel="Payment mode"
                  className="relative inline-flex items-center gap-1"
                  labelClassName="text-md text-black-700"
                  options={[
                    { value: "pay", label: "Pay" },
                    {
                      value: "addbalance",
                      label: "Add to balance",
                      selectedLabel: "Add",
                    },
                  ]}
                />
                <span className="text-md text-zinc-500">on</span>
                {chainOptions.length > 1 ? (
                  <TextSelect
                    value={String(chainId)}
                    onChange={switchChain}
                    disabled={busy}
                    ariaLabel="Chain"
                    className="relative inline-flex shrink-0 items-center gap-1"
                    labelClassName="text-md text-black-700"
                    options={chainOptions.map((option) => ({
                      value: String(option.peerChainId),
                      label: payChainName(option.peerChainId),
                    }))}
                  />
                ) : (
                  <span className="shrink-0 whitespace-nowrap text-md text-black-700">
                    {payChainName(chainId)}
                  </span>
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                // Dollars are shown with their sign and stored without it: everything
                // downstream — the preview, the amount sent to the provider — parses a number.
                value={payWithDollars && amount ? `$${amount}` : amount}
                onChange={(e) => setAmount(e.target.value.replace(/^\$/, ""))}
                disabled={busy}
                placeholder={payWithDollars ? "$0.00" : "0.00"}
                aria-label="Amount"
                className="col-start-1 row-start-2 min-h-11 border-0 bg-transparent pl-0 pr-3 pt-1 pb-0 text-zinc-900 text-2xl w-full placeholder:text-zinc-400 focus:ring-0 focus:outline-none sm:leading-6 disabled:opacity-60"
              />
              {tokens.length > 1 || onRamp.supported ? (
                // Valued by INDEX, not address — a token can appear direct and
                // via-router, so the option stays in lock-step with the selection.
                <TextSelect
                  value={
                    payWithDollars ? BUY_OPTION : String(Math.min(tokenIndex, tokens.length - 1))
                  }
                  onChange={(value) => {
                    setTokenTouched(true);
                    if (value === BUY_OPTION) {
                      // Selecting dollars buys nothing yet. The payer types what they want to
                      // spend first, and Pay explains the swap they are about to make.
                      setPayWithDollars(true);
                      return;
                    }
                    setPayWithDollars(false);
                    const i = Number(value);
                    setTokenIndex(i);
                    const picked = tokens[i];
                    if (picked) selectedKeyRef.current = payTokenKey(picked);
                    setTokenTouched(true);
                  }}
                  disabled={busy}
                  ariaLabel="Payment token"
                  className="relative col-start-2 row-start-2 inline-flex shrink-0 justify-self-end self-center items-center gap-1"
                  labelClassName="text-right select-none text-lg text-zinc-900"
                  options={[
                    ...tokens.map((t, i) => ({
                      value: String(i),
                      label: t.symbol,
                      disabled: cartCount > 0 && !shopRoutes?.[payTokenKey(t)]?.supported,
                    })),
                    // Names both rails without promising to pick one: Para's
                    // on-ramp takes no payment method, so the provider's own
                    // window asks. Saying both is still worth it — bank
                    // transfers authorise far more often than cards, and
                    // nobody reaches for one they did not know was offered.
                    // Names both rails without promising to pick one: Para's on-ramp takes no
                    // payment method, so the provider's own window asks. Saying both is still
                    // worth it — bank transfers authorise far more often than cards, and
                    // nobody reaches for one they did not know was offered.
                    ...(onRamp.supported ? [{ value: BUY_OPTION, label: "Card or bank" }] : []),
                  ]}
                />
              ) : (
                <span className="col-start-2 row-start-2 justify-self-end self-center text-right select-none text-lg">
                  {selected?.symbol ?? nativeSymbol}
                </span>
              )}
              {/* Sits under the token it describes. Already computed for the
                  insufficient-funds notice; showing it is what makes that
                  notice predictable rather than a surprise at submit time.

                  Not while paying by card: that is a balance in a token this payer is not
                  spending, on a row that is about to buy some. */}
              {selected && isConnected && !payWithDollars ? (
                <div className="col-start-2 row-start-3 -mt-0.5 flex flex-col items-end justify-self-end pb-1.5 pr-[18px]">
                  <span className="whitespace-nowrap text-xs text-zinc-600">
                    Balance: {formatPayAmount(walletBalance, selected.decimals)}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Receipt — hidden while idle; item checkouts expand into a detailed cart. */}
            {showPayReceipt ? (
              <div className="w-full border-b border-zinc-200 bg-zinc-100 px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-zinc-500">
                    {routeIsRouter ? "You get at least" : "You get"}
                  </p>
                  {preview && !previewLoading && !previewIsPrevious ? (
                    <button
                      type="button"
                      onClick={() => setShowRouteComparison((current) => !current)}
                      aria-expanded={showRouteComparison}
                      title={
                        routeIsRouter
                          ? "Compare the selected swap with project issuance."
                          : "This payment issues tokens from the project."
                      }
                      className="shrink-0 border border-melon-500 bg-white px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-700 hover:bg-melon-50"
                    >
                      {paySettlementLabel(preview.routeType)}
                    </button>
                  ) : null}
                </div>
                {preview && preview.beneficiaryTokenCount > 0n ? (
                  <p
                    aria-live="polite"
                    aria-busy={previewLoading}
                    className={`text-xl font-semibold transition-colors ${
                      previewLoading || previewIsPrevious ? "text-zinc-400" : "text-zinc-900"
                    }`}
                  >
                    {formatPayAmount(preview.beneficiaryTokenCount, 18)} {projectTokenLabel}
                  </p>
                ) : amountRaw > 0n && previewLoading ? (
                  <Skeleton
                    className="mt-1 h-5 w-24"
                    role="status"
                    aria-label="Calculating token return"
                  />
                ) : null}

                {showRouteComparison && preview?.routeType === "swap" ? (
                  "issuanceTokenCount" in preview ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-zinc-200 pt-2 text-xs">
                      <div>
                        <p className="text-zinc-500">Swap</p>
                        <p className="font-medium text-zinc-900">
                          {formatPayAmount(preview.beneficiaryTokenCount, 18)} {projectTokenLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Issuance</p>
                        <p className="font-medium text-zinc-900">
                          {formatPayAmount(preview.issuanceTokenCount ?? 0n, 18)}{" "}
                          {projectTokenLabel}
                        </p>
                      </div>
                      <p className="col-span-2 text-zinc-500">
                        The better guaranteed return is selected automatically.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 border-t border-zinc-200 pt-2 text-xs text-zinc-500">
                      This payment settles through the project&apos;s configured swap route.
                    </p>
                  )
                ) : null}

                {cartCount > 0 && shop ? (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 text-sm">
                    <div className="space-y-3">
                      {chainCartItems.map((item) => {
                        const tier = shop.tiers.find(
                          (candidate) => candidate.id === Number(item.tierId),
                        );
                        const canIncrement =
                          !tier || tier.unlimited || item.quantity < tier.remaining;
                        const itemName = item.name ?? `Item #${item.tierId}`;

                        return (
                          <div key={item.tierId.toString()} className="flex items-center gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-zinc-200 bg-zinc-100 text-xs text-zinc-500">
                              <ImageWithFallback
                                src={item.imageUri}
                                alt=""
                                className="h-full w-full object-contain"
                                fallback={<span>#{item.tierId.toString()}</span>}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-zinc-900">{itemName}</p>
                              <p className="text-xs tabular-nums text-zinc-500">
                                {formatPayAmount(item.price, shop.pricingDecimals)}{" "}
                                {shopPricingSymbol}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  cart.setQuantity(item.tierId, item.chainId, item.quantity - 1)
                                }
                                disabled={busy}
                                aria-label={`Remove one ${itemName}`}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-zinc-700 transition-colors hover:border-teal-500 hover:text-teal-700 disabled:opacity-40"
                              >
                                −
                              </button>
                              <span className="min-w-4 text-center tabular-nums">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  cart.setQuantity(item.tierId, item.chainId, item.quantity + 1)
                                }
                                disabled={busy || !canIncrement}
                                aria-label={`Add one ${itemName}`}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-zinc-700 transition-colors hover:border-teal-500 hover:text-teal-700 disabled:opacity-40"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 space-y-1.5 border-t border-zinc-200 pt-3">
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-600">
                          {cartCount} item{cartCount === 1 ? "" : "s"}
                        </span>
                        <span className="tabular-nums text-zinc-900">
                          {formatPayAmount(cartTotal, shop.pricingDecimals)} {shopPricingSymbol}
                        </span>
                      </div>
                      {!shopCreditsLoading && shopCreditApplied > 0n ? (
                        <div className="flex justify-between gap-3 text-teal-700">
                          <span>Shop credit applied</span>
                          <span className="tabular-nums">
                            −{formatPayAmount(shopCreditApplied, shop.pricingDecimals)}{" "}
                            {shopPricingSymbol}
                          </span>
                        </div>
                      ) : !shopCreditsLoading && shopCredits > 0n ? (
                        <div className="flex justify-between gap-3 text-zinc-500">
                          <span>Shop credit available</span>
                          <span className="tabular-nums">
                            {formatPayAmount(shopCredits, shop.pricingDecimals)} {shopPricingSymbol}
                          </span>
                        </div>
                      ) : null}
                      {!shopCreditsLoading && shopCredits > 0n && restrictedCartTotal > 0n ? (
                        <div className="flex justify-between gap-3 text-zinc-500">
                          <span>
                            {restrictedCartTotal === cartTotal
                              ? "These items require fresh payment"
                              : "Some items require fresh payment"}
                          </span>
                          <span className="tabular-nums">
                            {formatPayAmount(restrictedCartTotal, shop.pricingDecimals)}{" "}
                            {shopPricingSymbol}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-3 pt-0.5 font-semibold text-zinc-900">
                        <span>Amount due</span>
                        <span className="tabular-nums">
                          {formatPayAmount(cartAmountDue, shop.pricingDecimals)} {shopPricingSymbol}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                {preview && preview.reservedTokenCount > 0n ? (
                  <p className="mt-1.5 text-xs font-medium text-zinc-500">
                    Splits get {formatPayAmount(preview.reservedTokenCount, 18)} {projectTokenLabel}
                  </p>
                ) : null}
              </div>
            ) : mode === "addbalance" ? (
              <p className="w-full border-b border-zinc-200 bg-zinc-100 px-4 py-2 text-xs text-zinc-600">
                Adds to the project balance — you get no {projectTokenLabel}.
              </p>
            ) : null}

            {mode === "pay" && previewError && (amountRaw > 0n || cartCount > 0) ? (
              <p className="w-full border-b border-zinc-200 bg-zinc-100 px-4 py-2 text-xs text-red-600">
                Couldn&apos;t verify what this payment returns — paying is disabled until the
                preview works.
              </p>
            ) : null}

            {notStarted ? (
              <p className="w-full border-b border-zinc-200 bg-zinc-100 px-4 py-2 text-xs text-zinc-500">
                Starts in {formatStartCountdown(startsAt - now)}.
              </p>
            ) : null}
          </div>
        </div>

        {/* Memo + Pay — compact by default; the button keeps its height if the memo is resized. */}
        <div className="relative flex w-full flex-row items-start">
          <div className="relative min-w-0 flex-1">
            <textarea
              rows={1}
              value={memo}
              onChange={(e) => setMemo(e.target.value.slice(0, 256))}
              disabled={busy}
              placeholder="Add a note"
              className="flex min-h-14 w-full border border-melon-600 bg-white px-3 py-1.5 text-md ring-offset-white placeholder:text-zinc-500 focus:border-melon-600 focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="relative flex h-14 w-[150px] shrink-0 items-start border-y border-r border-melon-600">
            <Button
              disabled={payDisabled}
              loading={busy}
              onClick={
                {
                  signIn: requestSignIn,
                  buyFirst: () => setBuyExplainerOpen(true),
                  confirm: openConfirm,
                }[payButtonAction({ isConnected, payWithDollars })]
              }
              className="h-14 w-full bg-teal-500 text-melon-950 hover:bg-teal-600"
            >
              {notStarted ? "Soon" : !isConnected ? "Sign in" : mode === "pay" ? "Pay" : "Add"}
            </Button>
          </div>
        </div>
      </div>

      {/* Notices */}
      {/* Not while paying by card: the shortfall is in a token this payer is not spending, and
          buying it is the very thing the button now offers. */}
      {insufficientBalance && selected && !payWithDollars ? (
        <p className="mt-2 text-xs text-red-600">
          You don&apos;t have enough {selected.symbol} on {JB_CHAINS[chainId]?.name}.
        </p>
      ) : null}
      {surfaceError ? (
        <p className="mt-2 text-sm text-red-600">
          Couldn&apos;t verify this project&apos;s accepted tokens — payments are disabled.
        </p>
      ) : null}
      {surface?.pausePay && mode === "pay" ? (
        <p className="mt-2 text-sm text-zinc-600">Payments are paused under the current rules.</p>
      ) : null}
      {addBalanceViaRouter ? (
        <p className="mt-2 text-sm text-zinc-600">
          Add to balance only supports tokens the project accepts directly — switch to a direct
          token, or use Pay to route this one.
        </p>
      ) : null}

      {/* What "$" costs, said where it is spent. A payer who picked dollars is one step from a
          purchase they did not ask for, so the swap is named before it starts rather than
          explained by the provider's window appearing. */}
      <Dialog open={buyExplainerOpen} onOpenChange={setBuyExplainerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>First, buy {buyableLabel}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-zinc-600">
            {/* One string, not JSX text around an expression: a line break after `{asset}`
                swallows the space that follows it, which is how this shipped as "USDCin". */}
            {`Payments to this project take ${buyableLabel} in order to settle instantly, stick to automated rules, and send out incentives on schedule. You'll use your card or bank to buy some first, then come back here to pay.`}
          </p>
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setBuyExplainerOpen(false);
                // A window, not the frame this once used. Para's portal frames fine, but the
                // provider it nests inside itself does not: buy.moonpay.com answers a framed
                // request with "refused to connect", because MoonPay only permits embedding
                // from origins registered against the merchant key — and that key is Para's.
                //
                // Everything needed to embed it is still here and tested (`display: "embed"`,
                // `recordOnRampPurchase`). Ask Para to allowlist this origin on their MoonPay
                // key and this call is one argument from being a frame again.
                onRamp.buy({ fiatQuantity: amount.trim() || undefined });
              }}
            >
              Buy {buyableLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <V6PayConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        prepared={prepared}
        phase={phase}
        mode={mode}
        error={txError}
        projectTokenSymbol={projectTokenLabel}
        txHash={txHash}
        onConfirm={confirm}
        onSwitchChain={switchChain}
        onDone={resetAfterSuccess}
      />
    </div>
  );
}

async function needsApproval(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
): Promise<boolean> {
  if (isNativePayToken(token) || amount === 0n) return false;
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  return allowance < amount;
}

function nextUiPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}
