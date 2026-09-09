"use client";

import { lazyParaConnector } from "@/providers/lazy-para-connector";
import { externalWalletConnectors } from "@/providers/wallet-connectors";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { IS_DETERMINISTIC_BROWSER, PARA_EMBEDDED_WALLET_ENABLED } from "./browserEnvironment";
import { SUPPORTED_CHAINS, transports } from "./wagmiTransports";

export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  // EIP-6963 discovers installed browser wallets without loading vendor SDKs.
  // The generic injected connector remains as a fallback for older providers.
  // Every non-injected wallet — Para, WalletConnect, Coinbase, Safe — sits
  // behind a lazy delegate, so its SDK is fetched only once that wallet is
  // picked or restored. `reconnect()` probes `getProvider()` on every
  // connector, which is exactly what those delegates short-circuit.
  connectors: IS_DETERMINISTIC_BROWSER
    ? []
    : PARA_EMBEDDED_WALLET_ENABLED
      ? [injected({ shimDisconnect: true }), lazyParaConnector(), ...externalWalletConnectors()]
      : [injected({ shimDisconnect: true }), ...externalWalletConnectors()],
  multiInjectedProviderDiscovery: !IS_DETERMINISTIC_BROWSER,
  ssr: true,
  transports,
});
