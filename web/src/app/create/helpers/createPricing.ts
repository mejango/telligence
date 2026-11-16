import { ETH_CURRENCY_ID, USD_CURRENCY_ID } from "@bananapus/nana-sdk-core";
import {
  buildAccountingContext,
  resolve721PricingContext,
  tokenCurrencyId,
} from "@bananapus/nana-sdk-core/v6";
import type { Address } from "viem";
import type { RevnetFormData } from "../types";

type PricingForm = Pick<
  RevnetFormData,
  "reserveAsset" | "issuanceBaseCurrency" | "customReserveAsset" | "store"
>;

export function createBaseCurrency(form: Omit<PricingForm, "store">): number {
  return form.reserveAsset === "CUSTOM"
    ? tokenCurrencyId(form.customReserveAsset.address as Address)
    : form.issuanceBaseCurrency === "USD"
      ? USD_CURRENCY_ID(6)
      : ETH_CURRENCY_ID;
}

/** The shop's denomination is independent of the tokens accepted for payment. */
export function createStorePricing(form: PricingForm) {
  return resolve721PricingContext({
    currency: form.store.pricing === "USD" ? USD_CURRENCY_ID(6) : createBaseCurrency(form),
    accountingContexts:
      form.reserveAsset === "CUSTOM"
        ? [
            buildAccountingContext(
              form.customReserveAsset.address as Address,
              Number(form.customReserveAsset.decimals),
            ),
          ]
        : [],
  });
}
