"use client";

import { wagmiConfig } from "@/lib/wagmiConfig";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useState } from "react";
import { getPublicClient } from "wagmi/actions";
import { customReserveCoversChains, verifyCustomReserveAsset } from "../helpers/customReserveAsset";
import { useCreateForm } from "./useCreateForm";

type LookupState =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type CanonicalReserveAsset = "ETH" | "USDC";

export function ReserveAssetFields({ disabled = false }: { disabled?: boolean }) {
  const { values, setFieldValue, revnetTokenSymbol } = useCreateForm();
  const { reserveAsset, customReserveAsset, chainIds } = values;
  const customSelected = reserveAsset === "CUSTOM";
  const [lookup, setLookup] = useState<LookupState>({
    kind: "idle",
    message: "",
  });
  const chainKey = chainIds.map(Number).join(",");
  const canonicalSelected: readonly CanonicalReserveAsset[] =
    reserveAsset === "ETH_USDC"
      ? (["ETH", "USDC"] as const)
      : reserveAsset === "ETH" || reserveAsset === "USDC"
        ? ([reserveAsset] as const)
        : [];

  useEffect(() => {
    if (!customSelected) {
      setLookup({ kind: "idle", message: "" });
      return;
    }
    const address = customReserveAsset.address.trim();
    if (!address) {
      setLookup({ kind: "idle", message: "Enter an ERC-20 address, then choose the chains." });
      return;
    }
    if (chainIds.length === 0) {
      setLookup({
        kind: "idle",
        message: "Choose at least one chain above to verify this token.",
      });
      return;
    }

    let stale = false;
    setLookup({ kind: "loading", message: "Verifying the token on every selected chain…" });
    const timeout = window.setTimeout(async () => {
      try {
        const verified = await verifyCustomReserveAsset(address, chainIds, (chainId) =>
          getPublicClient(wagmiConfig, { chainId }),
        );
        if (stale) return;
        setFieldValue("customReserveAsset", verified);
        setLookup({
          kind: "success",
          message: `${verified.symbol} | ${verified.decimals} decimals | verified on ${chainIds
            .map((chainId) => JB_CHAINS[chainId]?.name ?? chainId)
            .join(", ")}`,
        });
      } catch (error) {
        if (stale) return;
        setFieldValue("customReserveAsset", {
          address,
          symbol: "",
          decimals: null,
          verifiedChainIds: [],
        });
        setLookup({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not verify this token.",
        });
      }
    }, 400);

    return () => {
      stale = true;
      window.clearTimeout(timeout);
    };
    // Reverify when the address or deployment-chain set changes. Metadata writes
    // must not restart the lookup that produced them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customSelected, customReserveAsset.address, chainKey]);

  const selectCustom = () => {
    setFieldValue("reserveAsset", "CUSTOM");
    if (customReserveAsset.address) {
      setFieldValue("customReserveAsset", {
        ...customReserveAsset,
        symbol: "",
        decimals: null,
        verifiedChainIds: [],
      });
    }
  };
  const toggleCanonical = (asset: CanonicalReserveAsset) => {
    const next = customSelected
      ? [asset]
      : canonicalSelected.includes(asset)
        ? canonicalSelected.filter((selected) => selected !== asset)
        : [...canonicalSelected, asset];
    // At least one reserve must remain selected.
    if (next.length === 0) return;
    setFieldValue("reserveAsset", next.length === 2 ? "ETH_USDC" : next[0]);
  };

  const verified =
    customSelected && customReserveCoversChains(customReserveAsset, chainIds as JBChainId[]);

  return (
    <div className="mt-8">
      <span className="mr-4 text-md font-semibold">Choose your reserve asset</span>
      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
        {(["ETH", "USDC"] as const).map((asset) => (
          <label className="flex items-center gap-2" key={asset}>
            <input
              type="checkbox"
              name="reserveAsset"
              value={asset}
              checked={canonicalSelected.includes(asset)}
              onChange={() => toggleCanonical(asset)}
              disabled={disabled}
            />
            {asset}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="reserveAsset"
            value="CUSTOM"
            checked={customSelected}
            onChange={selectCustom}
            disabled={disabled}
          />
          Custom token
        </label>
      </div>

      {!customSelected ? (
        <>
          <p className="mt-3 max-w-xl text-sm text-zinc-600">
            Accounting contexts cannot be added or removed later.
          </p>
          {reserveAsset === "ETH_USDC" ? (
            <div className="mt-3 max-w-xl border border-pink-200 bg-pink-50 p-3 text-sm text-zinc-700">
              {revnetTokenSymbol}&nbsp;will be backed by both ETH and USDC paid in by users. Holders
              can cash out for either reserve, and the backing mix is set by the proportion
              received—you cannot rebalance between them later. Issuance and shop prices can use ETH
              or USD; the canonical ETH and USDC accounting contexts use the protocol&apos;s default
              ETH/USD feed to convert between them.
            </div>
          ) : null}
        </>
      ) : null}

      {customSelected ? (
        <div className="mt-5 max-w-xl border-l border-zinc-300 pl-4">
          <label className="block text-sm font-semibold" htmlFor="customReserveAsset.address">
            ERC-20 token address
          </label>
          <input
            id="customReserveAsset.address"
            type="text"
            className="mt-2 h-10 w-full border border-zinc-300 bg-white px-3 font-mono text-sm"
            placeholder="0x…"
            value={customReserveAsset.address}
            onChange={(event) =>
              setFieldValue("customReserveAsset", {
                address: event.target.value.trim(),
                symbol: "",
                decimals: null,
                verifiedChainIds: [],
              })
            }
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          {lookup.message ? (
            <p
              className={`mt-2 text-sm ${
                lookup.kind === "error"
                  ? "text-red-700"
                  : lookup.kind === "success"
                    ? "text-teal-700"
                    : "text-zinc-500"
              }`}
              role={lookup.kind === "error" ? "alert" : "status"}
            >
              {lookup.message}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-zinc-600">
            A custom reserve is exclusive. {verified ? customReserveAsset.symbol : "The token"}{" "}
            becomes the denomination for issuance and shop prices, so no ETH or USD price feed is
            needed. It must exist at the same address with the same symbol and decimals on every
            selected chain.
          </p>
          {chainIds.length > 1 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Linked chains bridge the revnet token. Custom reserve balances remain local because
              the protocol has no canonical cross-chain mapping for arbitrary ERC-20s.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
