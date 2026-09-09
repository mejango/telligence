import { ETH_CURRENCY_ID, USD_CURRENCY_ID } from "@bananapus/nana-sdk-core";

export function toBaseCurrencyId(currency: number | string) {
  const value = Number(currency);
  if (value === 1 || value === 61166) return ETH_CURRENCY_ID;
  if (value === 2) return USD_CURRENCY_ID(6);
  // V6 accounting contexts may use uint32(uint160(token)) as their currency.
  // Preserve that token-keyed id; treating every non-ETH currency as USD makes
  // custom-reserve cash-out and loan quotes use the wrong denomination.
  return value;
}

const usdSymbols = ["USDC", "USD", "USDT", "DAI"];

export function isUsd(symbol: string) {
  return usdSymbols.map((s) => s.toLowerCase()).includes(symbol.toLowerCase());
}
