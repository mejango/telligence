"use client";

import { USDC_DECIMALS } from "@/app/constants";
import { GetFunds } from "@/components/GetFunds";
import { ViewAsDialog } from "@/components/ViewAsDialog";
import { useEnsName } from "@/hooks/ens/useEnsName";
import { IS_DETERMINISTIC_BROWSER } from "@/lib/browserEnvironment";
import { useJBProject, useJBTokenContext } from "@/lib/nana/project";
import { useSuckers, useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import { cn, formatEthAddress, formatTokenSymbol } from "@/lib/utils";
import { useViewAs } from "@/lib/view-as";
import {
  logoutParaSession,
  ParaLocalDisconnectError,
  ParaSessionLogoutError,
} from "@/providers/para-logout";
import { useParaAuth } from "@/providers/ParaAuthContext";
import { preloadParaHost } from "@/providers/preload-para";
import { JBProjectToken, USDC_ADDRESSES, type JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { getConnections } from "@wagmi/core";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useConfig, useDisconnect, useReadContract } from "wagmi";
import { getBalance, readContract } from "wagmi/actions";
import { Button, type ButtonProps } from "./ui/button";

type WalletConnectButtonProps = Omit<ButtonProps, "children"> & {
  label?: string;
  menuAlign?: "left" | "right";
};

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

function formattedWalletBalance(value: bigint, decimals: number, symbol: string) {
  return `${Number(formatUnits(value, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} ${symbol}`;
}

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="whitespace-nowrap font-medium text-zinc-950">{value}</dd>
    </div>
  );
}

function ProjectWalletBalance() {
  const { data: balances, isLoading } = useSuckersUserTokenBalance();
  const { token } = useJBTokenContext();
  const total = new JBProjectToken(
    balances?.reduce((sum, balance) => sum + balance.balance.value, 0n) ?? 0n,
  );
  const symbol = formatTokenSymbol(token) || "tokens";

  return (
    <BalanceRow
      label={symbol}
      value={isLoading || token.isLoading ? "Loading…" : `${total.format(4)} ${symbol}`}
    />
  );
}

function ProjectWalletBalances({ address }: { address: `0x${string}` }) {
  const config = useConfig();
  const suckers = useSuckers();
  const pairs = suckers.data ?? [];
  const pairKey = pairs.map((pair) => `${pair.peerChainId}:${pair.projectId}`).join(",");
  const balances = useQuery({
    queryKey: ["revnet", "walletAssetBalances", address, pairKey],
    enabled: !!pairKey && !suckers.isLoading,
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await Promise.all(
        pairs.map(async ({ peerChainId: chainId }) => {
          const usdc = USDC_ADDRESSES[chainId];
          const [nativeBalance, usdcBalance] = await Promise.all([
            getBalance(config, { address, chainId }),
            usdc
              ? readContract(config, {
                  abi: erc20Abi,
                  address: usdc,
                  chainId,
                  functionName: "balanceOf",
                  args: [address],
                })
              : Promise.resolve(0n),
          ]);
          return { nativeBalance, usdcBalance };
        }),
      );

      return {
        native: rows.reduce((total, row) => total + row.nativeBalance.value, 0n),
        nativeSymbol: rows[0]?.nativeBalance.symbol ?? "ETH",
        usdc: rows.reduce((total, row) => total + row.usdcBalance, 0n),
      };
    },
  });
  const isLoading = suckers.isLoading || balances.isLoading;

  return (
    <>
      <div className="mb-1.5">
        {pairs.length ? `Across ${pairs.length} project chains` : "Across project chains"}
      </div>
      <dl className="space-y-1">
        <BalanceRow
          label={balances.data?.nativeSymbol ?? "ETH"}
          value={
            isLoading
              ? "Loading…"
              : balances.data
                ? formattedWalletBalance(balances.data.native, 18, balances.data.nativeSymbol)
                : "Unavailable"
          }
        />
        <BalanceRow
          label="USDC"
          value={
            isLoading
              ? "Loading…"
              : balances.data
                ? formattedWalletBalance(balances.data.usdc, USDC_DECIMALS, "USDC")
                : "Unavailable"
          }
        />
        <ProjectWalletBalance />
      </dl>
    </>
  );
}

function menuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
}

function useDismissableMenu(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    const item = initialFocusRef.current === "last" ? items.at(-1) : items[0];
    (item ?? menuRef.current)?.focus();
  }, [open]);

  const openMenu = (initialFocus: "first" | "last" = "first") => {
    initialFocusRef.current = initialFocus;
    setOpen(true);
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openMenu(event.key === "ArrowUp" ? "last" : "first");
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex =
          currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return { containerRef, menuRef, onMenuKeyDown, onTriggerKeyDown, openMenu, triggerRef };
}

export function WalletConnectButton({
  label = "Sign in",
  menuAlign = "left",
  className,
  variant = "default",
  ...props
}: WalletConnectButtonProps) {
  const { requestSignIn } = useParaAuth();
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [open, setOpen] = useState(false);
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const menu = useDismissableMenu(open, setOpen);

  return (
    // The sign-in sheet now carries every way in — email, phone, socials,
    // wallets — so a menu in front of it would only ask which door to use
    // twice. Impersonation is the one thing left that needs its own control.
    <div className="inline-flex items-center gap-3">
      <Button
        ref={menu.triggerRef}
        {...props}
        disabled={!interactive || props.disabled}
        type={props.type ?? "button"}
        variant={variant}
        className={className}
        // Fetch Para's runtime as the pointer arrives, so the click has
        // nothing left to wait for.
        onMouseEnter={preloadParaHost}
        onFocus={preloadParaHost}
        onTouchStart={preloadParaHost}
        onClick={(event) => {
          props.onClick?.(event);
          if (event.defaultPrevented) return;
          requestSignIn();
        }}
      >
        {label}
      </Button>
      {viewAsOpen ? <ViewAsDialog open={viewAsOpen} onOpenChange={setViewAsOpen} /> : null}
    </div>
  );
}

export function WalletButton() {
  const { address, chain, isConnected } = useAccount();
  const config = useConfig();
  const { viewAs, clearViewAs } = useViewAs();
  const balanceAddress = viewAs ?? address;
  const { data: balance } = useBalance({ address: balanceAddress });
  const usdcAddress = chain?.id ? USDC_ADDRESSES[chain.id as JBChainId] : undefined;
  const { data: usdcBalance } = useReadContract({
    abi: erc20Abi,
    address: usdcAddress,
    chainId: chain?.id,
    functionName: "balanceOf",
    args: balanceAddress ? [balanceAddress] : undefined,
    query: { enabled: !!balanceAddress && !!usdcAddress },
  });
  const project = useJBProject();
  const { disconnectAsync, isPending } = useDisconnect();

  /**
   * End the session, whatever is holding it.
   *
   * Two things can outlive a click on Disconnect. Para's session is authoritative and survives
   * Wagmi entirely, so it is asked first — and asked whenever one EXISTS, not when the active
   * connector happens to be named "para": an email sign-in whose connector reads as anything
   * else took the plain path, failed, and left the account signed in with nothing but "the
   * wallet could not disconnect" to show for it.
   *
   * Wagmi's own disconnect can then refuse — a connector it holds but is no longer connected
   * to. Asking each live connection to go instead is what actually clears that.
   */
  const endSession = useCallback(async () => {
    if (!IS_DETERMINISTIC_BROWSER) {
      const { getParaClient } = await import("@/providers/para-config");
      const hasParaSession = await getParaClient()
        .isFullyLoggedIn()
        .catch(() => false);
      if (hasParaSession) {
        await logoutParaSession({ disconnect: disconnectAsync });
        return;
      }
    }
    try {
      await disconnectAsync();
    } catch (error) {
      const live = getConnections(config);
      if (live.length === 0) throw error;
      for (const connection of live) {
        await disconnectAsync({ connector: connection.connector });
      }
    }
  }, [disconnectAsync, config]);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string>();
  const [paraLogoutPending, setParaLogoutPending] = useState(false);
  const menuId = useId();
  const menu = useDismissableMenu(open, setOpen);
  const { data: ensName } = useEnsName(viewAs ?? address);
  const [viewAsOpen, setViewAsOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  const viewAsDialog = viewAsOpen ? (
    <ViewAsDialog open={viewAsOpen} onOpenChange={setViewAsOpen} />
  ) : null;
  const formattedBalance = balance
    ? formattedWalletBalance(balance.value, balance.decimals, balance.symbol)
    : null;
  const formattedUsdcBalance =
    usdcBalance !== undefined
      ? formattedWalletBalance(usdcBalance, USDC_DECIMALS, "USDC")
      : usdcAddress
        ? "Loading…"
        : "Unavailable";

  if (mounted && viewAs) {
    return (
      <div
        className="relative inline-flex"
        ref={menu.containerRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <Button
          ref={menu.triggerRef}
          type="button"
          variant="outline"
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={open}
          onKeyDown={menu.onTriggerKeyDown}
          onClick={() => {
            if (open) setOpen(false);
            else menu.openMenu();
          }}
          className="min-w-0 justify-start gap-2 border-amber-400 bg-amber-100 px-2 text-left text-amber-950 hover:bg-amber-200"
          // The visible label truncates and drops its prefix on narrow
          // screens, so state the full identity explicitly.
          aria-label={`Viewing as ${ensName ?? formatEthAddress(viewAs, { truncateTo: 4 })}`}
        >
          <span className="h-2 w-2 shrink-0 bg-amber-500" aria-hidden />
          {/* Ellipsize rather than wrap: a long ENS name centred over two
              lines reads as a broken control. The label drops first on narrow
              screens, since the account is the part that matters. */}
          <span className="min-w-0 truncate">
            <span className="hidden sm:inline">Viewing as </span>
            {ensName ?? formatEthAddress(viewAs, { truncateTo: 4 })}
          </span>
        </Button>
        {open ? (
          <div
            ref={menu.menuRef}
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-label="Viewed account"
            onKeyDown={menu.onMenuKeyDown}
            className="absolute right-0 top-full z-50 mt-2 min-w-64 border border-amber-300 bg-white p-1 shadow-lg"
          >
            <div className="border-b border-amber-100 px-3 py-2 text-xs text-amber-800">
              Transactions are disabled while viewing as another account.
            </div>
            <div className="border-b border-amber-100 px-3 py-2 text-xs text-zinc-600">
              {project ? (
                <ProjectWalletBalances address={viewAs} />
              ) : (
                <>
                  <div className="mb-1.5">{chain?.name ?? "Unsupported network"}</div>
                  <dl className="space-y-1">
                    <BalanceRow
                      label={balance?.symbol ?? "Native"}
                      value={formattedBalance ?? "Unavailable"}
                    />
                    <BalanceRow label="USDC" value={formattedUsdcBalance} />
                  </dl>
                </>
              )}
            </div>
            <Link
              href={`/account/${viewAs}`}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                menu.triggerRef.current?.focus();
              }}
              className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm text-melon-950 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
            >
              Account
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                clearViewAs();
                setOpen(false);
                menu.triggerRef.current?.focus();
              }}
              className="block min-h-11 w-full px-3 py-2 text-left text-sm font-medium text-amber-800 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              {isConnected && address ? "View as connected wallet" : "Exit View as"}
            </button>
            <div className="mx-3 my-1 border-t border-zinc-200" aria-hidden />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setViewAsOpen(true);
              }}
              className="block min-h-11 w-full px-3 py-2 text-left text-sm text-melon-950 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
            >
              View as another account…
            </button>
          </div>
        ) : null}
        {viewAsDialog}
      </div>
    );
  }

  if (!mounted || !isConnected || !address) {
    return <WalletConnectButton menuAlign="right" />;
  }

  return (
    <div
      className="relative inline-flex"
      ref={menu.containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button
        ref={menu.triggerRef}
        type="button"
        variant="outline"
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onKeyDown={menu.onTriggerKeyDown}
        onClick={() => {
          if (open) setOpen(false);
          else menu.openMenu();
        }}
        className="gap-2"
      >
        {/* The state is the headline; which account is the detail. The dot belongs to the
            headline, so it sits on that line rather than centred against both. */}
        <span className="flex flex-col items-start leading-tight">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 bg-teal-500" aria-hidden />
            Signed in
          </span>
          <span className="pl-4 text-[11px] text-zinc-600">
            {ensName ?? formatEthAddress(address, { truncateTo: 4 })}
          </span>
        </span>
        {/* No balance on the trigger: the menu lists every token this project touches, with
            the chains they are spread across, which is the answer "0 ETH" only gestured at. */}
      </Button>
      {open ? (
        <div
          ref={menu.menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Wallet account"
          onKeyDown={menu.onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 min-w-64 border border-zinc-200 bg-white p-1 shadow-lg"
        >
          <div className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-600">
            {project ? (
              <ProjectWalletBalances address={address} />
            ) : (
              <>
                <div className="mb-1.5">{chain?.name ?? "Unsupported network"}</div>
                <dl className="space-y-1">
                  <BalanceRow
                    label={balance?.symbol ?? "Native"}
                    value={formattedBalance ?? "Unavailable"}
                  />
                  <BalanceRow label="USDC" value={formattedUsdcBalance} />
                </dl>
              </>
            )}
          </div>
          <Link
            href={`/account/${viewAs ?? address}`}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              menu.triggerRef.current?.focus();
            }}
            className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm text-melon-950 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          >
            Account
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard?.writeText(address).catch(() => undefined);
              setOpen(false);
              menu.triggerRef.current?.focus();
            }}
            className="block min-h-11 w-full px-3 py-2 text-left text-sm text-melon-950 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          >
            Copy address
          </button>
          {/* One entry, not one per asset: both ride the same networks, so two rows would
              always appear and disappear together, and the provider asks which anyway. */}
          <GetFunds
            symbol="ETH"
            label="Get ETH and USDC"
            chainId={chain?.id}
            onNavigate={() => {
              setOpen(false);
              menu.triggerRef.current?.focus();
            }}
            className="block min-h-11 w-full px-3 py-2 text-left text-sm text-melon-950 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          />
          <button
            type="button"
            role="menuitem"
            disabled={isPending || paraLogoutPending}
            onClick={() => {
              setDisconnectError(undefined);
              setParaLogoutPending(true);
              void endSession()
                .then(() => setOpen(false))
                .catch((error: unknown) => {
                  setDisconnectError(
                    error instanceof ParaSessionLogoutError
                      ? "The embedded wallet could not sign out. Your session is still connected; try again."
                      : error instanceof ParaLocalDisconnectError
                        ? "You signed out, but the local wallet state did not reset. Try again or reload."
                        : "The wallet could not disconnect. Try again.",
                  );
                })
                .finally(() => setParaLogoutPending(false));
            }}
            className={cn(
              "block min-h-11 w-full px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:opacity-50",
            )}
          >
            {paraLogoutPending ? "Signing out…" : "Disconnect"}
          </button>
          {disconnectError ? (
            <p
              role="alert"
              className="max-w-72 border-t border-zinc-100 px-3 py-2 text-xs text-red-700"
            >
              {disconnectError}
            </p>
          ) : null}
          <div className="mx-3 my-1 border-t border-zinc-200" aria-hidden />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              menu.triggerRef.current?.focus();
              setViewAsOpen(true);
            }}
            className="block min-h-11 w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          >
            View as…
          </button>
        </div>
      ) : null}
      {viewAsDialog}
    </div>
  );
}
