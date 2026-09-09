"use client";

import { useFormContext } from "@/lib/forms";
import { RevnetFormData } from "../types";

export function useCreateForm() {
  const context = useFormContext<RevnetFormData>();

  const revnetTokenSymbol =
    context.values.tokenSymbol?.length > 0
      ? context.values.tokenSymbol.replace(/^\$+/, "")
      : "token";
  const reserveAssetSymbol =
    context.values.reserveAsset === "CUSTOM"
      ? context.values.customReserveAsset.symbol || "custom token"
      : context.values.reserveAsset === "ETH_USDC"
        ? "ETH and USDC"
        : context.values.reserveAsset;
  const issuanceBaseCurrencySymbol =
    context.values.reserveAsset === "CUSTOM"
      ? reserveAssetSymbol
      : context.values.issuanceBaseCurrency;

  return {
    ...context,
    revnetTokenSymbol,
    reserveAssetSymbol,
    issuanceBaseCurrencySymbol,
  };
}
